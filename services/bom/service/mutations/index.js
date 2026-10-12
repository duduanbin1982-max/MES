"use strict";

const { ApiError } = require("../../../../app/errors");
const {
  validateNode,
  normalizeInt,
  normalizeFloat,
  normalizeBool,
  cleanText,
} = require("../../core");
const { tableColumns, ensureBomStructureColumns } = require("../schema");

const { assertNoCycle, deriveTier, getParent, inferNodeType, isDescendant, nextSortOrder } = require("./_tree");
const { buildValidationContext, recomputeStructureMetadata, resolveMaterialId, rowToSafeNode } = require("./_meta");
const { createMinimumBomSkeleton, insertBomNode } = require("./_insert");
const { deleteBomNodeCascade, moveBomNode, updateBomNode } = require("./_update");

module.exports = {
  buildValidationContext,
  rowToSafeNode,
  recomputeStructureMetadata,
  createMinimumBomSkeleton,
  resolveMaterialId,
  insertBomNode,
  updateBomNode,
  moveBomNode,
  deleteBomNodeCascade,
};
