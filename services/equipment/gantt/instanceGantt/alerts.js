"use strict";
// services/equipment/gantt/instanceGantt/alerts.js
// GET /api/equipment_instances/:id/alerts
// 2026-11-05（审计 F-07 整改）：单项目告警——按项目维度算，不再复用全局 dashboard/alerts。
// 数据全部来自本项目：工序超期 / 受阻 / 未排程、里程碑延期、长运行工单。

const MS_PER_DAY = 86400000;

function all(db, sql, ...params) {
  return db.prepare(sql).all(...params);
}

function get(db, sql, ...params) {
  return db.prepare(sql).get(...params);
}

function parseDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const normalized = raw.length === 10 ? `${raw}T00:00:00` : raw.replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysSince(nowMs, date) {
  if (!date) return 0;
  return Math.floor((nowMs - date.getTime()) / MS_PER_DAY);
}

function severityOfOverdue(days) {
  if (days > 7) return "danger";
  if (days >= 3) return "warning";
  return "info";
}

function getInstanceAlerts(req, res, db) {
  const instanceId = Number.parseInt(req.params.id, 10);
  const inst = get(db, "SELECT id, instance_code, instance_name FROM equipment_instances WHERE id = ?", instanceId);
  if (!inst) return res.status(404).json({ error: "instance not found" });

  const nowMs = Date.now();
  const alerts = [];

  const nodes = all(db, `
    SELECT id, operation_name, status, planned_start, planned_end, actual_start
      FROM process_nodes WHERE equipment_instance_id = ?
  `, instanceId);
  for (const node of nodes) {
    if (["completed", "cancelled"].includes(String(node.status))) continue;
    const plannedEnd = parseDate(node.planned_end);
    if (plannedEnd && plannedEnd.getTime() < nowMs) {
      const overdueDays = daysSince(nowMs, plannedEnd);
      alerts.push({
        type: "overdue_node",
        type_label: "工序超期",
        severity: severityOfOverdue(overdueDays),
        message: `#${node.id} ${node.operation_name || ""} 超期 ${overdueDays} 天（计划 ${String(node.planned_end).slice(0, 10)}）`,
        ref: { node_id: node.id },
      });
    }
    if (String(node.status) === "blocked") {
      alerts.push({
        type: "blocked_node",
        type_label: "工序受阻",
        severity: "danger",
        message: `#${node.id} ${node.operation_name || ""} 处于受阻状态`,
        ref: { node_id: node.id },
      });
    }
    if (!node.planned_start && !node.planned_end) {
      alerts.push({
        type: "unscheduled_node",
        type_label: "工序未排程",
        severity: "warning",
        message: `#${node.id} ${node.operation_name || ""} 还没有计划开始/结束时间`,
        ref: { node_id: node.id },
      });
    }
  }

  const milestones = all(db, `
    SELECT id, phase_code, phase_name, status, planned_start, planned_end
      FROM instance_milestones WHERE equipment_instance_id = ?
  `, instanceId);
  for (const milestone of milestones) {
    if (String(milestone.status) === "completed") continue;
    const plannedEnd = parseDate(milestone.planned_end);
    if (plannedEnd && plannedEnd.getTime() < nowMs) {
      const overdueDays = daysSince(nowMs, plannedEnd);
      alerts.push({
        type: "overdue_milestone",
        type_label: "里程碑延期",
        severity: severityOfOverdue(overdueDays),
        message: `${milestone.phase_code || ""} ${milestone.phase_name || "里程碑"} 超期 ${overdueDays} 天`,
        ref: { milestone_id: milestone.id },
      });
    }
  }

  const workOrders = all(db, `
    SELECT id, wo_code, title, status, actual_start
      FROM work_orders WHERE equipment_instance_id = ?
  `, instanceId);
  for (const wo of workOrders) {
    if (String(wo.status) !== "in_progress") continue;
    const actualStart = parseDate(wo.actual_start);
    const runningDays = daysSince(nowMs, actualStart);
    if (actualStart && runningDays > 30) {
      alerts.push({
        type: "long_running_work_order",
        type_label: "工单长运行",
        severity: "warning",
        message: `${wo.wo_code || ""} ${wo.title || ""} 已开工 ${runningDays} 天`,
        ref: { work_order_id: wo.id, wo_code: wo.wo_code || null },
      });
    }
  }

  const order = { danger: 0, warning: 1, info: 2 };
  // 注意：danger=0 不能用 || 兜底（0 是假值会排到最后）
  alerts.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
  const bySeverity = { danger: 0, warning: 0, info: 0 };
  for (const alert of alerts) bySeverity[alert.severity] += 1;

  res.json({
    instance: { id: inst.id, code: inst.instance_code, name: inst.instance_name },
    count: alerts.length,
    by_severity: bySeverity,
    alerts: alerts.slice(0, 200),
  });
}

module.exports = { getInstanceAlerts };
