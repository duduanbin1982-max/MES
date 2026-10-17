"use strict";
// services/materialPlanner.js 的 register() 前置逻辑

const { getBomRows, aggregateDemand, getStockMap, computeKitItems } = require('../kitCheckCore');
const { makeDbHelpers } = require('../material/core');
const { ApiError } = require('../../app/errors');


module.exports = function createContext(app, db) {

  const { all, get, run } = makeDbHelpers(db);

  function getMaterialAlerts(req, res) {
    const instanceId = req.params.id;
    const inst = get('SELECT * FROM equipment_instances WHERE id = ?', instanceId);
    if (!inst) throw ApiError.notFound('instance not found');

    const projectStart = inst.planned_start || new Date().toISOString().slice(0, 10);

    // 找出此实例所有关键件
    const sql = "SELECT kc.id as kc_id, kc.material_id, kc.component_type, kc.supplier, kc.lead_time_weeks, kc.risk_level, " +
                "m.material_code, m.material_name, " +
                "ib.id as bom_id, ib.quantity as required_qty, " +
                "(SELECT COALESCE(SUM(i.quantity), 0) FROM inventory i JOIN material_lots ml ON i.material_lot_id = ml.id WHERE ml.material_id = m.id AND i.status = 'available') as in_stock_qty " +
                "FROM instance_bom ib " +
                "JOIN materials m ON ib.material_id = m.id " +
                "JOIN key_components kc ON kc.material_id = m.id " +
                "WHERE ib.equipment_instance_id = ? AND ib.is_key_component = 1";
    const rows = all(sql, instanceId);

    const today = new Date();
    const alerts = rows.map((r) => {
      const leadDays = (r.lead_time_weeks || 0) * 7;
      const orderDeadline = new Date(projectStart);
      orderDeadline.setDate(orderDeadline.getDate() - leadDays);
      const daysToDeadline = Math.floor((orderDeadline - today) / (1000 * 60 * 60 * 24));
      let status;
      let warning;
      if (r.in_stock_qty >= r.required_qty) {
        status = 'ready';
        warning = '已备齐, 可直接使用';
      } else if (daysToDeadline < 0) {
        status = 'overdue';
        warning = '已逾期 ' + Math.abs(daysToDeadline) + ' 天, 需立即下单!';
      } else if (daysToDeadline < 14) {
        status = 'urgent';
        warning = '剩 ' + daysToDeadline + ' 天, 必须立即下单';
      } else if (daysToDeadline < 30) {
        status = 'warning';
        warning = '剩 ' + daysToDeadline + ' 天, 建议尽快下单';
      } else {
        status = 'planned';
        warning = '剩 ' + daysToDeadline + ' 天, 按计划下单';
      }
      return Object.assign({}, r, {
        project_start: projectStart,
        order_deadline: orderDeadline.toISOString().slice(0, 10),
        days_to_deadline: daysToDeadline,
        alert_status: status,
        alert_message: warning,
        shortage: Math.max(0, r.required_qty - r.in_stock_qty)
      });
    });

    const byStatus = {};
    alerts.forEach((a) => { byStatus[a.alert_status] = (byStatus[a.alert_status] || 0) + 1; });
    const totalShortage = alerts.filter((a) => a.shortage > 0).length;

    res.json({
      instance: { id: inst.id, code: inst.instance_code, name: inst.instance_name, planned_start: projectStart },
      summary: {
        total_components: alerts.length,
        by_status: byStatus,
        shortage_count: totalShortage,
        overdue_count: byStatus.overdue || 0,
        urgent_count: byStatus.urgent || 0
      },
      alerts: alerts.sort((a, b) => a.days_to_deadline - b.days_to_deadline)
    });
  }

  function getKitCheck(req, res) {
    const instanceId = req.params.id;
    const inst = get('SELECT * FROM equipment_instances WHERE id = ?', instanceId);
    if (!inst) throw ApiError.notFound('instance not found');

    const workOrders = all(
      "SELECT * FROM work_orders WHERE equipment_instance_id = ? AND status IN ('pending', 'in_progress') ORDER BY priority, id",
      instanceId
    );

    // 复用 core: BOM 聚合 + 库存查询 (只需一次, 不在循环中重复)
    const bomRows = getBomRows(db, instanceId);
    const demandMap = aggregateDemand(db, bomRows);
    const demandIds = Object.keys(demandMap).map(Number);
    const stockMap = getStockMap(db, demandIds);

    const results = [];
    for (const wo of workOrders) {
      const items = computeKitItems(demandMap, stockMap);
      let totalShortage = 0, criticalShortage = 0;
      items.forEach((it) => {
        if (it.shortage_qty > 0) {
          totalShortage++;
          if (it.is_key) criticalShortage++;
        }
      });

      let kitStatus = 'ready';
      if (criticalShortage > 0) kitStatus = 'blocked';
      else if (totalShortage > 0) kitStatus = 'partial';

      results.push({
        work_order: { id: wo.id, code: wo.wo_code, title: wo.title, priority: wo.priority, status: wo.status, subsystem_id: wo.subsystem_id },
        material_count: items.length,
        total_shortage: totalShortage,
        critical_shortage: criticalShortage,
        kit_status: kitStatus,
        items: items.sort((a, b) => (b.is_key ? 1 : 0) - (a.is_key ? 1 : 0))
      });
    }

    const stats = {
      total: results.length,
      ready: results.filter((r) => r.kit_status === 'ready').length,
      partial: results.filter((r) => r.kit_status === 'partial').length,
      blocked: results.filter((r) => r.kit_status === 'blocked').length
    };

    res.json({ instance: { id: inst.id, code: inst.instance_code }, stats, work_orders: results });
  }




  // ====== 简易MRP计算 ======


  // ====== 物料提前期管理 ======
  run("CREATE TABLE IF NOT EXISTS material_lead_times (id INTEGER PRIMARY KEY, material_id INTEGER UNIQUE, supplier TEXT, lead_time_days INTEGER, notes TEXT, updated_at TEXT DEFAULT (datetime('now')))");





  // ====== 短缺预测 ======
  return { all, getKitCheck, getMaterialAlerts, run };
};
