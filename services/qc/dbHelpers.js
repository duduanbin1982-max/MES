"use strict";

function createDbHelpers(db) {
  return {
    all: (sql, params = []) => db.prepare(sql).all(params),
    get: (sql, params = []) => db.prepare(sql).get(params),
    run: (sql, params = []) => db.prepare(sql).run(params),
  };
}

module.exports = { createDbHelpers };
