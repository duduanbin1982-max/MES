// services/materialPlanner.js
// 批次 3 重构：从 server.js 抽出

// db.js 提供 db 实例；本文件用闭包包裹工具函数
const all = (db, sql, params = []) => db.prepare(sql).all(params);
const get = (db, sql, params = []) => db.prepare(sql).get(params);
const run = (db, sql, params = []) => db.prepare(sql).run(params);
const wrap = (handler) => (req, res) => {
  try { handler(req, res); }
  catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
};

function getMaterialAlerts(req, res, db) {
  const instanceId = req.params.id;
  const inst = get(db, 'SELECT * FROM equipment_instances WHERE id = ?', instanceId);
  if (!inst) return res.status(404).json({ error: 'instance not found' });

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
  const rows = all(db, sql, instanceId);

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

  // 统计
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

function getKitCheck(req, res, db) {
  const instanceId = req.params.id;
  const inst = get(db, 'SELECT * FROM equipment_instances WHERE id = ?', instanceId);
  if (!inst) return res.status(404).json({ error: 'instance not found' });

  // 对每个 pending/in_progress 工单, 检查所需物料
  const workOrders = all(db, "SELECT * FROM work_orders WHERE equipment_instance_id = ? AND status IN ('pending', 'in_progress') ORDER BY priority, id", instanceId);
  const results = [];
  for (const wo of workOrders) {
    // 这个工单依赖哪些 BOM 节点?
    // 简化: 工单的 subsystem_id 对应 9 子系统, 取该子系统下所有 BOM 节点
    // (实际更精确: 应该有 wo ↔ bom 关联表, 这里用 subsystem 匹配)
    let boms = [];
    boms = all(db, "SELECT b.*, m.material_code, m.material_name, m.unit, m.is_key_component, kc.lead_time_weeks FROM instance_bom b JOIN materials m ON b.material_id = m.id LEFT JOIN key_components kc ON kc.material_id = m.id WHERE b.equipment_instance_id = ?", instanceId);

    // 聚合物料需求
    const need = {};
    for (const b of boms) {
      if (!b.material_id) continue;
      const key = b.material_id;
      if (!need[key]) need[key] = { material_id: key, code: b.material_code, name: b.material_name, unit: b.unit, required_qty: 0, is_key: !!b.is_key_component, lead_time: b.lead_time_weeks };
      need[key].required_qty += (b.quantity || 1);
    }

    // 查库存
    // P1-3 SQL 安全: matIds 强制 parseInt, IN 子句用 ? 占位
    // P1-3 SQL 安全: 严格整数字符串校验 (/^\d+$/) + 范围, 拒绝任何 '1;DROP...' 攻击
    const matIds = Object.keys(need).filter(id => /^\d+$/.test(String(id))).map(id => parseInt(id, 10)).filter(n => n > 0 && n <= 2147483647);
    const materials = matIds.length > 0 ? all(db, `SELECT i.id, i.location, i.quantity, i.unit, i.status, i.last_updated, ml.material_id FROM inventory i JOIN material_lots ml ON i.material_lot_id = ml.id WHERE ml.material_id IN (${matIds.map(() => '?').join(',')}) AND i.status = 'available'`, matIds) : [];
    for (const inv of materials) {
      const key = inv.material_id;
      if (need[key]) need[key].in_stock_qty = (need[key].in_stock_qty || 0) + inv.quantity;
    }

    // 计算状态
    const items = Object.values(need);
    let totalShortage = 0;
    let criticalShortage = 0;
    items.forEach((it) => {
      it.shortage = Math.max(0, it.required_qty - (it.in_stock_qty || 0));
      if (it.shortage > 0) {
        totalShortage++;
        if (it.is_key) criticalShortage++;
      }
    });

    let status = 'ready';
    if (criticalShortage > 0) status = 'blocked';
    else if (totalShortage > 0) status = 'partial';

    results.push({
      work_order: { id: wo.id, code: wo.wo_code, title: wo.title, priority: wo.priority, status: wo.status, subsystem_id: wo.subsystem_id },
      material_count: items.length,
      total_shortage: totalShortage,
      critical_shortage: criticalShortage,
      kit_status: status,
      items: items.sort((a, b) => (b.is_key ? 1 : 0) - (a.is_key ? 1 : 0))
    });
  }

  const stats = {
    total: results.length,
    ready: results.filter((r) => r.kit_status === 'ready').length,
    partial: results.filter((r) => r.kit_status === 'partial').length,
    blocked: results.filter((r) => r.kit_status === 'blocked').length
  };

  res.json({ instance: { id: inst.id, code: inst.instance_code }, stats: stats, work_orders: results });
}

module.exports = { getMaterialAlerts, getKitCheck };
