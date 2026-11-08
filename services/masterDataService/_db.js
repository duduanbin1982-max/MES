"use strict";
// 表结构缓存与白名单校验（原 masterDataService.js 的 register() 前置逻辑）

module.exports = function createDbHelpers(db) {
  const tableCache = new Map();
  const columnCache = new Map();
  const scanErrors = [];

  function tableExists(name) {
    if (!tableCache.has(name)) {
      tableCache.set(name, !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
    }
    return tableCache.get(name);
  }

  const MDM_ALLOWED_TABLES = new Set(["mdm_issue_waivers", "mdm_audit_log", "materials", "documents", "instance_bom", "bom_nodes", "equipment_bom", "bom_items", "bom_components", "purchase_orders", "purchase_suppliers", "work_orders", "inventory", "suppliers", "erp_cost_ledger", "equipment_instances", "workstations", "process_nodes", "users"]);

  function columns(table) {
    if (!MDM_ALLOWED_TABLES.has(table)) throw new Error("Invalid table name: " + table);
    if (!columnCache.has(table)) {
      columnCache.set(table, tableExists(table) ? new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)) : new Set());
    }
    return columnCache.get(table);
  }

  function has(table, col) {
    return columns(table).has(col);
  }

  function recordError(sql, error) {
    if (scanErrors.length >= 30) return;
    const message = String(error && error.message || error);
    if (!scanErrors.some((item) => item.message === message)) scanErrors.push({ sql: String(sql).slice(0, 240), message });
  }

  function all(sql, params = []) {
    try { return db.prepare(sql).all(params); } catch (error) { recordError(sql, error); return []; }
  }

  function get(sql, params = []) {
    try { return db.prepare(sql).get(params) || null; } catch (error) { recordError(sql, error); return null; }
  }

  return { tableCache, columnCache, tableExists, MDM_ALLOWED_TABLES, columns, has, all, get, scanErrors };
};
