"use strict";

const { makeDbHelpers } = require("../../app/dbHelpers");
const { ApiError } = require("../../app/errors");
const { wrap } = require("../../middleware/asyncHandler");
const { LIFE_CYCLE } = require("./catalog");
const { registerCatalogRoutes } = require("./catalogRoutes");
const { registerLedgerRoutes } = require("./ledgerRoutes");
const { createCodeGenerator } = require("./codeGenerator");
const { createInstanceFactory } = require("./instanceFactory");
const { registerInstanceRoutes } = require("./instanceRoutes");
const { createEquipmentOverview } = require("./overview");
const { initEquipmentInstanceEnhancements } = require("./schema");
const { initInstanceProgressModel } = require("./progressModel");
const { registerTemplateRoutes } = require("./templateRoutes");
const { createTemplateStore } = require("./templateStore");
const { createCodeAllocator } = require("../codingRulesService");

function register(app, db) {
  initEquipmentInstanceEnhancements(db);
  // 2026-11-02：项目进度回写模型（视图 + 触发器），修「进度不回写」断点
  initInstanceProgressModel(db);
  const helpers = makeDbHelpers(db);
  const codeAllocator = createCodeAllocator(db);
  const codeGenerator = createCodeGenerator(helpers.get, {
    nextRuleCode: (rule, context) => codeAllocator.nextCode(rule, context),
    previewRuleCode: (rule, context) => codeAllocator.nextCode(rule, context, { preview: true }),
    describeRule: (rule) => codeAllocator.describeRule(rule),
  });
  const ruleFor = (rule) => codeAllocator.getRule(rule);
  const validateInstanceCode = (code, context) => {
    const rule = ruleFor("equipment_instance");
    if (!rule || !String(code || "").toUpperCase().startsWith(String(rule.prefix || "").toUpperCase())) return true;
    return codeAllocator.validateCode("equipment_instance", code, context);
  };
  const templateStore = createTemplateStore({ get: helpers.get, ApiError });
  const instanceFactory = createInstanceFactory({
    db,
    ...helpers,
    ApiError,
    nextInstanceCode: codeGenerator.nextInstanceCode,
    reserveInstanceCode: (code, context) => codeAllocator.reserveCode("equipment_instance", code, context),
    consumeInstanceReservation: (token) => codeAllocator.consumeReservation(token, "equipment_instance"),
    validateInstanceCode,
    templateStore,
  });
  const buildOverview = createEquipmentOverview({ db, ApiError, lifecycle: LIFE_CYCLE });

  registerTemplateRoutes({
    app,
    wrap,
    ...helpers,
    ApiError,
    nextTemplateCode: codeGenerator.nextTemplateCode,
    reserveTemplateCode: (code, context) => codeAllocator.reserveCode("equipment_template", code, context),
    templateStore,
  });
  registerInstanceRoutes({
    app,
    db,
    wrap,
    ...helpers,
    ApiError,
    lifecycle: LIFE_CYCLE,
    nextInstanceCode: codeGenerator.nextInstanceCode,
    previewInstanceCode: codeGenerator.previewInstanceCode,
    describeInstanceRule: codeGenerator.describeInstanceRule,
    reserveInstanceCode: (context) => codeAllocator.reserve("equipment_instance", context),
    createInstance: instanceFactory.createInstance,
    ensureNotFrozen: instanceFactory.ensureNotFrozen,
    buildOverview,
  });
  registerCatalogRoutes({ app, wrap, ...helpers, ApiError });
  registerLedgerRoutes({ app, wrap, ...helpers, ApiError });
}

module.exports = { register };
