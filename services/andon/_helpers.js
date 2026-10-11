"use strict";
// services/andon/_helpers.js
// prepared statement 包装。(原 services/andonService.js 第 27-29 行)

function makeDbHelpers(db) {
  return {
    all: (sql, p = []) => db.prepare(sql).all(p),
    get: (sql, p = []) => db.prepare(sql).get(p),
    run: (sql, p = []) => db.prepare(sql).run(p),
  };
}

module.exports = { makeDbHelpers };
