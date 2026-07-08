const { wrap } = require('../middleware/asyncHandler');
const { ApiError } = require('../app/errors');
const { makeDbHelpers } = require('./material/core');
const { getBomRows, aggregateDemand, getStockMap, computeKitItems } = require('./kitCheckCore');
// services/materialPlanner.js - 物料预警 + 齐套检查 (P1-3 refactor)

function register(app, db) {
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
      let status = 'ok';
      let warning = '';
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

  app.get('/api/equipment_instances/:id/material_alerts', wrap(getMaterialAlerts));
  app.get('/api/equipment_instances/:id/kit_check', wrap(getKitCheck));

  // ====== 简易MRP计算 ======
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

  // ====== 物料提前期管理 ======
  run("CREATE TABLE IF NOT EXISTS material_lead_times (id INTEGER PRIMARY KEY, material_id INTEGER UNIQUE, supplier TEXT, lead_time_days INTEGER, notes TEXT, updated_at TEXT DEFAULT (datetime('now')))");

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

  // ====== 短缺预测 ======
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

}

module.exports = { register };
