"use strict";
// services/supplierCollaboration/index.js
// 对外公共面：与原 services/supplierCollaborationService.js 的 5 个导出保持一致，
// 另附少量内部件（scoreSupplier/addColumn/工具函数）便于测试与排障。
//
//   const svc = require("./supplierCollaboration");
//   svc.register(app, db);

const { all, get, run, nextNo, parseJson } = require("./_helpers");
const { ensureSchema, addColumn, ALLOWED_TABLES } = require("./schema");
const { scoreSupplier } = require("./scoring");
const {
  createNcr,
  findReceiving,
  getReceivingContext,
  applyIncomingInspectionResult,
} = require("./inspection");
const { register } = require("./routes");

module.exports = {
  // 原公共面（顺序与原 module.exports 一致）
  applyIncomingInspectionResult,
  ensureSchema,
  findReceiving,
  getReceivingContext,
  register,
  // 附带内部件
  scoreSupplier,
  createNcr,
  addColumn,
  ALLOWED_TABLES,
  all,
  get,
  run,
  nextNo,
  parseJson,
};
