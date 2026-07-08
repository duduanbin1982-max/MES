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
  deleteBomNodeCascade,
} = require("./mutations");
const { importBomCsv } = require("./importer");
const {
  getActiveUsers,
  updateRiskOwner,
  updateRiskEta,
  createPurchaseFollowup,
} = require("./riskWorkflow");

function registerBomRoutes(app, db) {
  app.post("/api/equipment_instances/:id/bom/init-minimum", (req, res, next) => {
    try {
      const created = createMinimumBomSkeleton(db, req.params.id);
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
    res.json(buildBomLevelsResponse(db, req.params.id));
  });

  app.get("/api/equipment_instances/:id/bom/cost", (req, res) => {
    const items = calcCost(db, req.params.id);
    res.json({ items, total_cost: items.reduce((sum, item) => sum + (item.cost || 0), 0) });
  });

  app.get("/api/equipment_instances/:id/bom/health", (req, res) => {
    const rows = db.prepare("SELECT * FROM instance_bom WHERE equipment_instance_id = ? ORDER BY tier, id").all(req.params.id);
    res.json(computeHealth(db, req.params.id, rows));
  });

  app.get("/api/equipment_instances/:id/bom/business-views", (req, res) => {
    const rows = selectBomRows(db, req.params.id);
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
    const rows = db.prepare("SELECT * FROM instance_bom WHERE equipment_instance_id = ? ORDER BY tier, id").all(req.params.id);
    const validation = validateTree(db, req.params.id, rows);
    const health = computeHealth(db, req.params.id, rows);
    res.json({ ...validation, health });
  });

  app.post("/api/equipment_instances/:id/bom", (req, res, next) => {
    try {
      res.json(insertBomNode(db, req.params.id, req.body || {}, req.user?.uid || null));
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/bom/:id", (req, res, next) => {
    try {
      res.json(updateBomNode(db, req.params.id, req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/bom/:id", (req, res, next) => {
    try {
      res.json(deleteBomNodeCascade(db, req.params.id));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/equipment_instances/:id/bom/import", (req, res, next) => {
    try {
      res.json(importBomCsv(db, req.params.id, req.body?.csv, req.user?.uid || null));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/equipment_instances/:id/bom/compare", (req, res) => {
    const { v1 = "A0", v2 = "A1" } = req.query || {};
    res.json(compareVersions(db, req.params.id, v1, v2));
  });
}

module.exports = {
  registerBomRoutes,
};
