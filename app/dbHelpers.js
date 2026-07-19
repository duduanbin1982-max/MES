"use strict";

function makeDbHelpers(db) {
  if (!db || typeof db.prepare !== "function") {
    throw new TypeError("makeDbHelpers requires a database with prepare(sql)");
  }
  return {
    all: (sql, params = []) => db.prepare(sql).all(params),
    get: (sql, params = []) => db.prepare(sql).get(params),
    run: (sql, params = []) => db.prepare(sql).run(params),
  };
}

module.exports = { makeDbHelpers };
