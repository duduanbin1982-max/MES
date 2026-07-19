"use strict";

function safeBool(value) {
  return value ? 1 : 0;
}

function createDbAccess(db) {
  return {
    all: (sql, params = []) => db.prepare(sql).all(params),
    get: (sql, params = []) => db.prepare(sql).get(params),
    run: (sql, params = []) => db.prepare(sql).run(params),
  };
}

module.exports = { safeBool, createDbAccess };
