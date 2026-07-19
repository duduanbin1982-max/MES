"use strict";

const { ApiError } = require("../app/errors");
const { makeDbHelpers } = require("./material/core");
const { createAccessGuards } = require("./materialService/access");
const { registerCatalogRoutes } = require("./materialService/catalogRoutes");
const { registerImportRoutes } = require("./materialService/importRoutes");
const { registerInventoryRoutes } = require("./materialService/inventoryRoutes");
const { registerLotRoutes } = require("./materialService/lotRoutes");

function register(app, db) {
  const helpers = makeDbHelpers(db);
  const guards = createAccessGuards(ApiError);
  const dependencies = { app, db, helpers, guards, ApiError };

  registerLotRoutes(dependencies);
  registerInventoryRoutes(dependencies);
  registerCatalogRoutes(dependencies);
  registerImportRoutes(dependencies);
}

module.exports = { register };
