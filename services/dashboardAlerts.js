// services/dashboardAlerts.js
// 批次 3 重构：从 server.js 抽出

// db.js 提供 db 实例；本文件用闭包包裹工具函数
const all = (db, sql, params = []) => db.prepare(sql).all(params);
const get = (db, sql, params = []) => db.prepare(sql).get(params);
const run = (db, sql, params = []) => db.prepare(sql).run(params);
const wrap = (handler) => (req, res) => {
  try { handler(req, res); }
  catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
};

function getDashboardAlerts(req, res, db) {
  const alerts = [];

  // 1) 已逾期的工单
  const overdueWOs = all(db, "SELECT wo.wo_code, wo.title, wo.actual_end, ei.instance_code FROM work_orders wo JOIN equipment_instances ei ON wo.equipment_instance_id = ei.id WHERE wo.status = 'in_progress' AND wo.actual_start IS NOT NULL");
  // 简化: 显示 in_progress 且已开工超 30 天的工单
  const longRunning = all(db, "SELECT wo.wo_code, wo.title, wo.actual_start, ei.instance_code, julianday('now') - julianday(wo.actual_start) as days_running FROM work_orders wo JOIN equipment_instances ei ON wo.equipment_instance_id = ei.id WHERE wo.status = 'in_progress' AND wo.actual_start IS NOT NULL AND julianday('now') - julianday(wo.actual_start) > 30");
  longRunning.forEach((w) => {
    alerts.push({ type: 'overdue_work_order', severity: 'warning', message: w.wo_code + ' (' + w.instance_code + ') 已开工 ' + Math.floor(w.days_running) + ' 天', wo_code: w.wo_code, instance_code: w.instance_code, days_running: Math.floor(w.days_running) });
  });

  // 2) Blocked process_nodes
  const blockedNodes = all(db, "SELECT pn.operation_name, ei.instance_code FROM process_nodes pn JOIN equipment_instances ei ON pn.equipment_instance_id = ei.id WHERE pn.status = 'blocked'");
  blockedNodes.forEach((n) => {
    alerts.push({ type: 'blocked_process_node', severity: 'danger', message: n.instance_code + ' 节点 ' + n.operation_name + ' 卡住' });
  });

  // 3) 长交期件
  const longLead = all(db, "SELECT m.material_name, kc.lead_time_weeks, kc.supplier FROM key_components kc JOIN materials m ON kc.material_id = m.id WHERE kc.lead_time_weeks >= 16");
  longLead.forEach((k) => {
    alerts.push({ type: 'long_leadtime', severity: 'warning', message: k.material_name + ' (' + k.lead_time_weeks + '周, ' + k.supplier + ') - 尽早下单' });
  });

  // 4) 待审批 ECO
  const openECO = all(db, "SELECT ie.eco_no, ie.title, ei.instance_code FROM instance_eco ie JOIN equipment_instances ei ON ie.equipment_instance_id = ei.id WHERE ie.status = 'open'");
  openECO.forEach((e) => {
    alerts.push({ type: 'open_eco', severity: 'info', message: e.eco_no + ' (' + e.instance_code + ') 待审批: ' + e.title });
  });

  // 按严重度排序
  const order = { danger: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => (order[a.severity] || 9) - (order[b.severity] || 9));

  res.json({
    count: alerts.length,
    by_severity: {
      danger: alerts.filter((a) => a.severity === 'danger').length,
      warning: alerts.filter((a) => a.severity === 'warning').length,
      info: alerts.filter((a) => a.severity === 'info').length
    },
    alerts: alerts
  });
}

module.exports = { getDashboardAlerts };
