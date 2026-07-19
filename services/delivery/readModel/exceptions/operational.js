"use strict";

function collectOperationalExceptions({ ctx, instanceById, items, now, pushException }) {
  const { tableExists, has, safeAll } = ctx;

  if (tableExists("work_orders") && has("work_orders", "planned_end")) {
    const rows = safeAll(`
      SELECT id, wo_code, title, status, planned_end, equipment_instance_id,
             julianday(?) - julianday(planned_end) AS overdue_days
      FROM work_orders
      WHERE planned_end IS NOT NULL
        AND planned_end < ?
        AND COALESCE(status, '') NOT IN ('completed', 'cancelled', 'closed')
      ORDER BY planned_end ASC
      LIMIT 100
    `, [now, now]);
    for (const row of rows) {
      const instance = instanceById.get(Number(row.equipment_instance_id)) || {};
      const days = Math.max(0, Math.round(Number(row.overdue_days || 0) * 10) / 10);
      pushException(items, {
        id: `wo_overdue_${row.id}`,
        type: "delivery_delay",
        severity: days >= 7 ? "critical" : days >= 3 ? "high" : "warning",
        title: `工单延期 ${row.wo_code || row.id}`,
        message: `${instance.instance_code || "-"} ${row.title || "工单"} 已延期 ${days} 天`,
        instance_id: row.equipment_instance_id,
        instance_code: instance.instance_code,
        due_at: row.planned_end,
        source: "work_orders",
        source_path: "/work-orders",
        action_label: "处理工单",
      });
    }
  }

  if (tableExists("process_nodes") && has("process_nodes", "status")) {
    const blocked = safeAll(`
      SELECT id, operation_name, status, planned_end, equipment_instance_id
      FROM process_nodes
      WHERE status = 'blocked'
      LIMIT 100
    `);
    for (const row of blocked) {
      const instance = instanceById.get(Number(row.equipment_instance_id)) || {};
      pushException(items, {
        id: `process_blocked_${row.id}`,
        type: "process_blocked",
        severity: "high",
        title: `工序卡滞 ${row.operation_name || row.id}`,
        message: `${instance.instance_code || "-"} 工艺节点处于 blocked 状态`,
        instance_id: row.equipment_instance_id,
        instance_code: instance.instance_code,
        due_at: row.planned_end,
        source: "process_nodes",
        source_path: "/process-tree",
        action_label: "查看工艺树",
      });
    }
  }

  if (tableExists("process_nodes") && has("process_nodes", "planned_end")) {
    const rows = safeAll(`
      SELECT id, operation_name, status, planned_end, equipment_instance_id,
             julianday(?) - julianday(planned_end) AS overdue_days
      FROM process_nodes
      WHERE planned_end IS NOT NULL
        AND planned_end < ?
        AND COALESCE(status, '') NOT IN ('completed', 'done')
      ORDER BY planned_end ASC
      LIMIT 100
    `, [now, now]);
    for (const row of rows) {
      const instance = instanceById.get(Number(row.equipment_instance_id)) || {};
      const days = Math.max(0, Math.round(Number(row.overdue_days || 0) * 10) / 10);
      pushException(items, {
        id: `process_overdue_${row.id}`,
        type: "process_delay",
        severity: days >= 7 ? "critical" : days >= 3 ? "high" : "warning",
        title: `工序延期 ${row.operation_name || row.id}`,
        message: `${instance.instance_code || "-"} 工序计划已延期 ${days} 天`,
        instance_id: row.equipment_instance_id,
        instance_code: instance.instance_code,
        due_at: row.planned_end,
        source: "process_nodes",
        source_path: "/schedule",
        action_label: "查看排程",
      });
    }
  }

  if (tableExists("instance_eco") && has("instance_eco", "status")) {
    const rows = safeAll(`
      SELECT id, eco_no, title, status, equipment_instance_id, created_at
      FROM instance_eco
      WHERE COALESCE(status, '') IN ('open', 'pending', 'reviewing')
      ORDER BY id DESC
      LIMIT 100
    `);
    for (const row of rows) {
      const instance = instanceById.get(Number(row.equipment_instance_id)) || {};
      pushException(items, {
        id: `eco_open_${row.id}`,
        type: "eco_pending",
        severity: "warning",
        title: `ECO 待处理 ${row.eco_no || row.id}`,
        message: `${instance.instance_code || "-"} ${row.title || "设计变更"} 等待评审或执行`,
        instance_id: row.equipment_instance_id,
        instance_code: instance.instance_code,
        created_at: row.created_at,
        source: "instance_eco",
        source_path: "/eco",
        action_label: "处理 ECO",
      });
    }
  }

  if (tableExists("andon_alerts")) {
    const statusColumn = has("andon_alerts", "status") ? "status" : null;
    const rows = safeAll(`
      SELECT * FROM andon_alerts
      ${statusColumn ? "WHERE COALESCE(status, '') NOT IN ('resolved', 'closed')" : ""}
      ORDER BY id DESC
      LIMIT 100
    `);
    for (const row of rows) {
      const instanceId = row.equipment_instance_id || row.instance_id || null;
      const instance = instanceById.get(Number(instanceId)) || {};
      pushException(items, {
        id: `andon_${row.id}`,
        type: "andon",
        severity: row.severity || "high",
        title: row.title || row.message || `ANDON ${row.id}`,
        message: row.message || row.description || "现场异常未关闭",
        instance_id: instanceId,
        instance_code: instance.instance_code,
        created_at: row.created_at,
        source: "andon_alerts",
        source_path: "/andon",
        action_label: "响应安灯",
      });
    }
  }
}

module.exports = { collectOperationalExceptions };
