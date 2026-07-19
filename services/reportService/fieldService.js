// services/reportService/fieldService.js
// 现场服务旧 API 兼容层：保留 /api/field_service、/api/spare_parts、/api/maintenance_plans，
// 数据读写统一委托给 services/fieldServiceCore，避免新旧 API 两套 SQL 漂移。
"use strict";

const { wrap } = require("../../middleware/asyncHandler");
const { ensureFieldServiceSchema } = require("../fieldServiceSchema");
const fieldServiceCore = require("../fieldServiceCore");

function runMigration(db) {
  ensureFieldServiceSchema(db);
}

function notFound(res) {
  return res.status(404).json({ error: "not found" });
}

function register(app, db) {
  runMigration(db);

  app.get("/api/field_service", wrap((req, res) => {
    res.json(fieldServiceCore.listFieldServiceTickets(db));
  }));

  app.get("/api/field_service/:id", wrap((req, res) => {
    const row = fieldServiceCore.getFieldServiceTicket(db, req.params.id);
    if (!row) return notFound(res);
    res.json(row);
  }));

  app.post("/api/field_service", wrap((req, res) => {
    res.json(fieldServiceCore.createFieldServiceTicket(db, req.body));
  }));

  app.put("/api/field_service/:id", wrap((req, res) => {
    res.json(fieldServiceCore.updateFieldServiceTicket(db, req.params.id, req.body));
  }));

  app.get("/api/spare_parts", wrap((req, res) => {
    res.json(fieldServiceCore.listSpareParts(db, req.query));
  }));

  app.get("/api/spare_parts/alerts", wrap((req, res) => {
    res.json(fieldServiceCore.listSparePartAlerts(db));
  }));

  app.get("/api/spare_parts/:id", wrap((req, res) => {
    const row = fieldServiceCore.getSparePart(db, req.params.id);
    if (!row) return notFound(res);
    res.json(row);
  }));

  app.post("/api/spare_parts", wrap((req, res) => {
    res.json(fieldServiceCore.createSparePart(db, req.body));
  }));

  app.put("/api/spare_parts/:id", wrap((req, res) => {
    res.json(fieldServiceCore.updateSparePart(db, req.params.id, req.body));
  }));

  app.delete("/api/spare_parts/:id", wrap((req, res) => {
    res.json(fieldServiceCore.deleteSparePart(db, req.params.id));
  }));

  app.get("/api/maintenance_plans", wrap((req, res) => {
    res.json(fieldServiceCore.listMaintenancePlans(db, req.query));
  }));

  app.get("/api/maintenance_plans/stats", wrap((req, res) => {
    res.json(fieldServiceCore.maintenancePlanStats(db));
  }));

  app.get("/api/maintenance_plans/:id", wrap((req, res) => {
    const row = fieldServiceCore.getMaintenancePlan(db, req.params.id);
    if (!row) return notFound(res);
    res.json(row);
  }));

  app.post("/api/maintenance_plans", wrap((req, res) => {
    res.json(fieldServiceCore.createMaintenancePlan(db, req.body));
  }));

  app.put("/api/maintenance_plans/:id", wrap((req, res) => {
    res.json(fieldServiceCore.updateMaintenancePlan(db, req.params.id, req.body));
  }));

  app.delete("/api/maintenance_plans/:id", wrap((req, res) => {
    res.json(fieldServiceCore.deleteMaintenancePlan(db, req.params.id));
  }));

  app.post("/api/maintenance_plans/:id/complete", wrap((req, res) => {
    res.json(fieldServiceCore.completeMaintenancePlan(db, req.params.id));
  }));

  console.log("[fieldService:legacy] compatibility routes registered");
}

module.exports = { register };
