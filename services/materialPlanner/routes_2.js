"use strict";
// services/materialPlanner.js 的路由组 2

module.exports = function registerRoutes2(app, db, ctx) {
const { ApiError } = require('../../app/errors');
const { wrap } = require('../../middleware/asyncHandler');
const { all, get, run } = ctx;

  app.post("/api/material-planner/mrp", wrap((req, res) => {
    const { instance_id, demand_date } = req.body;
    if (!instance_id) throw ApiError.validation("instance_id 必填");
    const inst = get("SELECT * FROM equipment_instances WHERE id = ?", instance_id);
    if (!inst) throw ApiError.notFound("instance not found");
    const targetDate = demand_date || inst.planned_start || new Date().toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);

    const bomRows = all(
      "SELECT ib.id, ib.material_id, ib.quantity as bom_qty, m.material_code, m.material_name, m.spec, m.unit, " +
      "kc.lead_time_weeks, kc.supplier " +
      "FROM instance_bom ib JOIN materials m ON ib.material_id = m.id " +
      "LEFT JOIN key_components kc ON kc.material_id = m.id " +
      "WHERE ib.equipment_instance_id = ?",
      instance_id
    );

    if (!bomRows.length) throw ApiError.notFound("该实例无BOM数据");

    const items = bomRows.map(row => {
      const stock = get(
        "SELECT COALESCE(SUM(CASE WHEN i.status='available' THEN i.quantity ELSE 0 END), 0) AS stock_on_hand, " +
        "COALESCE(SUM(CASE WHEN i.status='allocated' THEN i.quantity ELSE 0 END), 0) AS allocated " +
        "FROM material_lots ml JOIN inventory i ON i.material_lot_id = ml.id WHERE ml.material_id = ?",
        row.material_id
      ) || { stock_on_hand: 0, allocated: 0 };

      const leadTimeDays = (row.lead_time_weeks || 4) * 7;
      const netRequired = Math.max(0, row.bom_qty - stock.stock_on_hand + stock.allocated);
      const suggestedOrder = netRequired > 0 ? Math.ceil(netRequired * 1.1) : 0;
      const orderByDate = new Date(new Date(targetDate).getTime() - leadTimeDays * 86400000).toISOString().slice(0, 10);

      return {
        material_id: row.material_id,
        material_name: row.material_name,
        material_code: row.material_code,
        unit: row.unit,
        bom_qty: row.bom_qty,
        stock_on_hand: stock.stock_on_hand,
        allocated: stock.allocated,
        net_required: netRequired,
        suggested_order: suggestedOrder,
        lead_time_days: leadTimeDays,
        order_by_date: orderByDate,
        supplier: row.supplier || null,
        status: netRequired <= 0 ? "sufficient" : (orderByDate < today ? "overdue" : "planned")
      };
    });

    const summary = {
      total_items: items.length,
      sufficient: items.filter(i => i.status === "sufficient").length,
      planned: items.filter(i => i.status === "planned").length,
      overdue: items.filter(i => i.status === "overdue").length,
      total_shortage_qty: items.reduce((s, i) => s + i.net_required, 0)
    };

    res.json({ instance: { id: inst.id, code: inst.instance_code }, target_date: targetDate, summary, items });
  }));

  app.get("/api/material-planner/lead-times", wrap((_req, res) => {
    const rows = all(
      "SELECT mlt.*, m.material_code, m.material_name FROM material_lead_times mlt " +
      "JOIN materials m ON mlt.material_id = m.id ORDER BY m.material_code"
    );
    res.json(rows);
  }));

  app.post("/api/material-planner/lead-times", wrap((req, res) => {
    const { material_id, supplier, lead_time_days, notes } = req.body;
    if (!material_id || !lead_time_days) throw ApiError.validation("material_id/lead_time_days 必填");
    const existing = get("SELECT id FROM material_lead_times WHERE material_id = ?", material_id);
    if (existing) {
      run("UPDATE material_lead_times SET supplier = ?, lead_time_days = ?, notes = ?, updated_at = datetime('now') WHERE material_id = ?",
        [supplier || null, lead_time_days, notes || null, material_id]);
    } else {
      run("INSERT INTO material_lead_times (material_id, supplier, lead_time_days, notes) VALUES (?, ?, ?, ?)",
        [material_id, supplier || null, lead_time_days, notes || null]);
    }
    res.json(get("SELECT mlt.*, m.material_code, m.material_name FROM material_lead_times mlt JOIN materials m ON mlt.material_id = m.id WHERE mlt.material_id = ?", material_id));
  }));

  app.get("/api/material-planner/shortage-forecast", wrap((req, res) => {
    const weeks = parseInt(req.query.weeks) || 4;
    const futureDate = new Date(Date.now() + weeks * 7 * 86400000).toISOString().slice(0, 10);

    const openOrders = all(
      "SELECT wo.id, wo.wo_code, wo.planned_start, wo.planned_end, wo.equipment_instance_id, ei.instance_code " +
      "FROM work_orders wo JOIN equipment_instances ei ON wo.equipment_instance_id = ei.id " +
      "WHERE wo.status IN ('pending','in_progress') AND wo.planned_start <= ? " +
      "ORDER BY wo.planned_start",
      futureDate
    );

    const materialDemand = {};
    for (const wo of openOrders) {
      const bomItems = all(
        "SELECT ib.material_id, ib.quantity, m.material_code, m.material_name, m.unit, m.safety_stock " +
        "FROM instance_bom ib JOIN materials m ON ib.material_id = m.id " +
        "WHERE ib.equipment_instance_id = ?",
        wo.equipment_instance_id
      );
      for (const bi of bomItems) {
        const key = bi.material_id;
        if (!materialDemand[key]) {
          materialDemand[key] = {
            material_id: bi.material_id, material_code: bi.material_code,
            material_name: bi.material_name, unit: bi.unit,
            safety_stock: bi.safety_stock || 0, total_demand: 0, work_orders: []
          };
        }
        materialDemand[key].total_demand += bi.quantity;
        materialDemand[key].work_orders.push({ wo_id: wo.id, wo_code: wo.wo_code, instance_code: wo.instance_code, qty: bi.quantity });
      }
    }

    const forecast = [];
    for (const key of Object.keys(materialDemand)) {
      const d = materialDemand[key];
      const stock = get(
        "SELECT COALESCE(SUM(CASE WHEN i.status='available' THEN i.quantity ELSE 0 END), 0) AS available " +
        "FROM material_lots ml JOIN inventory i ON i.material_lot_id = ml.id WHERE ml.material_id = ?",
        d.material_id
      );
      const available = stock ? stock.available : 0;
      const shortage = Math.max(0, d.total_demand - available);
      d.stock_on_hand = available;
      d.shortage_qty = shortage;
      d.shortage_pct = d.total_demand > 0 ? (shortage / d.total_demand * 100).toFixed(1) : 0;
      d.risk = shortage > 0 ? (shortage > d.safety_stock ? "high" : "medium") : "low";
      forecast.push(d);
    }

    forecast.sort((a, b) => b.shortage_qty - a.shortage_qty);

    const summary = {
      forecast_weeks: weeks,
      open_work_orders: openOrders.length,
      materials_with_demand: forecast.length,
      materials_short: forecast.filter(f => f.shortage_qty > 0).length,
      high_risk: forecast.filter(f => f.risk === "high").length
    };

    res.json({ summary, forecast: forecast.slice(0, 100) });
  }));
};
