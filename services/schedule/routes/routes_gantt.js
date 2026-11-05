"use strict";
// services/schedule/routes_gantt.js
// 2026-11-04：甘特图数据接口 + 拖拽改期接口
//
// 与周视图的区别：周视图只取"本周 + 未完成"的节点；甘特图按**日期区间**取所有重叠节点，
// 并额外返回"未排程"节点（没有计划时间，无法画条，需要单独提示）。

const { wrap } = require("../../../middleware/asyncHandler");
const { ApiError } = require("../../../app/errors");
const { toInt } = require("../_helpers");

const MAX_RANGE_DAYS = 370;
const MAX_NODES = 3000;

function pad(value) {
  return String(value).padStart(2, "0");
}

function toDayString(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function parseDay(value) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysBetween(from, to) {
  const list = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  while (cursor.getTime() <= end.getTime() && list.length <= MAX_RANGE_DAYS) {
    list.push({
      date: toDayString(cursor),
      day_of_month: cursor.getDate(),
      weekday: cursor.getDay(),
      is_weekend: cursor.getDay() === 0 || cursor.getDay() === 6,
      is_month_start: cursor.getDate() === 1,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return list;
}

function isValidDateTime(value) {
  return /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(String(value || "").trim());
}

module.exports = function registerGanttRoutes(app, db, ctx) {
  const { all, get, run } = ctx;

  // 甘特图数据：按日期区间取节点 + 未排程节点
  app.get("/api/schedule/gantt", wrap((req, res) => {
    const today = new Date();
    const defaultFrom = startOfMonth(today);
    const defaultTo = new Date(addMonths(defaultFrom, 1).getTime() - 86400000);
    const fromDate = parseDay(req.query.from) || defaultFrom;
    const toDate = parseDay(req.query.to) || defaultTo;
    if (toDate.getTime() < fromDate.getTime()) throw ApiError.validation("to 必须晚于 from");
    const spanDays = Math.round((toDate - fromDate) / 86400000) + 1;
    if (spanDays > MAX_RANGE_DAYS) throw ApiError.validation(`日期区间不能超过 ${MAX_RANGE_DAYS} 天`);

    const from = toDayString(fromDate);
    const to = toDayString(toDate);
    const instanceId = toInt(req.query.instance_id) || null;
    const includeUnscheduled = !["0", "false", "no"].includes(String(req.query.include_unscheduled ?? "1").toLowerCase());

    const conditions = [
      "pn.planned_start IS NOT NULL",
      "date(pn.planned_start) <= ?",
      "date(COALESCE(pn.planned_end, pn.planned_start)) >= ?",
    ];
    const params = [to, from];
    if (instanceId) {
      conditions.push("pn.equipment_instance_id = ?");
      params.push(instanceId);
    }

    const rows = all(`
      SELECT pn.id, pn.operation_name, pn.status, pn.phase_code,
             pn.planned_start, pn.planned_end, pn.estimated_hours,
             pn.equipment_instance_id, pn.subsystem_id, pn.assigned_to,
             u.full_name AS assigned_name,
             w.name AS workstation_name,
             ei.instance_code, ei.instance_name
        FROM process_nodes pn
        LEFT JOIN users u ON u.id = pn.assigned_to
        LEFT JOIN workstations w ON w.id = pn.required_workstation_id
        LEFT JOIN equipment_instances ei ON ei.id = pn.equipment_instance_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY pn.equipment_instance_id, COALESCE(pn.planned_start, '9999-12-31'), pn.sequence, pn.id
       LIMIT ${MAX_NODES + 1}
    `, params);

    const truncated = rows.length > MAX_NODES;
    const nodes = truncated ? rows.slice(0, MAX_NODES) : rows;

    const groupMap = new Map();
    for (const node of nodes) {
      const key = node.equipment_instance_id ?? 0;
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          instance_id: node.equipment_instance_id ?? null,
          instance_code: node.instance_code || "未关联项目",
          instance_name: node.instance_name || "",
          nodes: [],
        });
      }
      groupMap.get(key).nodes.push({
        id: node.id,
        operation_name: node.operation_name,
        status: node.status,
        phase_code: node.phase_code,
        planned_start: node.planned_start,
        planned_end: node.planned_end,
        estimated_hours: node.estimated_hours,
        assigned_name: node.assigned_name,
        workstation_name: node.workstation_name,
        subsystem_id: node.subsystem_id,
      });
    }

    // 2026-11-04：工序依赖（两端都在本次区间内的才返回，用于甘特图画箭头）
    const nodeIds = new Set(nodes.map((node) => node.id));
    let dependencies = [];
    if (nodeIds.size) {
      const depConditions = [
        "p.planned_start IS NOT NULL",
        "date(p.planned_start) <= ?",
        "date(COALESCE(p.planned_end, p.planned_start)) >= ?",
      ];
      const depParams = [to, from];
      if (instanceId) {
        depConditions.push("p.equipment_instance_id = ?");
        depParams.push(instanceId);
      }
      const depRows = all(`
        SELECT d.id, d.predecessor_id, d.successor_id, d.dep_type, d.lag_hours
          FROM process_dependencies d
          JOIN process_nodes p ON p.id = d.predecessor_id
         WHERE ${depConditions.join(" AND ")}
         LIMIT 5000
      `, depParams);
      dependencies = depRows.filter((row) => nodeIds.has(row.predecessor_id) && nodeIds.has(row.successor_id));
    }

    let unscheduled = [];
    if (includeUnscheduled) {
      const unscheduledConditions = ["pn.planned_start IS NULL", "pn.planned_end IS NULL", "pn.status NOT IN ('completed', 'cancelled')"];
      const unscheduledParams = [];
      if (instanceId) {
        unscheduledConditions.push("pn.equipment_instance_id = ?");
        unscheduledParams.push(instanceId);
      }
      unscheduled = all(`
        SELECT pn.id, pn.operation_name, pn.status, pn.phase_code, pn.estimated_hours,
               pn.equipment_instance_id, ei.instance_code
          FROM process_nodes pn
          LEFT JOIN equipment_instances ei ON ei.id = pn.equipment_instance_id
         WHERE ${unscheduledConditions.join(" AND ")}
         ORDER BY pn.equipment_instance_id, pn.sequence, pn.id
         LIMIT 500
      `, unscheduledParams);
    }

    res.json({
      from,
      to,
      days: daysBetween(fromDate, toDate),
      groups: [...groupMap.values()],
      dependencies,
      unscheduled,
      total_nodes: nodes.length,
      total_dependencies: dependencies.length,
      truncated,
    });
  }));

  // 拖拽改期：只改 planned_start / planned_end
  app.put("/api/schedule/process-nodes/:id/dates", wrap((req, res) => {
    const nodeId = toInt(req.params.id);
    if (!nodeId) throw ApiError.validation("process node id is required");
    const body = req.body || {};
    const hasStart = body.planned_start !== undefined;
    const hasEnd = body.planned_end !== undefined;
    if (!hasStart && !hasEnd) throw ApiError.validation("planned_start 或 planned_end 至少给一个");

    const node = get("SELECT id, status, planned_start, planned_end FROM process_nodes WHERE id = ?", nodeId);
    if (!node) throw ApiError.notFound("Process node not found");
    if (node.status === "completed") throw ApiError.validation("已完成节点的计划时间不可修改");

    const nextStart = hasStart ? body.planned_start : node.planned_start;
    const nextEnd = hasEnd ? body.planned_end : node.planned_end;
    if (nextStart && !isValidDateTime(nextStart)) throw ApiError.validation("planned_start 格式应为 YYYY-MM-DD[ HH:mm[:ss]]");
    if (nextEnd && !isValidDateTime(nextEnd)) throw ApiError.validation("planned_end 格式应为 YYYY-MM-DD[ HH:mm[:ss]]");
    if (nextStart && nextEnd) {
      const start = new Date(String(nextStart).replace(" ", "T"));
      const end = new Date(String(nextEnd).replace(" ", "T"));
      if (end.getTime() < start.getTime()) throw ApiError.validation("planned_end 不能早于 planned_start");
    }

    const nodeInfo = get("SELECT equipment_instance_id, operation_name FROM process_nodes WHERE id = ?", nodeId);

    run("UPDATE process_nodes SET planned_start = ?, planned_end = ?, updated_at = datetime('now') WHERE id = ?", [
      nextStart || null, nextEnd || null, nodeId,
    ]);

    // 2026-11-05（审计 F-03）：拖拽改期也记批次（DT-…），支持从「批次记录」撤销，
    // 并检查直接前后置依赖是否被破坏（只告警，不阻断 —— 用户可能就是想先挪再顺）。
    const pad = (value) => String(value).padStart(2, "0");
    const now = new Date();
    const day = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const seqRow = db.prepare("SELECT COUNT(*) AS c FROM process_reschedule_batches WHERE batch_no LIKE ?").get(`DT-${day}-%`);
    const batchNo = `DT-${day}-${String(Number(seqRow.c) + 1).padStart(3, "0")}`;
    db.prepare(`INSERT INTO process_reschedule_batches
        (batch_no, shift_days, instance_id, subsystem_id, only_overdue, anchor_date, node_count, items_json, note)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      batchNo, 0, nodeInfo ? nodeInfo.equipment_instance_id : null, null, 0, null, 1,
      JSON.stringify([{
        id: nodeId,
        status: node.status,
        old_planned_start: node.planned_start || null,
        old_planned_end: node.planned_end || null,
        new_planned_start: nextStart || null,
        new_planned_end: nextEnd || null,
      }]),
      "drag dates",
    );

    const warnings = [];
    if (nextStart) {
      const predecessors = all(`SELECT d.predecessor_id, pn.operation_name, pn.planned_end
                                  FROM process_dependencies d
                                  JOIN process_nodes pn ON pn.id = d.predecessor_id
                                 WHERE d.successor_id = ?`, nodeId);
      for (const predecessor of predecessors) {
        if (predecessor.planned_end && String(predecessor.planned_end) > String(nextStart)) {
          warnings.push(`前驱「${predecessor.operation_name || predecessor.predecessor_id}」计划结束 ${predecessor.planned_end} 晚于本工序新开始 ${nextStart}`);
        }
      }
    }
    if (nextEnd) {
      const successors = all(`SELECT d.successor_id, pn.operation_name, pn.planned_start
                                FROM process_dependencies d
                                JOIN process_nodes pn ON pn.id = d.successor_id
                               WHERE d.predecessor_id = ?`, nodeId);
      for (const successor of successors) {
        if (successor.planned_start && String(successor.planned_start) < String(nextEnd)) {
          warnings.push(`后继「${successor.operation_name || successor.successor_id}」计划开始 ${successor.planned_start} 早于本工序新结束 ${nextEnd}`);
        }
      }
    }

    res.json({
      ok: true,
      process_node_id: nodeId,
      planned_start: nextStart || null,
      planned_end: nextEnd || null,
      batch_no: batchNo,
      warnings,
    });
  }));
};
