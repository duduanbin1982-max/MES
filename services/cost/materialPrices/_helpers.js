"use strict";
const { wrap } = require('../../../middleware/asyncHandler');
// services/cost/materialPrices/_helpers.js
// 普通物料价 service 的 db helpers + 时间工具 + 角色守卫
// Author: 三狗子 | Date: 2026-06-24

const { requireRole } = require("../../../middleware/auth");

const nowISO = () => new Date().toISOString().slice(0, 19).replace("T", " ");

function makeHelpers(db) {
  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const get = (sql, ...p) => db.prepare(sql).get(...p);
  const run = (sql, ...p) => db.prepare(sql).run(...p);
  
  const writeRoles = requireRole("admin", "foreman");
  return { all, get, run, wrap, writeRoles };
}

module.exports = { makeHelpers, nowISO };