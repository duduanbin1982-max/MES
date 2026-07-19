"use strict";

// GET /api/resources/gantt
// 多项目资源甘特：按时间窗口过滤真实计划/实际任务，按工位产能计算利用率和冲突。

const MS_PER_HOUR = 3600 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

function all(db, sql, ...params) {
  return db.prepare(sql).all(...params);
}

function parseDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const normalized = raw.length === 10 ? `${raw}T00:00:00` : raw.replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatDate(date) {
  return [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join("-");
}

function formatDateTime(date) {
  return `${formatDate(date)} ${[pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join(":")}`;
}

function addDays(date, days) {
  return new Date(date.getTime() + Number(days || 0) * MS_PER_DAY);
}

function addHours(date, hours) {
  return new Date(date.getTime() + Number(hours || 0) * MS_PER_HOUR);
}

function hoursBetween(start, end) {
  return Math.max(0, (end.getTime() - start.getTime()) / MS_PER_HOUR);
}

function workstationDailyCapacity(workstation) {
  const capacityUnits = Number(workstation.capacity_per_day || 0) || Number(workstation.max_workers || 0) || 1;
  return Math.max(1, capacityUnits) * 8;
}

function normalizeItem(row, type) {
  const start = parseDate(row.actual_start || row.planned_start);
  if (!start) return null;

  const explicitEnd = parseDate(row.actual_end || row.planned_end);
  const estimatedHours = Number(row.estimated_hours || 0) || (type === "work_order" ? 8 : 4);
  let end = explicitEnd || addHours(start, estimatedHours);
  if (!end || end <= start) end = addHours(start, estimatedHours || 1);

  const calendarHours = Math.max(0.25, hoursBetween(start, end));
  const hours = estimatedHours > 0 ? estimatedHours : calendarHours;
  return {
    id: `${type === "work_order" ? "wo" : "pn"}_${row.id}`,
    source_id: row.id,
    type,
    name: type === "work_order" ? `${row.wo_code || ""} ${row.title || ""}`.trim() : (row.operation_name || `工序 ${row.id}`),
    workstation: row.ws_name || "未分配",
    ws_id: row.ws_id,
    instance_id: row.instance_id,
    instance_code: row.instance_code,
    instance_name: row.instance_name,
    start,
    end,
    start_text: formatDateTime(start),
    end_text: formatDateTime(end),
    start_date: formatDate(start),
    end_date: formatDate(end),
    status: row.status || "pending",
    hours: Math.round(hours * 10) / 10,
    calendar_hours: Math.round(calendarHours * 10) / 10,
  };
}

function overlapsWindow(item, rangeStart, rangeEnd) {
  return item.end > rangeStart && item.start < rangeEnd;
}

function getResourcesGantt(req, res, db) {
  const { start_date, days, instance_id, compare } = req.query || {};
  const rangeStart = parseDate(start_date || new Date().toISOString().slice(0, 10)) || new Date();
  rangeStart.setHours(0, 0, 0, 0);
  const numDays = Math.min(180, Math.max(1, Number.parseInt(days, 10) || 30));
  const rangeEnd = addDays(rangeStart, numDays);
  const instanceFilter = instance_id ? Number.parseInt(instance_id, 10) : null;

  const workOrderSql = instanceFilter
    ? `SELECT wo.id, wo.wo_code, wo.title, wo.estimated_hours, wo.actual_start, wo.actual_end,
              wo.planned_start, NULL AS planned_end, wo.status,
              ws.name AS ws_name, ws.id AS ws_id,
              ei.id AS instance_id, ei.instance_code, ei.instance_name
       FROM work_orders wo
       LEFT JOIN workstations ws ON wo.workstation_id = ws.id
       LEFT JOIN equipment_instances ei ON wo.equipment_instance_id = ei.id
       WHERE ei.id = ? AND (wo.planned_start IS NOT NULL OR wo.actual_start IS NOT NULL)`
    : `SELECT wo.id, wo.wo_code, wo.title, wo.estimated_hours, wo.actual_start, wo.actual_end,
              wo.planned_start, NULL AS planned_end, wo.status,
              ws.name AS ws_name, ws.id AS ws_id,
              ei.id AS instance_id, ei.instance_code, ei.instance_name
       FROM work_orders wo
       LEFT JOIN workstations ws ON wo.workstation_id = ws.id
       LEFT JOIN equipment_instances ei ON wo.equipment_instance_id = ei.id
       WHERE (wo.planned_start IS NOT NULL OR wo.actual_start IS NOT NULL)`;

  const processNodeSql = instanceFilter
    ? `SELECT pn.id, pn.operation_name, pn.estimated_hours, pn.planned_start, pn.planned_end,
              pn.actual_start, pn.actual_end, pn.status,
              ws.name AS ws_name, ws.id AS ws_id,
              ei.id AS instance_id, ei.instance_code, ei.instance_name
       FROM process_nodes pn
       LEFT JOIN workstations ws ON pn.required_workstation_id = ws.id
       JOIN equipment_instances ei ON pn.equipment_instance_id = ei.id
       WHERE ei.id = ? AND (pn.planned_start IS NOT NULL OR pn.actual_start IS NOT NULL)`
    : `SELECT pn.id, pn.operation_name, pn.estimated_hours, pn.planned_start, pn.planned_end,
              pn.actual_start, pn.actual_end, pn.status,
              ws.name AS ws_name, ws.id AS ws_id,
              ei.id AS instance_id, ei.instance_code, ei.instance_name
       FROM process_nodes pn
       LEFT JOIN workstations ws ON pn.required_workstation_id = ws.id
       JOIN equipment_instances ei ON pn.equipment_instance_id = ei.id
       WHERE (pn.planned_start IS NOT NULL OR pn.actual_start IS NOT NULL)`;

  const workOrders = all(db, workOrderSql, ...(instanceFilter ? [instanceFilter] : []));
  const processNodes = all(db, processNodeSql, ...(instanceFilter ? [instanceFilter] : []));

  const rawItems = [
    ...workOrders.map((row) => normalizeItem(row, "work_order")),
    ...processNodes.map((row) => normalizeItem(row, "process_node")),
  ].filter(Boolean);

  const items = rawItems
    .filter((item) => overlapsWindow(item, rangeStart, rangeEnd))
    .map((item) => ({
      id: item.id,
      source_id: item.source_id,
      type: item.type,
      name: item.name,
      workstation: item.workstation,
      ws_id: item.ws_id,
      instance_id: item.instance_id,
      instance_code: item.instance_code,
      instance_name: item.instance_name,
      start: item.start_text,
      end: item.end_text,
      start_date: item.start_date,
      end_date: item.end_date,
      status: item.status,
      hours: item.hours,
      calendar_hours: item.calendar_hours,
      _start: item.start,
      _end: item.end,
    }));

  const workstations = all(db, `
    SELECT id, name, workshop, capacity_per_day, max_workers, shift
    FROM workstations
    WHERE is_active = 1
    ORDER BY id
  `).map((workstation) => ({
    ...workstation,
    daily_capacity_hours: workstationDailyCapacity(workstation),
  }));

  const workstationById = new Map(workstations.map((workstation) => [Number(workstation.id), workstation]));
  const dayList = [];
  for (let offset = 0; offset < numDays; offset++) dayList.push(formatDate(addDays(rangeStart, offset)));

  const heatmap = {};
  for (const workstation of workstations) {
    heatmap[workstation.id] = { ws_id: workstation.id, name: workstation.name, daily_capacity_hours: workstation.daily_capacity_hours, by_day: {} };
  }

  for (const item of items) {
    if (!item.ws_id || !heatmap[item.ws_id]) continue;
    const durationMs = Math.max(MS_PER_HOUR / 4, item._end.getTime() - item._start.getTime());
    for (let offset = 0; offset < numDays; offset++) {
      const dayStart = addDays(rangeStart, offset);
      const dayEnd = addDays(dayStart, 1);
      const overlapMs = Math.max(0, Math.min(item._end.getTime(), dayEnd.getTime()) - Math.max(item._start.getTime(), dayStart.getTime()));
      if (overlapMs <= 0) continue;
      const busyHours = item.hours * (overlapMs / durationMs);
      const day = formatDate(dayStart);
      heatmap[item.ws_id].by_day[day] = (heatmap[item.ws_id].by_day[day] || 0) + busyHours;
    }
  }

  const heatmapGrid = workstations.map((workstation) => {
    const dailyCapacity = workstation.daily_capacity_hours;
    const cells = dayList.map((day) => {
      const busy = heatmap[workstation.id].by_day[day] || 0;
      const utilization = Math.round((busy / dailyCapacity) * 100);
      return {
        day,
        busy_hours: Math.round(busy * 10) / 10,
        capacity_hours: dailyCapacity,
        utilization_pct: utilization,
        level: utilization >= 100 ? "overload" : utilization >= 80 ? "busy" : utilization >= 30 ? "normal" : "idle",
      };
    });
    const busyHours = cells.reduce((sum, cell) => sum + cell.busy_hours, 0);
    return {
      ws_id: workstation.id,
      name: workstation.name,
      workshop: workstation.workshop,
      daily_capacity_hours: dailyCapacity,
      total_busy_hours: Math.round(busyHours * 10) / 10,
      avg_utilization_pct: Math.round((busyHours / (numDays * dailyCapacity)) * 100),
      cells,
    };
  });

  const byInstance = {};
  for (const item of items) {
    const key = item.instance_id || "unassigned";
    if (!byInstance[key]) {
      byInstance[key] = {
        instance_id: item.instance_id,
        instance_code: item.instance_code || "N/A",
        instance_name: item.instance_name || "",
        item_count: 0,
        total_hours: 0,
        workstations: new Set(),
      };
    }
    byInstance[key].item_count += 1;
    byInstance[key].total_hours += item.hours;
    if (item.ws_id) byInstance[key].workstations.add(item.ws_id);
  }
  const instanceBreakdown = Object.values(byInstance).map((entry) => ({
    instance_id: entry.instance_id,
    instance_code: entry.instance_code,
    instance_name: entry.instance_name,
    item_count: entry.item_count,
    total_hours: Math.round(entry.total_hours * 10) / 10,
    workstation_count: entry.workstations.size,
    workstations: [...entry.workstations],
  }));

  const workstationUtilization = heatmapGrid
    .map((heatmapRow) => ({
      ws_id: heatmapRow.ws_id,
      name: heatmapRow.name,
      workshop: heatmapRow.workshop,
      daily_capacity_hours: heatmapRow.daily_capacity_hours,
      total_busy_hours: heatmapRow.total_busy_hours,
      avg_utilization_pct: heatmapRow.avg_utilization_pct,
      peak_day: heatmapRow.cells.reduce((max, cell) => (cell.busy_hours > max.busy_hours ? cell : max), { day: "", busy_hours: 0, utilization_pct: 0 }),
      peak_utilization_pct: Math.max(0, ...heatmapRow.cells.map((cell) => cell.utilization_pct)),
    }))
    .sort((a, b) => b.avg_utilization_pct - a.avg_utilization_pct);

  const conflicts = [];
  const byWorkstation = {};
  for (const item of items) {
    if (!item.ws_id) continue;
    if (!byWorkstation[item.ws_id]) byWorkstation[item.ws_id] = [];
    byWorkstation[item.ws_id].push(item);
  }

  for (const wsId of Object.keys(byWorkstation)) {
    const list = byWorkstation[wsId].sort((a, b) => a._start - b._start);
    for (let index = 0; index < list.length - 1; index++) {
      const current = list[index];
      const next = list[index + 1];
      const overlapMs = Math.min(current._end.getTime(), next._end.getTime()) - Math.max(current._start.getTime(), next._start.getTime());
      const overlapHours = overlapMs / MS_PER_HOUR;
      if (overlapHours > 0.05) {
        conflicts.push({
          type: current.instance_id !== next.instance_id ? "cross_instance" : "same_workstation",
          workstation: current.workstation,
          ws_id: Number.parseInt(wsId, 10),
          items: [
            { id: current.id, name: current.name, instance: current.instance_code, start: current.start, end: current.end },
            { id: next.id, name: next.name, instance: next.instance_code, start: next.start, end: next.end },
          ],
          overlap_hours: Math.round(overlapHours * 10) / 10,
        });
      }
    }
  }

  for (const heatmapRow of heatmapGrid) {
    const workstation = workstationById.get(Number(heatmapRow.ws_id));
    const capacity = workstation ? workstation.daily_capacity_hours : 8;
    for (const cell of heatmapRow.cells) {
      if (cell.busy_hours > capacity + 0.1) {
        conflicts.push({
          type: "capacity_overload",
          workstation: heatmapRow.name,
          ws_id: heatmapRow.ws_id,
          day: cell.day,
          busy_hours: cell.busy_hours,
          capacity_hours: capacity,
          utilization_pct: cell.utilization_pct,
          overlap_hours: Math.round((cell.busy_hours - capacity) * 10) / 10,
        });
      }
    }
  }

  const publicItems = items.map(({ _start, _end, ...item }) => item);

  res.json({
    start_date: formatDate(rangeStart),
    end_date: formatDate(rangeEnd),
    num_days: numDays,
    filter: { instance_id: instanceFilter, compare: compare === "1" },
    workstations,
    summary: {
      total_items: publicItems.length,
      total_hours: Math.round(publicItems.reduce((sum, item) => sum + Number(item.hours || 0), 0) * 10) / 10,
      instance_count: instanceBreakdown.length,
      workstation_count: workstations.length,
      conflict_count: conflicts.length,
    },
    heatmap: { days: dayList, grid: heatmapGrid },
    instance_breakdown: instanceBreakdown,
    workstation_utilization: workstationUtilization,
    items: publicItems,
    conflicts,
  });
}

module.exports = { getResourcesGantt };
