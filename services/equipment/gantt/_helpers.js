"use strict";
const { wrap } = require('../../../middleware/asyncHandler');
// services/equipment/gantt/_helpers.js
// 共享 db helper (all/get/run/wrap)
// Author: 三狗子 | Date: 2026-06-24

const all = (db, sql, params = []) => db.prepare(sql).all(params);
const get = (db, sql, params = []) => db.prepare(sql).get(params);
const run = (db, sql, params = []) => db.prepare(sql).run(params);


module.exports = { all, get, run, wrap };
