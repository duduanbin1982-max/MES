"use strict";
// services/process/params.js
// MESA #8: Process parameter management + trend + monitoring dashboard
// 2026-11-07（工艺参数审计）：
//   - 修复 /api/process/monitor 500（process_nodes 没有 node_type 列，应为 operation_type）
//   - 参数读写补数值边界/类型/节点存在校验，recorded_by 不再无条件信任 body
//   - specs 校验（lsl<=usl、未知 key、重复 key），改为更新最近一条 spec 行而非无限插入
//   - 偏差检测改为取最近一条"真实读数"（避开只含 custom_json 的 spec 行）
//   - 写操作补审计
const { ApiError } = require("../../app/errors");
const audit = require("../../app/audit");

const logger = require("../../app/logger").createLogger("process/params");

const { PARAM_FIELDS, PARAM_LIMITS, normalizeSpecs, findNodeSpecRow, resolveNodeSpecs } = require("../../shared/processSpecs");
const READING_FILTER = `(${PARAM_FIELDS.map((field) => `${field} IS NOT NULL`).join(" OR ")})`;

function tableExists(db, name) {
  try {
    return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  } catch (_error) {
    return false;
  }
}

function toReadingNumber(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num)) throw ApiError.validation(`${field} 必须是数字`);
  const [min, max] = PARAM_LIMITS[field];
  if (num < min || num > max) throw ApiError.validation(`${field} 需在 ${min}~${max} 之间`);
  return num;
}

function actorId(req) {
  if (!req || !req.user) return null;
  const id = req.user.sub != null ? req.user.sub : req.user.uid;
  return id == null ? null : Number(id);
}

function isAdmin(req) {
  return req?.user?.role === "admin" || (req?.user?.permissions || []).includes("*");
}

function assertNode(db, nodeId) {
  if (!tableExists(db, "process_nodes")) return null;
  const row = db.prepare("SELECT id FROM process_nodes WHERE id = ?").get(nodeId);
  if (!row) throw ApiError.notFound("工艺节点不存在");
  return row;
}

function assertUser(db, userId) {
  if (userId === null || userId === undefined) return null;
  if (!tableExists(db, "users")) return userId;
  const row = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
  if (!row) throw ApiError.validation(`记录人不存在：${userId}`);
  return userId;
}

function parseCustomJson(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  let parsed = raw;
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw); } catch (_error) { throw ApiError.validation("custom_json 必须是合法 JSON"); }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw ApiError.validation("custom_json 必须是 JSON 对象");
  }
  return JSON.stringify(parsed);
}

function findLatestSpecRow(db, nodeId) {
  const found = findNodeSpecRow(db, nodeId);
  return found ? { row: found.row, spc: found.spc } : null;
}

function register(app, db) {
  const { wrap } = require("../../middleware/asyncHandler");
  const all = (sql, p) => db.prepare(sql).all(p || []);
  const run = (sql, p) => db.prepare(sql).run(p || []);

  // CRUD: get params for a node（排除只有 custom_json 的 spec 行）
  app.get("/api/process_nodes/:id/params", wrap((req, res) => {
    const nodeId = Number(req.params.id);
    assertNode(db, nodeId);
    const hasPage = ["page", "page_size", "from", "to"].some((key) => req.query[key] !== undefined && req.query[key] !== "");
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to))) {
      throw ApiError.validation("from/to 必须是 YYYY-MM-DD");
    }
    let where = `pp.process_node_id = ? AND (${READING_FILTER} OR pp.custom_json IS NULL)`;
    const params = [nodeId];
    if (from) { where += " AND date(pp.recorded_at) >= date(?)"; params.push(from); }
    if (to) { where += " AND date(pp.recorded_at) <= date(?)"; params.push(to); }
    if (!hasPage) {
      return res.json(all(`SELECT pp.*, u.full_name as recorder_name FROM process_params pp LEFT JOIN users u ON pp.recorded_by = u.id WHERE ${where} ORDER BY pp.recorded_at DESC, pp.id DESC LIMIT 500`, params));
    }
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, Number.parseInt(req.query.page_size, 10) || 50));
    const total = db.prepare(`SELECT COUNT(*) c FROM process_params pp WHERE ${where}`).get(params).c;
    const items = all(`SELECT pp.*, u.full_name as recorder_name FROM process_params pp LEFT JOIN users u ON pp.recorded_by = u.id WHERE ${where} ORDER BY pp.recorded_at DESC, pp.id DESC LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]);
    res.json({ items, total, page, page_size: pageSize, from, to });
  }));

  // CRUD: add param reading
  app.post("/api/process_nodes/:id/params", wrap((req, res) => {
    const b = req.body || {};
    const nodeId = Number(req.params.id);
    if (!Number.isInteger(nodeId) || nodeId <= 0) throw ApiError.validation("工艺节点 ID 非法");
    assertNode(db, nodeId);
    const values = PARAM_FIELDS.map((field) => toReadingNumber(b[field], field));
    const customJson = parseCustomJson(b.custom_json);
    const notes = b.notes === undefined || b.notes === null ? null : String(b.notes).trim();
    if (notes && notes.length > 2000) throw ApiError.validation("notes 长度不能超过 2000");
    const actor = actorId(req);
    const requestedRecorder = b.recorded_by == null || b.recorded_by === "" ? null : Number(b.recorded_by);
    if (requestedRecorder !== null && actor !== null && requestedRecorder !== actor && !isAdmin(req)) {
      throw ApiError.forbidden("只能以本人身份记录工艺参数");
    }
    const recordedBy = assertUser(db, requestedRecorder == null ? actor : requestedRecorder);
    const hasReading = values.some((value) => value !== null);
    if (!hasReading && !customJson && !notes) throw ApiError.validation("至少填写一个参数值、custom_json 或备注");
    const r = run("INSERT INTO process_params (process_node_id, current_amp, voltage_v, speed_mm_min, temperature_c, pressure_mpa, feed_rate, custom_json, notes, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [nodeId, ...values, customJson, notes, recordedBy]);
    audit.record(db, req, {
      action: "process_params.create",
      resource_type: "process_params",
      resource_id: r.lastInsertRowid,
      after: { process_node_id: nodeId, ...Object.fromEntries(PARAM_FIELDS.map((field, index) => [field, values[index]])) },
      diff_summary: `记录工艺参数 node=${nodeId}`,
    });
    res.json({ id: r.lastInsertRowid });
  }));

  // MESA #8: 过程参数趋势 (时间序列)
  app.get("/api/process_nodes/:id/params/trend", wrap((req, res) => {
    const parsedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Math.min(Math.max(Number.isFinite(parsedLimit) ? parsedLimit : 100, 1), 1000);
    const param = req.query.param ? String(req.query.param).trim() : null;
    if (param && !PARAM_LIMITS[param]) throw ApiError.validation(`param 必须是 ${PARAM_FIELDS.join(" / ")}`);
    assertNode(db, Number(req.params.id));
    // 先取最近 limit 条，再按时间正序返回（原实现 LIMIT 取到的是最早的数据）
    const rows = all(`SELECT * FROM (SELECT pp.*, u.full_name as recorder_name FROM process_params pp LEFT JOIN users u ON pp.recorded_by = u.id WHERE pp.process_node_id = ? AND (${READING_FILTER} OR pp.custom_json IS NULL) ORDER BY pp.recorded_at DESC, pp.id DESC LIMIT ?) ORDER BY recorded_at ASC, id ASC`, [req.params.id, limit]);
    if (param) {
      const times = [], values = [];
      for (const r of rows) {
        if (r[param] != null) {
          times.push(r.recorded_at);
          values.push(r[param]);
        }
      }
      return res.json({ param, times, values, count: values.length });
    }
    res.json(rows);
  }));

  // 2026-11-08（审计）：前端读取当前规格，用于表格判定/规格编辑
  app.get("/api/process_nodes/:id/params/specs", wrap((req, res) => {
    const nodeId = Number(req.params.id);
    if (!Number.isInteger(nodeId) || nodeId <= 0) throw ApiError.validation("工艺节点 ID 非法");
    assertNode(db, nodeId);
    const resolved = resolveNodeSpecs(db, nodeId);
    res.json({ process_node_id: nodeId, specs: resolved.specs, source: resolved.source, source_id: resolved.source_id || null, template_id: resolved.template_id || null, operation_code: resolved.operation_code || null });
  }));

  // MESA #8: 过程参数规格设置
  app.put("/api/process_nodes/:id/params/specs", wrap((req, res) => {
    const nodeId = Number(req.params.id);
    if (!Number.isInteger(nodeId) || nodeId <= 0) throw ApiError.validation("工艺节点 ID 非法");
    const specs = normalizeSpecs((req.body || {}).specs);
    assertNode(db, nodeId);
    const recordedBy = assertUser(db, actorId(req));
    const payload = JSON.stringify({ spc: specs });
    const existing = findLatestSpecRow(db, nodeId);
    let id;
    if (existing) {
      id = existing.row.id;
      run("UPDATE process_params SET custom_json = ?, recorded_by = COALESCE(?, recorded_by), recorded_at = datetime('now') WHERE id = ?", [payload, recordedBy, id]);
    } else {
      const r = run("INSERT INTO process_params (process_node_id, recorded_by, custom_json) VALUES (?, ?, ?)", [nodeId, recordedBy, payload]);
      id = r.lastInsertRowid;
    }
    audit.record(db, req, {
      action: existing ? "process_params.spec.update" : "process_params.spec.create",
      resource_type: "process_params",
      resource_id: id,
      before: existing ? { spc: existing.spc } : undefined,
      after: { process_node_id: nodeId, spc: specs },
      diff_summary: `设置工艺参数规格 node=${nodeId}`,
    });
    res.json({ success: true, id });
  }));

  // MESA #8: 过程监控仪表板
  app.get("/api/process/monitor", wrap((req, res) => {
    const { equipment_instance_id } = req.query;
    // 2026-11-07 修复：process_nodes 无 node_type 列，原 SQL 直接 500。
    let nodeSql = "SELECT pn.id, pn.operation_name AS name, pn.operation_type AS node_type, pn.status, pn.equipment_instance_id, ei.instance_code FROM process_nodes pn LEFT JOIN equipment_instances ei ON pn.equipment_instance_id = ei.id WHERE pn.status IN ('in_progress','pending')";
    const p = [];
    if (equipment_instance_id) { nodeSql += " AND pn.equipment_instance_id = ?"; p.push(equipment_instance_id); }
    nodeSql += " ORDER BY pn.id LIMIT 100";
    const nodes = all(nodeSql, p);
    const spcAlertsAvailable = tableExists(db, "spc_alerts");

    const result = [];
    for (const node of nodes) {
      const lastParam = db.prepare(`SELECT * FROM process_params WHERE process_node_id = ? AND ${READING_FILTER} ORDER BY recorded_at DESC, id DESC LIMIT 1`).get(node.id);
      const paramCount = safeCount(db, "SELECT COUNT(*) as c FROM process_params WHERE process_node_id = ?", [node.id]);
      const spcAlert = spcAlertsAvailable ? safeCount(db, "SELECT COUNT(*) as c FROM spc_alerts WHERE process_node_id = ? AND acknowledged = 0", [node.id]) : 0;

      result.push({
        id: node.id, name: node.name, node_type: node.node_type, status: node.status,
        instance_code: node.instance_code,
        last_params: lastParam ? {
          current_amp: lastParam.current_amp, voltage_v: lastParam.voltage_v,
          speed_mm_min: lastParam.speed_mm_min, temperature_c: lastParam.temperature_c,
          pressure_mpa: lastParam.pressure_mpa, feed_rate: lastParam.feed_rate,
          recorded_at: lastParam.recorded_at,
        } : null,
        param_count: paramCount, spc_alerts: spcAlert,
      });
    }
    res.json({ nodes: result, total: result.length });
  }));

  // MESA #8: 参数偏差报警查询
  app.get("/api/process/deviations", wrap((req, res) => {
    const parsedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Math.min(Math.max(Number.isFinite(parsedLimit) ? parsedLimit : 50, 1), 500);
    const nodes = all(`SELECT pn.id, pn.operation_name FROM process_nodes pn
      WHERE EXISTS (SELECT 1 FROM process_params pp WHERE pp.process_node_id = pn.id AND pp.custom_json IS NOT NULL)
      ORDER BY pn.id`);
    const deviations = [];
    for (const node of nodes) {
      const spec = findLatestSpecRow(db, node.id);
      if (!spec) continue;
      const spcSpec = spec.spc;
      if (!spcSpec || typeof spcSpec !== "object") continue;
      const lastParam = db.prepare(`SELECT * FROM process_params WHERE process_node_id = ? AND ${READING_FILTER} ORDER BY recorded_at DESC, id DESC LIMIT 1`).get(node.id);
      if (!lastParam) continue;
      for (const [param, limits] of Object.entries(spcSpec)) {
        if (!PARAM_LIMITS[param] || !limits || typeof limits !== "object") continue;
        const lsl = Number(limits.lsl);
        const usl = Number(limits.usl);
        if (!Number.isFinite(lsl) || !Number.isFinite(usl)) continue;
        const val = Number(lastParam[param]);
        if (lastParam[param] == null || !Number.isFinite(val)) continue;
        if (val < lsl || val > usl) {
          deviations.push({
            node_id: node.id, node_name: node.operation_name || "?",
            param, value: val, lsl, usl,
            deviation: val < lsl ? "low" : "high",
            amount: val < lsl ? (lsl - val) : (val - usl),
            recorded_at: lastParam.recorded_at,
          });
        }
      }
    }
    deviations.sort((a, b) => b.amount - a.amount);
    res.json({ total: deviations.length, items: deviations.slice(0, limit) });
  }));

  logger.info("[process/params] Process params + monitor registered");
}

function safeCount(db, sql, params) {
  try { return db.prepare(sql).get(params || []).c || 0; } catch (_error) { return 0; }
}

module.exports = { register, normalizeSpecs, PARAM_FIELDS, PARAM_LIMITS };
