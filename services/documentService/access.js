"use strict";
// 2026-11-07（文档审计）：文档列表/详情/下载的数据范围过滤
const { loadScope } = require("../../app/dataScope");

function scopeContext(req, db) {
  try {
    if (req && typeof req.scope === "function") return req.scope();
    return loadScope(db, req?.user?.uid || req?.user?.sub || null);
  } catch (_error) {
    return { scope: "all", config: {} };
  }
}

function scopeWhere(req, db, alias = "d") {
  const ctx = scopeContext(req, db);
  if (!ctx || !ctx.scope || ctx.scope === "all") return { clause: "", params: [] };
  if (ctx.scope === "instance") {
    const ids = (ctx.config && (ctx.config.project_ids?.length ? ctx.config.project_ids : ctx.config.instance_ids)) || [];
    const normalized = ids.map(Number).filter((value) => Number.isInteger(value) && value > 0);
    if (!normalized.length) return { clause: "1 = 0", params: [] };
    return { clause: `${alias}.equipment_instance_id IN (${normalized.map(() => "?").join(",")})`, params: normalized };
  }
  if (ctx.scope === "self") {
    const uid = req?.user?.uid || req?.user?.sub || 0;
    return { clause: `(${alias}.uploaded_by = ? OR ${alias}.issued_by = ?)`, params: [uid, uid] };
  }
  if (ctx.scope === "workshop") {
    const ids = (ctx.config && ctx.config.subsystem_ids) || [];
    const normalized = ids.map(Number).filter((value) => Number.isInteger(value) && value > 0);
    if (!normalized.length) return { clause: "1 = 0", params: [] };
    try {
      return {
        clause: `${alias}.equipment_instance_id IN (SELECT id FROM equipment_instances WHERE subsystem_id IN (${normalized.map(() => "?").join(",")}))`,
        params: normalized,
      };
    } catch (_error) { return { clause: "1 = 0", params: [] }; }
  }
  // workstation/warehouse 暂不支持文档范围，安全起见拒绝
  return { clause: "1 = 0", params: [] };
}

function canAccessDocument(req, db, row) {
  if (!row) return false;
  const ctx = scopeContext(req, db);
  if (!ctx || !ctx.scope || ctx.scope === "all") return true;
  if (ctx.scope === "instance") {
    const ids = (ctx.config && (ctx.config.project_ids?.length ? ctx.config.project_ids : ctx.config.instance_ids)) || [];
    return ids.map(Number).includes(Number(row.equipment_instance_id));
  }
  if (ctx.scope === "self") {
    const uid = req?.user?.uid || req?.user?.sub || null;
    return Number(row.uploaded_by) === Number(uid) || Number(row.issued_by) === Number(uid);
  }
  if (ctx.scope === "workshop") {
    const ids = (ctx.config && ctx.config.subsystem_ids) || [];
    if (!ids.length) return false;
    try {
      const instance = db.prepare("SELECT subsystem_id FROM equipment_instances WHERE id = ?").get(row.equipment_instance_id);
      return Boolean(instance && ids.map(Number).includes(Number(instance.subsystem_id)));
    } catch (_error) { return false; }
  }
  return false;
}

module.exports = { scopeContext, scopeWhere, canAccessDocument };
