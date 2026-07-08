"use strict";
const { wrap } = require('../../../middleware/asyncHandler');
// services/cost/keyComponentPrices/_helpers.js
// 关键件合同价 service 的 db helpers + 时间工具 + 角色守卫
// Author: 三狗子 | Date: 2026-06-24

const { requireRole } = require("../../../middleware/auth");

const nowISO = () => new Date().toISOString().slice(0, 19).replace("T", " ");
const todayISO = () => new Date().toISOString().slice(0, 10);

function makeHelpers(db) {
  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const get = (sql, ...p) => db.prepare(sql).get(...p);
  const run = (sql, ...p) => db.prepare(sql).run(...p);
  
  // 写 = admin 或 foreman
  const writeRoles = requireRole("admin", "foreman");
  return { all, get, run, wrap, writeRoles };
}

module.exports = { makeHelpers, nowISO, todayISO };