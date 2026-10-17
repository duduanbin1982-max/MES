// services/dashboardAlerts.js
// 首页告警聚合 - 标准 register(app, db) 模式 (brooks-review fix)
'use strict';
require('../app/errors');

const { wrap } = require('../middleware/asyncHandler');
const { makeDbHelpers } = require('./material/core');

function register(app, db) {
  const { all } = makeDbHelpers(db);

  app.get('/api/dashboard/alerts', wrap((req, res) => {
    const alerts = [];

    // 1) 长运行工单 (已开工超 30 天)
    const longRunning = all("SELECT wo.wo_code, wo.title, wo.actual_start, ei.instance_code, julianday('now') - julianday(wo.actual_start) as days_running FROM work_orders wo JOIN equipment_instances ei ON wo.equipment_instance_id = ei.id WHERE wo.status = 'in_progress' AND wo.actual_start IS NOT NULL AND julianday('now') - julianday(wo.actual_start) > 30");
    longRunning.forEach((w) => {
      alerts.push({ type: 'overdue_work_order', severity: 'warning', message: w.wo_code + ' (' + w.instance_code + ') 已开工 ' + Math.floor(w.days_running) + ' 天', wo_code: w.wo_code, instance_code: w.instance_code, days_running: Math.floor(w.days_running) });
    });

    // 2) 卡住的工序节点
    const blockedNodes = all("SELECT pn.operation_name, ei.instance_code FROM process_nodes pn JOIN equipment_instances ei ON pn.equipment_instance_id = ei.id WHERE pn.status = 'blocked'");
    blockedNodes.forEach((n) => {
      alerts.push({ type: 'blocked_process_node', severity: 'danger', message: n.instance_code + ' 节点 ' + n.operation_name + ' 卡住' });
    });

    // 3) 长交期关键件 (>=16 周)
    const longLead = all("SELECT m.material_name, kc.lead_time_weeks, kc.supplier FROM key_components kc JOIN materials m ON kc.material_id = m.id WHERE kc.lead_time_weeks >= 16");
    longLead.forEach((k) => {
      alerts.push({ type: 'long_leadtime', severity: 'warning', message: k.material_name + ' (' + k.lead_time_weeks + '周, ' + k.supplier + ') - 尽早下单' });
    });

    // 4) 待审批 ECO
    const openECO = all("SELECT ie.eco_no, ie.title, ei.instance_code FROM instance_eco ie JOIN equipment_instances ei ON ie.equipment_instance_id = ei.id WHERE ie.status = 'open'");
    openECO.forEach((e) => {
      alerts.push({ type: 'open_eco', severity: 'info', message: e.eco_no + ' (' + e.instance_code + ') 待审批: ' + e.title });
    });

    // 单次遍历排序 + 统计
    const order = { danger: 0, warning: 1, info: 2 };
    alerts.sort((a, b) => (order[a.severity] || 9) - (order[b.severity] || 9));

    const by_severity = { danger: 0, warning: 0, info: 0 };
    for (const a of alerts) by_severity[a.severity]++;

    res.json({ count: alerts.length, by_severity, alerts });
  }));
}

module.exports = { register };
