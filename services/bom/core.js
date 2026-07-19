"use strict";

const { createBusinessViewsBuilder } = require("./businessViews");
const { BOM_FIELDS, SELF_MADE_CATEGORIES, PURCHASED_CATEGORIES } = require("./core/constants");
const {
  normalizeInt,
  normalizeFloat,
  normalizeBool,
  cleanText,
  tableExists,
  tableColumns,
  hasColumns,
  round2,
  round3,
  earliestDate,
  uniqText,
  isActiveShortageStatus,
  isResolvedShortageStatus,
  buildChildrenMap,
  collectDescendantIds,
  statusType,
} = require("./core/utils");
const { buildTree, tierSummary, structureSummary } = require("./core/tree");
const {
  validateNode,
  validateTree,
  validateMinimumThreeLevel,
  detectDuplicates,
} = require("./core/validation");
const { calcCost, compareVersions } = require("./core/costing");
const { parseCsv } = require("./core/csv");

const { buildBusinessViews, computeHealth } = createBusinessViewsBuilder({
  PURCHASED_CATEGORIES,
  SELF_MADE_CATEGORIES,
  buildChildrenMap,
  calcCost,
  cleanText,
  detectDuplicates,
  tierSummary,
  validateTree,
  collectDescendantIds,
  earliestDate,
  hasColumns,
  isActiveShortageStatus,
  isResolvedShortageStatus,
  normalizeBool,
  normalizeFloat,
  normalizeInt,
  round2,
  round3,
  statusType,
  tableColumns,
  tableExists,
  uniqText,
});

module.exports = {
  BOM_FIELDS,
  validateNode,
  validateTree,
  validateMinimumThreeLevel,
  computeHealth,
  buildBusinessViews,
  calcCost,
  compareVersions,
  buildTree,
  tierSummary,
  structureSummary,
  parseCsv,
  normalizeInt,
  normalizeFloat,
  normalizeBool,
  cleanText,
};
