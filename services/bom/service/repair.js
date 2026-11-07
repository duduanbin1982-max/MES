"use strict";
// services/bom/service/repair.js
// 2026-11-07 BOM 健康分升级：缺根/多根/孤儿修复向导
// GET  /api/equipment_instances/:id/bom/repair/preview
// POST /api/equipment_instances/:id/bom/repair/apply
const { ApiError } = require("../../../app/errors");
const audit = require("../../../app/audit");
const { validateTree, computeHealth } = require("../core");
const { ensureBomStructureColumns } = require("./schema");

function tableExists(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

function diagnose(db, instanceId, bomType = 'EBOM') {
  if (!tableExists(db, "instance_bom")) throw ApiError.validation("BOM 表不存在");
  ensureBomStructureColumns(db);
  const instance = db.prepare("SELECT id, instance_code, instance_name FROM equipment_instances WHERE id = ?").get(instanceId);
  if (!instance) throw ApiError.notFound("装备实例不存在");
  let rows = db.prepare("SELECT * FROM instance_bom WHERE equipment_instance_id = ? ORDER BY tier, id").all(instanceId);
  try { rows = db.prepare("SELECT * FROM instance_bom WHERE equipment_instance_id = ? AND COALESCE(bom_type,'EBOM') = ? ORDER BY tier, id").all(instanceId, bomType); } catch (_error) { /* old schema */ }
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  const roots = rows.filter((row) => Number(row.tier) === 0 && (row.parent_id === null || Number(row.parent_id) === 0));
  const parentless = rows.filter((row) => Number(row.tier) !== 0 && (row.parent_id === null || Number(row.parent_id) === 0));
  const orphanRows = rows.filter((row) => {
    if (row.parent_id === null || Number(row.parent_id) === 0) return false;
    if (byId.has(Number(row.parent_id))) {
      return Number(byId.get(Number(row.parent_id)).equipment_instance_id) !== Number(instanceId);
    }
    return true;
  });
  const crossInstance = orphanRows.filter((row) => {
    const parent = db.prepare("SELECT equipment_instance_id FROM instance_bom WHERE id = ?").get(row.parent_id);
    return parent && Number(parent.equipment_instance_id) !== Number(instanceId);
  });
  const attachable = [...new Set([...parentless, ...orphanRows])].filter((row) => Number(row.tier) === 1);
  const manual = [...new Set([...parentless, ...orphanRows])].filter((row) => Number(row.tier) !== 1);
  const actions = [];
  if (!rows.length) {
    actions.push({
      code: "create_root", label: "创建 0 级整机根节点", count: 1,
      note: "当前 BOM 为空；创建根节点后仍需导入/新增 1/2 级部件",
    });
  } else if (!roots.length) {
    actions.push({ code: "create_root", label: "创建 0 级整机根节点", count: 1 });
    if (attachable.length) actions.push({ code: "attach_parentless", label: "把无父节点的 1 级部件挂到根节点", count: attachable.length });
  } else if (roots.length > 1) {
    actions.push({
      code: "merge_roots", label: "合并多个 0 级根节点（保留一个根，其余降为 1 级）", count: roots.length - 1,
      requires_root_id: true, roots: roots.map((root) => ({ id: root.id, part_number: root.part_number })),
    });
    if (attachable.length) actions.push({ code: "attach_parentless", label: "把无父节点的 1 级部件挂到根节点", count: attachable.length });
  } else {
    if (attachable.length) actions.push({ code: "attach_parentless", label: "把无父节点的 1 级部件挂到根节点", count: attachable.length });
  }
  if (manual.length) {
    actions.push({ code: "manual", label: "需人工处理的非 1 级孤儿/无父节点", count: manual.length, nodes: manual.map((row) => ({ id: row.id, tier: row.tier, part_number: row.part_number })) });
  }
  const validation = validateTree(db, instanceId, rows);
  const health = computeHealth(db, instanceId, rows);
  return {
    instance, rows_count: rows.length, root_count: roots.length, roots: roots.map((row) => ({ id: row.id, part_number: row.part_number })),
    parentless_count: parentless.length, orphan_count: orphanRows.length, cross_instance_count: crossInstance.length,
    attachable_count: attachable.length, manual_count: manual.length,
    actions, validation, health, can_apply: actions.some((action) => action.code !== "manual" && !action.requires_root_id) || (roots.length > 1),
  };
}

function createRoot(db, instance) {
  const partNumber = String(instance.instance_code || `ROOT-${instance.id}`).trim();
  const exists = db.prepare("SELECT id FROM instance_bom WHERE equipment_instance_id = ? AND part_number = ?").get(instance.id, partNumber);
  const finalPartNumber = exists ? `${partNumber}-ROOT` : partNumber;
  const result = db.prepare(`INSERT INTO instance_bom
    (equipment_instance_id, parent_id, tier, version, quantity, unit, category, part_number, node_type, bom_type, created_at, updated_at)
    VALUES (?, NULL, 0, 'A0', 1, '台', '成品', ?, 'equipment', ?, datetime('now'), datetime('now'))`)
    .run(instance.id, finalPartNumber, instance.bom_type || 'EBOM');
  return Number(result.lastInsertRowid);
}

function applyRepair(db, instanceId, body = {}) {
  const bomType = String(body.bom_type || 'EBOM').toUpperCase();
  const before = diagnose(db, instanceId, bomType);
  const requested = Array.isArray(body.actions) && body.actions.length
    ? new Set(body.actions)
    : new Set(before.actions.filter((action) => action.code !== "manual").map((action) => action.code));
  const rows = db.prepare("SELECT * FROM instance_bom WHERE equipment_instance_id = ? ORDER BY tier, id").all(instanceId);
  const roots = rows.filter((row) => Number(row.tier) === 0 && (row.parent_id === null || Number(row.parent_id) === 0));
  let rootId = body.root_bom_id ? Number(body.root_bom_id) : (roots[0]?.id || null);
  const log = { created_root: null, attached: 0, merged: 0, skipped: [] };
  const tx = db.transaction(() => {
    if (requested.has("create_root") && !rootId) {
      rootId = createRoot(db, { ...before.instance, bom_type: bomType });
      log.created_root = rootId;
    }
    if (requested.has("attach_parentless") && rootId) {
      const attach = db.prepare("UPDATE instance_bom SET parent_id = ?, updated_at = datetime('now') WHERE id = ?");
      const candidates = db.prepare("SELECT * FROM instance_bom WHERE equipment_instance_id = ? AND COALESCE(bom_type,'EBOM') = ? AND tier = 1 AND (parent_id IS NULL OR parent_id = 0)").all(instanceId, bomType);
      for (const node of candidates) { attach.run(rootId, node.id); log.attached += 1; }
      const orphanCandidates = db.prepare(`SELECT b.* FROM instance_bom b LEFT JOIN instance_bom p ON p.id = b.parent_id
        WHERE b.equipment_instance_id = ? AND COALESCE(b.bom_type,'EBOM') = ? AND b.tier = 1 AND b.parent_id IS NOT NULL AND b.parent_id <> 0 AND p.id IS NULL`).all(instanceId, bomType);
      for (const node of orphanCandidates) { attach.run(rootId, node.id); log.attached += 1; }
    }
    if (requested.has("merge_roots")) {
      const selectedId = body.root_bom_id ? Number(body.root_bom_id) : roots[0]?.id;
      const selected = roots.find((row) => Number(row.id) === Number(selectedId));
      if (!selected) throw ApiError.validation("root_bom_id 必须是一个 0 级根节点");
      const others = roots.filter((row) => Number(row.id) !== Number(selected.id));
      const descendants = (root) => {
        const ids = [Number(root.id)];
        const stack = [Number(root.id)];
        while (stack.length) {
          const current = stack.pop();
          for (const child of rows.filter((row) => Number(row.parent_id) === current)) {
            if (!ids.includes(Number(child.id))) { ids.push(Number(child.id)); stack.push(Number(child.id)); }
          }
        }
        return ids;
      };
      for (const other of others) {
        const ids = descendants(other);
        for (const id of ids) {
          db.prepare("UPDATE instance_bom SET tier = tier + 1, updated_at = datetime('now') WHERE id = ?").run(id);
        }
        db.prepare("UPDATE instance_bom SET parent_id = ?, updated_at = datetime('now') WHERE id = ?").run(selected.id, other.id);
        log.merged += 1;
      }
      rootId = Number(selected.id);
    }
  });
  tx();
  const after = diagnose(db, instanceId, bomType);
  audit.record(db, body.req || { headers: {}, user: body.user || null }, {
    action: "bom.repair_apply",
    resource_type: "equipment_instance",
    resource_id: instanceId,
    before: { root_count: before.root_count, parentless: before.parentless_count, orphans: before.orphan_count, score: before.health.score },
    after: { root_count: after.root_count, parentless: after.parentless_count, orphans: after.orphan_count, score: after.health.score, ...log },
    diff_summary: `BOM 缺根修复：根节点 ${before.root_count}→${after.root_count}，健康分 ${before.health.score}→${after.health.score}`,
  });
  return { ok: true, instance_id: instanceId, applied_actions: [...requested], log, before: { root_count: before.root_count, health_score: before.health.score }, after, health: after.health, validation: after.validation };
}

function registerRepairRoutes(app, db) {
  app.get("/api/equipment_instances/:id/bom/repair/preview", (req, res, next) => {
    try { res.json(diagnose(db, Number(req.params.id), req.query.bom_type || 'EBOM')); } catch (error) { next(error); }
  });
  app.post("/api/equipment_instances/:id/bom/repair/apply", (req, res, next) => {
    try {
      res.json(applyRepair(db, Number(req.params.id), { ...(req.body || {}), bom_type: req.body?.bom_type || 'EBOM', req, user: req.user || null }));
    } catch (error) { next(error); }
  });
}

module.exports = { registerRepairRoutes, diagnose, applyRepair };
