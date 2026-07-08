"use strict";

function createTraceStore(db) {
  return {
    all(sql, params = []) {
      return db.prepare(sql).all(params);
    },
    get(sql, params = []) {
      return db.prepare(sql).get(params);
    },
  };
}

module.exports = { createTraceStore };
