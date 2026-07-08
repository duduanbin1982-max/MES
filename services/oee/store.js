"use strict";

function createOeeStore(db) {
  return {
    all(sql, params = []) {
      return db.prepare(sql).all(params);
    },
    get(sql, params = []) {
      return db.prepare(sql).get(params);
    },
    run(sql, params = []) {
      return db.prepare(sql).run(params);
    },
  };
}

module.exports = { createOeeStore };
