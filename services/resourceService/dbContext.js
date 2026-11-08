"use strict";

function createDbContext(db) {
  return {
    db,
    all: (sql, ...params) => db.prepare(sql).all(...params),
    get: (sql, ...params) => db.prepare(sql).get(...params),
    run: (sql, ...params) => db.prepare(sql).run(...params),
  };
}

module.exports = { createDbContext };
