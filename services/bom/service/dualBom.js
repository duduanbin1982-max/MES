"use strict";
// services/bom/service/dualBom.js
// 2026-11-07 EBOM/MBOM 双 BOM：MBOM 克隆、BOM 有效性、版本 Redline 对比
const { ApiError } = require("../../../app/errors");
const audit = require("../../../app/audit");
const { ensureBomStructureColumns } = require("./schema");

const MUTABLE_FIELDS = [
  "quantity", "unit", "scrap_factor", "category", "material_grade", "surface_treatment",
  "brand_recommend", "brand_grade", "unit_price", "labor_cost", "manufacturing_cost", "weight",
  "is_alternative", "alternative_group", "alternative_priority", "operation_id", "is_phantom",
  "is_key_component", "is_wear_part", "storage_location", "notes", "version", "effective_from", "effective_to",
];

function tableColumns(db, table) {
  try { return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name)); } catch (_error) { return new Set(); }
}

function rowsForType(db, instanceId, bomType, asOf = null) {
  ensureBomStructureColumns(db);
  const columns = tableColumns(db, "instance_bom");
  const typeClause = columns.has("bom_type") ? "AND COALESCE(bom_type, 'EBOM') = ?" : "";
  const dateClause = asOf ? "AND (effective_from IS NULL OR effective_from <= ?) AND (effective_to IS NULL OR effective_to >= ?)" : "";
  const params = [instanceId, ...(typeClause ? [bomType] : []), ...(asOf ? [asOf, asOf] : [])];
  return db.prepare(`SELECT * FROM instance_bom WHERE equipment_instance_id = ? ${typeClause} ${dateClause} ORDER BY tier, id`).all(...params);
}

function registerDualBomRoutes(app, db) {
  // EBOM → MBOM：复制结构并保留来源行，后续可独立编辑制造 BOM
  app.post("/api/equipment_instances/:id/bom/clone-to-mbom", (req, res, next) => {
    try {
      ensureBomStructureColumns(db);
      const instanceId = Number(req.params.id);
      const instance = db.prepare("SELECT id, instance_code FROM equipment_instances WHERE id = ?").get(instanceId);
      if (!instance) throw ApiError.notFound("装备实例不存在");
      const ebom = rowsForType(db, instanceId, "EBOM");
      if (!ebom.length) throw ApiError.validation("当前没有 EBOM，无法生成 MBOM");
      const existing = db.prepare("SELECT COUNT(*) c FROM instance_bom WHERE equipment_instance_id = ? AND COALESCE(bom_type,'EBOM') = 'MBOM'").get(instanceId).c;
      if (existing > 0) throw ApiError.conflict(`MBOM 已存在 ${existing} 行；请先清理或在 MBOM 上直接维护`);
      const columns = tableColumns(db, "instance_bom");
      const fields = [
        "equipment_instance_id", "parent_id", "tier", "node_type", "level_code", "sort_order", "view_flags",
        "version", "eco_id", "effective_from", "effective_to", "bom_type", "source_bom_id", "material_id",
        "part_number", "quantity", "unit", "scrap_factor", "category", "material_grade", "surface_treatment",
        "brand_recommend", "brand_grade", "is_alternative", "alternative_group", "alternative_priority",
        "operation_id", "is_phantom", "is_key_component", "is_wear_part", "storage_location", "weight",
        "unit_price", "labor_cost", "manufacturing_cost", "notes", "created_by",
      ].filter((field) => columns.has(field));
      const insert = db.prepare(`INSERT INTO instance_bom (${fields.join(",")}) VALUES (${fields.map(() => "?").join(",")})`);
      const map = new Map();
      let created = 0;
      const tx = db.transaction(() => {
        for (const row of ebom) {
          const clone = { ...row, bom_type: "MBOM", source_bom_id: row.id, created_by: req.user?.uid || null };
          clone.parent_id = row.parent_id ? (map.get(Number(row.parent_id)) || null) : null;
          const values = fields.map((field) => (field === "created_by" ? row.created_by || req.user?.uid || null : clone[field]));
          const result = insert.run(...values);
          map.set(Number(row.id), Number(result.lastInsertRowid));
          created += 1;
        }
      });
      tx();
      audit.record(db, req, {
        action: "bom.mbom_clone", resource_type: "equipment_instance", resource_id: instanceId,
        after: { created, source_rows: ebom.length }, diff_summary: `由 EBOM 生成 MBOM，共 ${created} 行`,
      });
      res.json({ ok: true, instance_id: instanceId, created, source_rows: ebom.length });
    } catch (error) { next(error); }
  });

  // 有效性：按日期查询生效 BOM（EBOM/MBOM 均可）
  app.get("/api/equipment_instances/:id/bom/effectivity", (req, res, next) => {
    try {
      const instanceId = Number(req.params.id);
      const bomType = String(req.query.bom_type || "EBOM").toUpperCase();
      const asOf = String(req.query.as_of || new Date().toISOString().slice(0, 10));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw ApiError.validation("as_of 格式必须是 YYYY-MM-DD");
      const active = rowsForType(db, instanceId, bomType, asOf);
      const all = rowsForType(db, instanceId, bomType);
      const activeIds = new Set(active.map((row) => Number(row.id)));
      const inactive = all.filter((row) => !activeIds.has(Number(row.id))).map((row) => ({
        id: row.id, part_number: row.part_number, effective_from: row.effective_from, effective_to: row.effective_to,
      }));
      let versions = [];
      try {
        versions = db.prepare(`SELECT id, version, bom_type, effective_from, effective_to, status, row_count FROM bom_version_releases
          WHERE equipment_instance_id = ? AND COALESCE(bom_type,'EBOM') = ? AND status = 'released'
            AND (effective_from IS NULL OR effective_from <= ?) AND (effective_to IS NULL OR effective_to >= ?)
          ORDER BY id DESC`).all(instanceId, bomType, asOf, asOf);
      } catch (_error) { versions = []; }
      let releasedCount = 0;
      try { releasedCount = db.prepare("SELECT COUNT(*) c FROM bom_version_releases WHERE equipment_instance_id = ? AND COALESCE(bom_type,'EBOM') = ? AND status = 'released'").get(instanceId, bomType).c; } catch (_error) { releasedCount = 0; }
      const activeCount = releasedCount > 0 ? Number(versions[0]?.row_count || 0) : active.length;
      res.json({ instance_id: instanceId, bom_type: bomType, as_of: asOf, active_count: activeCount, inactive_count: Math.max(0, all.length - activeCount), inactive, versions, active_version: versions[0] || null, rows: active });
    } catch (error) { next(error); }
  });

  // 版本 Redline：对比两次发布的快照（结构/字段/数量/成本差异）
  app.get("/api/equipment_instances/:id/bom/redline", (req, res, next) => {
    try {
      const instanceId = Number(req.params.id);
      const fromId = Number(req.query.from_release_id);
      const toId = Number(req.query.to_release_id);
      if (!fromId || !toId) throw ApiError.validation("from_release_id 与 to_release_id 必填");
      const releases = require("./versions");
      const from = releases.getRelease(db, instanceId, fromId);
      const to = releases.getRelease(db, instanceId, toId);
      if (String(from.bom_type || "EBOM") !== String(to.bom_type || "EBOM")) {
        throw ApiError.validation("仅支持同类型 BOM 版本对比");
      }
      const fromRows = Array.isArray(from.snapshot) ? from.snapshot : [];
      const toRows = Array.isArray(to.snapshot) ? to.snapshot : [];
      const byId = (rows) => new Map(rows.map((row) => [Number(row.id), row]));
      const fromMap = byId(fromRows);
      const toMap = byId(toRows);
      const added = toRows.filter((row) => !fromMap.has(Number(row.id)));
      const removed = fromRows.filter((row) => !toMap.has(Number(row.id)));
      const changed = [];
      for (const row of toRows) {
        const old = fromMap.get(Number(row.id));
        if (!old) continue;
        const fields = MUTABLE_FIELDS.filter((field) => String(old[field] ?? "") !== String(row[field] ?? ""));
        const moved = Number(old.parent_id || 0) !== Number(row.parent_id || 0);
        if (fields.length || moved) changed.push({ id: row.id, part_number: row.part_number, moved, fields });
      }
      const amountDelta = toRows.reduce((sum, row) => sum + Number(row.quantity || 0) * Number(row.unit_price || 0), 0)
        - fromRows.reduce((sum, row) => sum + Number(row.quantity || 0) * Number(row.unit_price || 0), 0);
      res.json({
        instance_id: instanceId, bom_type: from.bom_type || "EBOM",
        from: { id: from.id, version: from.version, released_at: from.released_at },
        to: { id: to.id, version: to.version, released_at: to.released_at },
        summary: {
          added: added.length, removed: removed.length, changed: changed.length,
          moved: changed.filter((row) => row.moved).length,
          quantity_delta: Math.round((toRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0) - fromRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0)) * 100) / 100,
          amount_delta: Math.round(amountDelta * 100) / 100,
        },
        added: added.slice(0, 500), removed: removed.slice(0, 500), changed: changed.slice(0, 500),
      });
    } catch (error) { next(error); }
  });
}

module.exports = { registerDualBomRoutes, rowsForType };
