"use strict";

const ALLOWED_TABLES = new Set([
  "qc_ncr",
  "ncr_reports",
  "shortage_cases",
  "equipment_instances",
  "oee_shift_log",
  "project_cost_entries",
  "erp_cost_ledger",
  "documents",
  "instance_bom",
  "process_nodes",
  "purchase_order_items",
  "purchase_orders",
  "purchase_tracking",
  "qc_inspections",
  "work_orders",
  "andon_alerts",
  "instance_eco",
  "inventory",
  "acceptance_checklists",
  // 2026-10-11 P0 修复: 9859cda 加这道守卫时名单不全, 导致 /api/delivery/overview
  // 与 /api/delivery/projects/:id 在生产上直接 500。下面这些是 delivery 读模型
  // 真实会传给 columns()/has() 的表:
  //   work_order_operations —— projectWorkflow/projectLineage 里
  //     ["work_order_operations","process_reports","operation_reports","process_work_reports"]
  //     .find(tableExists) 的命中项 (另外 3 个目前不存在, 一并登记以防将来建表即崩)
  //   materials/suppliers/users/workstations —— 子读模型的 join 与权限过滤
  "work_order_operations",
  "process_reports",
  "operation_reports",
  "process_work_reports",
  "materials",
  "suppliers",
  "users",
  "workstations",
  // 同一类隐患: projectWorkflow/projectLineage 里的候选表数组
  //   ["project_cost_entries","cost_rollups","cost_allocations","project_costs","cost_items"]
  //   ["acceptance_checklists","acceptance_records","customer_acceptance","tbm_acceptance"]
  // 目前只有第一项存在, 但候选一旦被建出来就会走 has()/columns();
  // tests/deliveryDbContextWhitelist.test.js DBCTX.4 会把这类数组全部纳入守卫。
  "cost_rollups",
  "cost_allocations",
  "project_costs",
  "cost_items",
  "acceptance_records",
  "customer_acceptance",
  "tbm_acceptance",
]);

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
    if (!ALLOWED_TABLES.has(table)) throw new Error("Invalid table name: " + table);
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

module.exports = { createDeliveryDbContext, ALLOWED_TABLES };
