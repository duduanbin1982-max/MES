"use strict";
// services/process/node/dependencies.js
// 工艺依赖管理（2026-11-05 扩展：列表 / 编辑类型与间隔 / 环检测）
//   GET    /api/process_dependencies?instance_id=&predecessor_id=&successor_id=
//   POST   /api/process_dependencies          新增依赖（FS/SS/FF/SF + lag_hours）
//   PUT    /api/process_dependencies/:id      修改类型 / 间隔 / 端点（会重新做环检测）
//   DELETE /api/process_dependencies/:id      删除依赖
//
// 校验：两端节点存在且同项目、不能自依赖、不能重复、不能成环；dep_type ∈ FS/SS/FF/SF；lag_hours 0~8760。

const { wrap } = require("../../../middleware/asyncHandler");
const { ApiError } = require("../../../app/errors");
const audit = require("../../../app/audit");

const DEP_TYPES = ["FS", "SS", "FF", "SF"];
const MAX_LAG_HOURS = 8760;
const MAX_NODES = 2000;
const MAX_ITEMS = 2000;

function toInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDepType(value) {
  const text = String(value ?? "FS").trim().toUpperCase() || "FS";
  if (!DEP_TYPES.includes(text)) throw ApiError.validation(`dep_type 必须是 ${DEP_TYPES.join(" / ")}`);
  return text;
}

function normalizeLag(value) {
  if (value === undefined || value === null || value === "") return 0;
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours < 0 || hours > MAX_LAG_HOURS) {
    throw ApiError.validation(`lag_hours 必须是 0~${MAX_LAG_HOURS} 小时之间的数字`);
  }
  return Math.round(hours * 100) / 100;
}

function register(app, db) {
  const all = (sql, params = []) => db.prepare(sql).all(params);
  const get = (sql, params = []) => db.prepare(sql).get(params);
  const run = (sql, params = []) => db.prepare(sql).run(params);

  const nodeOf = (id) => get("SELECT id, equipment_instance_id, operation_name, status, planned_start, planned_end FROM process_nodes WHERE id = ?", [id]);
  const depsOfInstance = (instanceId) => all("SELECT id, predecessor_id, successor_id FROM process_dependencies WHERE equipment_instance_id = ?", [instanceId]);

  /** 环检测：从 start 沿 predecessor→successor 走，看能否到达 target */
  function reaches(edges, start, target, ignoreId = null) {
    const adjacency = new Map();
    for (const edge of edges) {
      if (ignoreId && edge.id === ignoreId) continue;
      if (!adjacency.has(edge.predecessor_id)) adjacency.set(edge.predecessor_id, []);
      adjacency.get(edge.predecessor_id).push(edge.successor_id);
    }
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const current = queue.shift();
      for (const next of adjacency.get(current) || []) {
        if (next === target) return true;
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return false;
  }

  /** 统一校验：端点存在、同项目、不自依赖、不重复、不成环 */
  function validateEdge({ instanceId, predecessorId, successorId, ignoreId = null }) {
    const predecessor = nodeOf(predecessorId);
    const successor = nodeOf(successorId);
    if (!predecessor) throw ApiError.validation(`前驱工序不存在：${predecessorId}`);
    if (!successor) throw ApiError.validation(`后继工序不存在：${successorId}`);
    if (Number(predecessor.equipment_instance_id) !== Number(successor.equipment_instance_id)) {
      throw ApiError.validation("前驱与后继不属于同一个项目");
    }
    if (instanceId && Number(predecessor.equipment_instance_id) !== Number(instanceId)) {
      throw ApiError.validation("工序不属于指定项目");
    }
    if (predecessorId === successorId) throw ApiError.validation("不能把工序依赖到它自己");

    const duplicate = get(
      "SELECT id FROM process_dependencies WHERE predecessor_id = ? AND successor_id = ? AND id <> ?",
      [predecessorId, successorId, ignoreId || 0],
    );
    if (duplicate) throw ApiError.validation(`依赖已存在：${predecessorId} → ${successorId}（id=${duplicate.id}）`);

    if (reaches(depsOfInstance(predecessor.equipment_instance_id), successorId, predecessorId, ignoreId)) {
      throw ApiError.validation(`会形成循环依赖：${predecessorId} → ${successorId} 之后可以从 ${successorId} 绕回 ${predecessorId}`);
    }
    return { predecessor, successor };
  }

  // ---------------------------------------------------------------- 列表
  app.get("/api/process_dependencies", wrap((req, res) => {
    const instanceId = toInt(req.query.instance_id);
    const predecessorId = toInt(req.query.predecessor_id);
    const successorId = toInt(req.query.successor_id);

    const conditions = ["1 = 1"];
    const params = [];
    if (instanceId) {
      conditions.push("d.equipment_instance_id = ?");
      params.push(instanceId);
    }
    if (predecessorId) {
      conditions.push("d.predecessor_id = ?");
      params.push(predecessorId);
    }
    if (successorId) {
      conditions.push("d.successor_id = ?");
      params.push(successorId);
    }

    const items = all(`
      SELECT d.id, d.equipment_instance_id, d.predecessor_id, d.successor_id, d.dep_type, d.lag_hours,
             p.operation_name AS predecessor_name, p.status AS predecessor_status, p.planned_start AS predecessor_start, p.planned_end AS predecessor_end,
             s.operation_name AS successor_name, s.status AS successor_status, s.planned_start AS successor_start, s.planned_end AS successor_end
        FROM process_dependencies d
        LEFT JOIN process_nodes p ON p.id = d.predecessor_id
        LEFT JOIN process_nodes s ON s.id = d.successor_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY d.equipment_instance_id, d.predecessor_id, d.successor_id
       LIMIT ${MAX_ITEMS}
    `, params);

    const nodes = instanceId
      ? all(`
          SELECT id, operation_name, status, planned_start, planned_end, sequence
            FROM process_nodes
           WHERE equipment_instance_id = ?
           ORDER BY sequence, id
           LIMIT ${MAX_NODES}
        `, [instanceId])
      : [];

    res.json({ total: items.length, items, nodes });
  }));

  // ---------------------------------------------------------------- 新增
  app.post("/api/process_dependencies", wrap((req, res) => {
    const body = req.body || {};
    const predecessorId = toInt(body.predecessor_id);
    const successorId = toInt(body.successor_id);
    if (!predecessorId || !successorId) throw ApiError.validation("predecessor_id 与 successor_id 必填");
    const depType = normalizeDepType(body.dep_type);
    const lagHours = normalizeLag(body.lag_hours);

    const { predecessor } = validateEdge({
      instanceId: toInt(body.equipment_instance_id) || null,
      predecessorId,
      successorId,
    });
    const instanceId = toInt(body.equipment_instance_id) || Number(predecessor.equipment_instance_id);

    const result = run(
      "INSERT INTO process_dependencies (equipment_instance_id, predecessor_id, successor_id, dep_type, lag_hours) VALUES (?, ?, ?, ?, ?)",
      [instanceId, predecessorId, successorId, depType, lagHours],
    );
    audit.record(db, req, {
      action: "process_dependency.create",
      resource_type: "process_dependency",
      resource_id: result.lastInsertRowid,
      after: { equipment_instance_id: instanceId, predecessor_id: predecessorId, successor_id: successorId, dep_type: depType, lag_hours: lagHours },
      diff_summary: `新增工序依赖 ${predecessorId} → ${successorId}`,
    });
    res.json({
      id: result.lastInsertRowid,
      equipment_instance_id: instanceId,
      predecessor_id: predecessorId,
      successor_id: successorId,
      dep_type: depType,
      lag_hours: lagHours,
      message: "依赖已创建",
    });
  }));

  // ---------------------------------------------------------------- 修改
  app.put("/api/process_dependencies/:id", wrap((req, res) => {
    const id = toInt(req.params.id);
    if (!id) throw ApiError.validation("id 必填");
    const existing = get("SELECT * FROM process_dependencies WHERE id = ?", [id]);
    if (!existing) throw ApiError.notFound("依赖不存在");

    const body = req.body || {};
    const predecessorId = body.predecessor_id !== undefined ? toInt(body.predecessor_id) : existing.predecessor_id;
    const successorId = body.successor_id !== undefined ? toInt(body.successor_id) : existing.successor_id;
    if (!predecessorId || !successorId) throw ApiError.validation("predecessor_id 与 successor_id 不能为空");
    const depType = body.dep_type !== undefined ? normalizeDepType(body.dep_type) : existing.dep_type;
    const lagHours = body.lag_hours !== undefined ? normalizeLag(body.lag_hours) : existing.lag_hours;

    if (predecessorId !== existing.predecessor_id || successorId !== existing.successor_id) {
      validateEdge({
        instanceId: existing.equipment_instance_id,
        predecessorId,
        successorId,
        ignoreId: id,
      });
    }

    run(
      "UPDATE process_dependencies SET predecessor_id = ?, successor_id = ?, dep_type = ?, lag_hours = ? WHERE id = ?",
      [predecessorId, successorId, depType, lagHours, id],
    );
    audit.record(db, req, {
      action: "process_dependency.update",
      resource_type: "process_dependency",
      resource_id: id,
      before: existing,
      after: { predecessor_id: predecessorId, successor_id: successorId, dep_type: depType, lag_hours: lagHours },
      diff_summary: `修改工序依赖 #${id}`,
    });
    res.json({
      ok: true,
      id,
      predecessor_id: predecessorId,
      successor_id: successorId,
      dep_type: depType,
      lag_hours: lagHours,
    });
  }));

  // ---------------------------------------------------------------- 删除
  app.delete("/api/process_dependencies/:id", wrap((req, res) => {
    const id = toInt(req.params.id);
    if (!id) throw ApiError.validation("id 必填");
    const existing = get("SELECT * FROM process_dependencies WHERE id = ?", [id]);
    if (!existing) throw ApiError.notFound("依赖不存在");
    run("DELETE FROM process_dependencies WHERE id = ?", [id]);
    audit.record(db, req, {
      action: "process_dependency.delete",
      resource_type: "process_dependency",
      resource_id: id,
      before: existing,
      diff_summary: `删除工序依赖 #${id}`,
    });
    res.json({ deleted: [id] });
  }));
}

module.exports = { register, DEP_TYPES, MAX_LAG_HOURS };
