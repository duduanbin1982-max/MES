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

function register(app, db) {
  runMigration(db);
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
}

module.exports = { register };
