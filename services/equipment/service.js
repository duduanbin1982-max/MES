"use strict";

const { makeDbHelpers } = require("../../app/dbHelpers");
const { ApiError } = require("../../app/errors");
const { wrap } = require("../../middleware/asyncHandler");
const { LIFE_CYCLE } = require("./catalog");
const { registerCatalogRoutes } = require("./catalogRoutes");
const { createCodeGenerator } = require("./codeGenerator");
const { createInstanceFactory } = require("./instanceFactory");
const { registerInstanceRoutes } = require("./instanceRoutes");
const { createEquipmentOverview } = require("./overview");
const { initEquipmentInstanceEnhancements } = require("./schema");
const { registerTemplateRoutes } = require("./templateRoutes");
const { createTemplateStore } = require("./templateStore");

function register(app, db) {
  initEquipmentInstanceEnhancements(db);
  const helpers = makeDbHelpers(db);
  const codeGenerator = createCodeGenerator(helpers.get);
  const templateStore = createTemplateStore({ get: helpers.get, ApiError });
  const instanceFactory = createInstanceFactory({
    db,
    ...helpers,
    ApiError,
    nextInstanceCode: codeGenerator.nextInstanceCode,
    templateStore,
  });
  const buildOverview = createEquipmentOverview({ db, ApiError, lifecycle: LIFE_CYCLE });

  registerTemplateRoutes({
    app,
    wrap,
    ...helpers,
    ApiError,
    nextTemplateCode: codeGenerator.nextTemplateCode,
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
    createInstance: instanceFactory.createInstance,
    ensureNotFrozen: instanceFactory.ensureNotFrozen,
    buildOverview,
  });
  registerCatalogRoutes({ app, wrap, ...helpers, ApiError });
}

module.exports = { register };
