"use strict";

const { wrap } = require("../middleware/asyncHandler");
const audit = require("../app/audit");
const { createCaseStore } = require("./delivery/caseStore");
const { createDeliveryDbContext } = require("./delivery/dbContext");
const { createEscalationService } = require("./delivery/escalation");
const { runMigration } = require("./delivery/migration");
const { createReadModel } = require("./delivery/readModel");
const { registerDeliveryRoutes } = require("./delivery/routes");
const { createSourceSync } = require("./delivery/sourceSync");
const { initDeliveryRecordsSchema, registerDeliveryRecordRoutes } = require("./delivery/records");

function register(app, db) {
  runMigration(db);
  // 2026-11-02：交付单 / 验收单（补「交付/验收无单据表」断点）
  initDeliveryRecordsSchema(db);
  const dbContext = createDeliveryDbContext(db);
  const caseStore = createCaseStore({ db, audit, ...dbContext });
  const escalation = createEscalationService({ ...dbContext, ...caseStore });
  escalation.ensureDefaultRules();
  const sourceSync = createSourceSync({ db, ...dbContext });
  const readModel = createReadModel({
    db,
    tableExists: dbContext.tableExists,
    has: dbContext.has,
    columns: dbContext.columns,
    safeAll: dbContext.safeAll,
    safeGet: dbContext.safeGet,
    enrichEscalation: escalation.enrichEscalation,
  });

  registerDeliveryRoutes(app, {
    wrap,
    readModel,
    safeGet: dbContext.safeGet,
    caseFor: caseStore.caseFor,
    ensureCase: caseStore.ensureCase,
    addAction: caseStore.addAction,
    actionsFor: caseStore.actionsFor,
    actor: caseStore.actor,
    today: caseStore.today,
    syncSourceAssign: sourceSync.syncSourceAssign,
    syncSourceStart: sourceSync.syncSourceStart,
    syncSourceClose: sourceSync.syncSourceClose,
    syncSourceReopen: sourceSync.syncSourceReopen,
    restartPurchaseFollowup: sourceSync.restartPurchaseFollowup,
    sendExceptionNotice: escalation.sendExceptionNotice,
    alreadyNotifiedToday: escalation.alreadyNotifiedToday,
  });

  registerDeliveryRecordRoutes(app, db);
}

module.exports = { register };
