"use strict";


const logger = require("../../../../app/logger").createLogger("delivery");

function collectSupplyExceptions({ ctx, instanceById, items, now, pushException }) {
  const { db, tableExists, has, safeAll } = ctx;

  if (tableExists("inventory") && has("inventory", "available_qty") && has("inventory", "safety_stock")) {
    const rows = safeAll(`
      SELECT i.*, m.material_code, m.material_name
      FROM inventory i
      LEFT JOIN materials m ON m.id = i.material_id
      WHERE COALESCE(i.available_qty, 0) < COALESCE(i.safety_stock, 0)
      LIMIT 100
    `);
    for (const row of rows) {
      pushException(items, {
        id: `low_stock_${row.id || row.material_id}`,
        type: "low_stock",
        severity: "warning",
        title: `库存低于安全线 ${row.material_code || row.material_id}`,
        message: `${row.material_name || "物料"} 可用 ${row.available_qty || 0}，安全库存 ${row.safety_stock || 0}`,
        source: "inventory",
        source_path: "/materials?tab=inv",
        action_label: "查看库存",
      });
    }
  }

  try {
    const masterDataService = require("../../../masterDataService");
    if (masterDataService && typeof masterDataService.collectForException === "function") {
      for (const row of masterDataService.collectForException(db).issues.slice(0, 200)) {
        pushException(items, {
          id: `mdm_${row.id}`,
          type: `mdm_${row.domain}`,
          severity: row.severity,
          title: row.title,
          message: row.detail,
          source: row.source || "master_data",
          source_path: row.source_path || "/mdm",
          created_at: null,
          action_label: "治理主数据",
        });
      }
    }
  } catch (error) {
    logger.warn('[delivery] 主数据异常读取失败:', error.message);
  }

  if (tableExists("purchase_orders") && has("purchase_orders", "expected_date")) {
    const rows = safeAll(`
      SELECT *
      FROM purchase_orders
      WHERE expected_date IS NOT NULL
        AND expected_date < ?
        AND COALESCE(status, '') NOT IN ('received', 'closed', 'cancelled')
      ORDER BY expected_date ASC
      LIMIT 100
    `, [now]);
    for (const row of rows) {
      const instanceId = row.equipment_instance_id || row.instance_id || null;
      const instance = instanceById.get(Number(instanceId)) || {};
      pushException(items, {
        id: `po_overdue_${row.id}`,
        type: "purchase_delay",
        severity: "high",
        title: `采购延期 ${row.po_no || row.id}`,
        message: `${row.supplier_name || "供应商"} 预计到货已超期`,
        instance_id: instanceId,
        instance_code: instance.instance_code,
        due_at: row.expected_date,
        source: "purchase_orders",
        source_path: "/purchase",
        action_label: "采购跟催",
      });
    }
  }
}

module.exports = { collectSupplyExceptions };
