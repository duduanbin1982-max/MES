"use strict";

const {
  validateNode,
  validateTree,
  validateMinimumThreeLevel,
  computeHealth,
  buildBusinessViews,
  calcCost,
  compareVersions,
  parseCsv,
} = require("./bom/core");
const { registerBomRoutes } = require("./bom/service/routes");

module.exports = {
  register: registerBomRoutes,
  validateNode,
  validateTree,
  validateMinimumThreeLevel,
  computeHealth,
  buildBusinessViews,
  calcCost,
  compareVersions,
  parseCsv,
};
