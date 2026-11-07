"use strict";
// services/processRoute/execution.js
// 2026-11-07 工艺树升级（阶段2）：执行事件、ITP 质量门禁、扫码定位
const { ApiError } = require("../../app/errors");
const { wrap } = require("../../middleware/asyncHandler");
const audit = require("../../app/audit");
const { tableExists } = require("./schema");

const ITP_TYPES = new Set(["self", "witness", "hold"]);
const ITP_STATUSES = new Set(["pending", "passed", "failed", "waived"]);
const PASS_STATUSES = new Set(["passed", "waived"]);

function recordNodeEvent(db, node, action, { fromStatus, toStatus, operatorId, hours, quantity, reason, meta } = {}) {
  if (!tableExists(db, "process_operation_events")) return null;
  try {
    const result = db.prepare(`INSERT INTO process_operation_events
      (process_node_id, action, from_status, to_status, operator_id, hours_worked, quantity, reason, meta_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      node.id, action, fromStatus || node.status || null, toStatus || null,
      operatorId || null, Number(hours) || 0, quantity === undefined ? null : Number(quantity),
      reason || null, meta ? JSON.stringify(meta) : null,
    );
    return result.lastInsertRowid;
  } catch (_error) {
    return null;
  }
}

function pointsOf(db, nodeId) {
  if (!tableExists(db, "process_itp_points")) return [];
  return db.prepare("SELECT * FROM process_itp_points WHERE process_node_id = ? ORDER BY point_no, id").all(nodeId);
}

function seedItp(db, node, customPoints = null) {
  if (!tableExists(db, "process_itp_points")) return [];
  const existing = pointsOf(db, node.id);
  if (existing.length) return existing;
  if (!(Array.isArray(customPoints) && customPoints.length) && !Number(node.qc_required)) return existing;
  const points = Array.isArray(customPoints) && customPoints.length
    ? customPoints
    : [
        { point_type: "self", requirement: "操作者自检并记录关键尺寸/外观" },
        { point_type: "hold", requirement: "专职质检确认，未放行不得流转下道工序" },
      ];
  const insert = db.prepare("INSERT INTO process_itp_points (process_node_id, point_no, point_type, requirement) VALUES (?, ?, ?, ?)");
  const tx = db.transaction(() => {
    points.forEach((point, index) => insert.run(node.id, index + 1, ITP_TYPES.has(point.point_type) ? point.point_type : "self", point.requirement || "按图纸/工艺要求检验"));
  });
  tx();
  return pointsOf(db, node.id);
}

function assertStartAllowed(db, node) {
  // 前置依赖必须完成
  const predecessors = db.prepare(`
    SELECT p.id, p.operation_name, p.status
      FROM process_dependencies d JOIN process_nodes p ON p.id = d.predecessor_id
     WHERE d.successor_id = ?`).all(node.id);
  const unfinished = predecessors.filter((item) => item.status !== "completed");
  if (unfinished.length) {
    throw ApiError.validation(`前置工序未完成，不能开工：${unfinished.map((item) => item.operation_name).join("、")}`, {
      unfinished: unfinished.map((item) => ({ id: item.id, name: item.operation_name, status: item.status })),
    });
  }
  // 停止点未通过不得开工
  const holdPending = pointsOf(db, node.id).filter((point) => point.point_type === "hold" && !PASS_STATUSES.has(point.status));
  if (holdPending.length) {
    throw ApiError.validation("存在未放行的 ITP 停止点，不能开工", {
      itp_points: holdPending.map((point) => ({ id: point.id, requirement: point.requirement, status: point.status })),
    });
  }
}

function assertCompleteAllowed(db, node) {
  const predecessors = db.prepare(`
    SELECT p.operation_name, p.status FROM process_dependencies d JOIN process_nodes p ON p.id = d.predecessor_id
     WHERE d.successor_id = ?`).all(node.id);
  const unfinished = predecessors.filter((item) => item.status !== "completed");
  if (unfinished.length) throw ApiError.validation("前置工序未完成，不能完工");
  const points = pointsOf(db, node.id);
  if (!tableExists(db, "process_itp_points")) return;
  if (Number(node.qc_required) && points.length === 0) {
    throw ApiError.validation("该工序要求质检，但还没有 ITP 检验点；请先创建检验点");
  }
  const pending = points.filter((point) => !PASS_STATUSES.has(point.status));
  if (pending.length) {
    throw ApiError.validation("ITP 检验点未全部通过，不能完工", {
      itp_points: pending.map((point) => ({ id: point.id, point_type: point.point_type, status: point.status, requirement: point.requirement })),
    });
  }
}

function register(app, db) {
  const get = (sql, params = []) => db.prepare(sql).get(params);
  const all = (sql, params = []) => db.prepare(sql).all(params);

  app.get("/api/process_nodes/by-code/:code", wrap((req, res) => {
    const node = get("SELECT * FROM process_nodes WHERE node_code = ?", [String(req.params.code || "").trim()]);
    if (!node) throw ApiError.notFound("未找到对应的工序节点");
    res.json({ node });
  }));

  app.get("/api/process_nodes/:id/events", wrap((req, res) => {
    const node = get("SELECT id FROM process_nodes WHERE id = ?", [Number(req.params.id)]);
    if (!node) throw ApiError.notFound("工艺节点不存在");
    if (!tableExists(db, "process_operation_events")) return res.json({ total: 0, items: [] });
    const items = all("SELECT * FROM process_operation_events WHERE process_node_id = ? ORDER BY id DESC LIMIT 200", [node.id]);
    res.json({ total: items.length, items });
  }));

  app.get("/api/process_nodes/:id/itp", wrap((req, res) => {
    const node = get("SELECT id, operation_name, qc_required, status FROM process_nodes WHERE id = ?", [Number(req.params.id)]);
    if (!node) throw ApiError.notFound("工艺节点不存在");
    res.json({ node, points: pointsOf(db, node.id) });
  }));

  app.post("/api/process_nodes/:id/itp/seed", wrap((req, res) => {
    const node = get("SELECT * FROM process_nodes WHERE id = ?", [Number(req.params.id)]);
    if (!node) throw ApiError.notFound("工艺节点不存在");
    const points = seedItp(db, node, (req.body || {}).points);
    audit.record(db, req, {
      action: "process_itp.seed", resource_type: "process_node", resource_id: node.id,
      after: { points: points.length }, diff_summary: `为工序「${node.operation_name}」创建 ${points.length} 个 ITP 检验点`,
    });
    res.json({ node_id: node.id, points });
  }));

  app.post("/api/process_itp_points/:id/check", wrap((req, res) => {
    const point = get("SELECT * FROM process_itp_points WHERE id = ?", [Number(req.params.id)]);
    if (!point) throw ApiError.notFound("ITP 检验点不存在");
    const body = req.body || {};
    const status = String(body.status || "").trim();
    if (!ITP_STATUSES.has(status)) throw ApiError.validation(`status 必须是 ${[...ITP_STATUSES].join(" / ")}`);
    const checkedBy = body.checked_by ? Number(body.checked_by) : (req.user?.uid || null);
    if (checkedBy !== null) {
      if (!Number.isInteger(checkedBy) || checkedBy <= 0) throw ApiError.validation("checked_by 非法");
      if (!get("SELECT 1 FROM users WHERE id = ?", [checkedBy])) throw ApiError.validation("检验人不存在");
    }
    const tx = db.transaction(() => {
      db.prepare("UPDATE process_itp_points SET status = ?, checked_by = ?, checked_at = datetime('now'), remark = ? WHERE id = ?")
        .run(status, checkedBy, body.remark || null, point.id);
      const node = get("SELECT * FROM process_nodes WHERE id = ?", [point.process_node_id]);
      recordNodeEvent(db, node, "itp_check", {
        fromStatus: node.status, toStatus: node.status, operatorId: checkedBy,
        reason: `ITP#${point.id} ${status}`, meta: { point_id: point.id, point_type: point.point_type, status },
      });
      return node;
    });
    const node = tx();
    audit.record(db, req, {
      action: "process_itp.check", resource_type: "process_itp_point", resource_id: point.id,
      before: { status: point.status }, after: { status, checked_by: checkedBy, remark: body.remark || null },
      diff_summary: `ITP 检验点 ${point.id}（工序 ${node.operation_name}）${point.status} → ${status}`,
    });
    res.json({ ok: true, point_id: point.id, status });
  }));
}

module.exports = {
  register,
  recordNodeEvent,
  seedItp,
  pointsOf,
  assertStartAllowed,
  assertCompleteAllowed,
};
