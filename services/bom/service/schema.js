"use strict";

function tableColumns(db, tableName) {
  try {
    return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => row.name));
  } catch (_error) {
    return new Set();
  }
}

function hasColumns(db, tableName, columns) {
  const cols = tableColumns(db, tableName);
  return columns.every((col) => cols.has(col));
}

module.exports = {
  tableColumns,
  hasColumns,
};
