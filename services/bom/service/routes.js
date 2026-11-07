"use strict";

const {
  validateTree,
  computeHealth,
  buildBusinessViews,
  calcCost,
  compareVersions,
} = require("../core");
const { selectBomRows, buildBomListResponse, buildBomLevelsResponse } = require("./readModel");
const { getImportTemplate } = require("./importTemplate");
const {
  createMinimumBomSkeleton,
  insertBomNode,
  updateBomNode,
  moveBomNode,
  deleteBomNodeCascade,
  recomputeStructureMetadata,
} = require("./mutations");
const { ensureBomStructureColumns } = require("./schema");
const { importBomCsv } = require("./importer");
const audit = require("../../../app/audit");
const versions = require("./versions");
const { registerRepairRoutes } = require("./repair");
const { registerDualBomRoutes } = require("./dualBom");
const {
  getActiveUsers,
  updateRiskOwner,
  updateRiskEta,
  createPurchaseFollowup,
} = require("./riskWorkflow");

function registerBomRoutes(app, db) {
  ensureBomStructureColumns(db);
  registerRepairRoutes(app, db);
  registerDualBomRoutes(app, db);
  try {
    const ids = db.prepare("SELECT DISTINCT equipment_instance_id AS id FROM instance_bom").all();
    for (const row of ids) recomputeStructureMetadata(db, row.id);
  } catch (_error) {
    // schema may be absent in isolated tests
  }

  app.post("/api/equipment_instances/:id/bom/init-minimum", (req, res, next) => {
    try {
      const created = createMinimumBomSkeleton(db, req.params.id);
      audit.record(db, req, {
        action: "bom.init_minimum",
        resource_type: "bom",
        resource_id: req.params.id,
        after: created,
        diff_summary: `生成最低三级 BOM 骨架（实例 ${req.params.id}）`,
      });
      res.json({ ok: true, message: "已生成最低三级 BOM 骨架", created });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/equipment_instances/:id/bom/import-template", (_req, res) => {
    res.json(getImportTemplate());
  });

  app.get("/api/equipment_instances/:id/bom", (req, res) => {
    res.json(buildBomListResponse(db, req.params.id, req.query || {}));
  });

  app.get("/api/equipment_instances/:id/bom/levels", (req, res) => {
    res.json(buildBomLevelsResponse(db, req.params.id, req.query.bom_type || "EBOM", req.query.as_of || null));
  });

  app.get("/api/equipment_instances/:id/bom/cost", (req, res) => {
    const items = calcCost(db, req.params.id, req.query.bom_type || "EBOM");
    res.json({ items, total_cost: items.reduce((sum, item) => sum + (item.cost || 0), 0) });
  });

  app.get("/api/equipment_instances/:id/bom/health", (req, res) => {
    const rows = selectBomRows(db, req.params.id, req.query.bom_type || "EBOM");
    res.json(computeHealth(db, req.params.id, rows));
  });

  app.get("/api/equipment_instances/:id/bom/business-views", (req, res) => {
    const rows = selectBomRows(db, req.params.id, req.query.bom_type || "EBOM");
    res.json(buildBusinessViews(db, req.params.id, rows));
  });

  app.get("/api/equipment_instances/:id/bom/risk-owner-options", (_req, res) => {
    res.json({ items: getActiveUsers(db) });
  });

  app.post("/api/equipment_instances/:id/bom/risk-items/assign-owner", (req, res, next) => {
    try {
      res.json({ ok: true, result: updateRiskOwner(db, req.params.id, req.body || {}) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/equipment_instances/:id/bom/risk-items/update-eta", (req, res, next) => {
    try {
      res.json({ ok: true, result: updateRiskEta(db, req.params.id, req.body || {}) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/equipment_instances/:id/bom/risk-items/purchase-followup", (req, res, next) => {
    try {
      res.json({ ok: true, result: createPurchaseFollowup(db, req.params.id, req.body || {}, req.user?.uid || null) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/equipment_instances/:id/bom/validate", (req, res) => {
    const rows = selectBomRows(db, req.params.id, req.query.bom_type || "EBOM");
    const validation = validateTree(db, req.params.id, rows);
    const health = computeHealth(db, req.params.id, rows);
    res.json({ ...validation, health, bom_type: req.query.bom_type || "EBOM" });
  });

  app.post("/api/equipment_instances/:id/bom", (req, res, next) => {
    try {
      const created = insertBomNode(db, req.params.id, req.body || {}, req.user?.uid || null);
      audit.record(db, req, {
        action: "bom.create",
        resource_type: "bom",
        resource_id: created.id,
        after: { id: created.id, part_number: created.part_number, quantity: created.quantity, tier: created.tier },
        diff_summary: `新增 BOM 节点 #${created.id}（${created.part_number || created.material_id || "-"}）`,
      });
      res.json(created);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/bom/:id", (req, res, next) => {
    try {
      const before = db.prepare("SELECT * FROM instance_bom WHERE id = ?").get(req.params.id);
      const updated = updateBomNode(db, req.params.id, req.body || {});
      audit.record(db, req, {
        action: "bom.update",
        resource_type: "bom",
        resource_id: updated.id,
        before: before ? { part_number: before.part_number, quantity: before.quantity, unit_price: before.unit_price, parent_id: before.parent_id } : null,
        after: { part_number: updated.part_number, quantity: updated.quantity, unit_price: updated.unit_price, parent_id: updated.parent_id },
        diff_summary: `更新 BOM 节点 #${updated.id}`,
      });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/bom/:id/move", (req, res, next) => {
    try {
      const before = db.prepare("SELECT id, parent_id, tier FROM instance_bom WHERE id = ?").get(req.params.id);
      const moved = moveBomNode(db, req.params.id, req.body || {});
      audit.record(db, req, {
        action: "bom.move",
        resource_type: "bom",
        resource_id: moved.id,
        before: before || null,
        after: { id: moved.id, parent_id: moved.parent_id, tier: moved.tier },
        diff_summary: `移动 BOM 节点 #${moved.id}`,
      });
      res.json(moved);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/bom/:id", (req, res, next) => {
    try {
      const force = req.query && (req.query.force === "1" || req.query.force === "true");
      const result = deleteBomNodeCascade(db, req.params.id, { force });
      audit.record(db, req, {
        action: "bom.delete",
        resource_type: "bom",
        resource_id: req.params.id,
        after: { deleted: result.deleted, count: result.count, cleared_process_nodes: result.cleared_process_nodes },
        diff_summary: `删除 BOM 节点 #${req.params.id}（级联 ${result.count} 个${result.force ? `，解除 ${result.cleared_process_nodes} 个工序引用` : ""}）`,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/equipment_instances/:id/bom/import", (req, res, next) => {
    try {
      const result = importBomCsv(db, req.params.id, req.body?.csv, req.user?.uid || null, { allow_partial: req.body?.allow_partial, bom_type: req.body?.bom_type || "EBOM" });
      audit.record(db, req, {
        action: "bom.import",
        resource_type: "bom",
        resource_id: req.params.id,
        after: { inserted: result.inserted, errors: result.errors, total: result.total },
        diff_summary: `CSV 导入 BOM（实例 ${req.params.id}）：成功 ${result.inserted}/${result.total}，失败 ${result.errors}`,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  // 2026-11-07（BOM 审计 B-8）：版本发布 / ECO 流程
  app.get("/api/equipment_instances/:id/bom/versions", (req, res, next) => {
    try { res.json({ items: versions.listReleases(db, req.params.id) }); } catch (error) { next(error); }
  });

  app.get("/api/equipment_instances/:id/bom/versions/:releaseId", (req, res, next) => {
    try { res.json(versions.getRelease(db, req.params.id, req.params.releaseId)); } catch (error) { next(error); }
  });

  app.post("/api/equipment_instances/:id/bom/versions/release", (req, res, next) => {
    try {
      const release = versions.createRelease(db, req.params.id, req.body || {}, req.user?.uid || null, req.user || null);
      audit.record(db, req, {
        action: "bom.version.release",
        resource_type: "bom",
        resource_id: req.params.id,
        after: { version: release.version, eco_id: release.eco_id, row_count: release.row_count },
        diff_summary: `发布 BOM 版本 ${release.version}（${release.row_count} 行${release.eco_id ? `，ECO #${release.eco_id}` : ""}）`,
      });
      res.status(201).json(release);
    } catch (error) { next(error); }
  });

  app.post("/api/equipment_instances/:id/bom/versions/:releaseId/obsolete", (req, res, next) => {
    try {
      const result = versions.obsoleteRelease(db, req.params.id, req.params.releaseId, req.user?.uid || null);
      audit.record(db, req, {
        action: "bom.version.obsolete",
        resource_type: "bom",
        resource_id: req.params.id,
        after: { release_id: Number(req.params.releaseId) },
        diff_summary: `作废 BOM 版本 #${req.params.releaseId}`,
      });
      res.json(result);
    } catch (error) { next(error); }
  });

  app.get("/api/equipment_instances/:id/bom/compare", (req, res) => {
    const { v1 = "A0", v2 = "A1" } = req.query || {};
    res.json(compareVersions(db, req.params.id, v1, v2));
  });
}

module.exports = {
  registerBomRoutes,
};
