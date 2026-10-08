"use strict";

function createDeliveryDbContext(db) {
  const tableCache = new Map();
  const columnCache = new Map();

  function tableExists(name) {
    if (!tableCache.has(name)) {
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
      tableCache.set(name, Boolean(row));
    }
    return tableCache.get(name);
  }

  function columns(table) {
    if (!columnCache.has(table)) {
      if (!tableExists(table)) {
        columnCache.set(table, new Set());
      } else {
        columnCache.set(table, new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name)));
      }
    }
    return columnCache.get(table);
  }

  function has(table, column) {
    return columns(table).has(column);
  }

  function safeAll(sql, params = []) {
    try {
      return db.prepare(sql).all(params);
    } catch (_error) {
      return [];
    }
  }

  function safeGet(sql, params = []) {
    try {
      return db.prepare(sql).get(params) || null;
    } catch (_error) {
      return null;
    }
  }

  function safeRun(sql, params = []) {
    try {
      return db.prepare(sql).run(params);
    } catch (_error) {
      return null;
    }
  }

  function ensureColumn(table, column, definition) {
    if (!tableExists(table) || has(table, column)) return;
    try {
      db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
      columnCache.delete(table);
    } catch (error) {
      columnCache.delete(table);
      if (!has(table, column)) throw error;
    }
  }

  return { columns, ensureColumn, has, safeAll, safeGet, safeRun, tableExists };
}

module.exports = { createDeliveryDbContext };
