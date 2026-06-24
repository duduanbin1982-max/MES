"use strict";
// services/equipment/gantt/resourcesGantt.js
// GET /api/resources/gantt
// 资源甘特图: 按天/周展示资源占用, 可选 compare 对比
// Author: 三狗子 | Date: 2026-06-24

const { all, get, run, wrap } = require("./_helpers");
function getResourcesGantt(req, res, db) {
  const { start_date, days, instance_id, compare } = req.query;
  const startDate = new Date(start_date || new Date().toISOString().slice(0, 10));
  const numDays = parseInt(days) || 30;
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + numDays);
  const instanceFilter = instance_id ? parseInt(instance_id, 10) : null;

  const all = (sql, params = []) => db.prepare(sql).all(params);
  const get = (sql, params = []) => db.prepare(sql).get(params);

  // 取 work_orders + process_nodes 的工位 + 时间 + 所属项目
  const woSql = instanceFilter
    ? "SELECT wo.id, wo.wo_code, wo.title, wo.estimated_hours, wo.actual_start, wo.actual_end, wo.planned_start, wo.status, ws.name as ws_name, ws.id as ws_id, ei.id as instance_id, ei.instance_code, ei.instance_name FROM work_orders wo LEFT JOIN workstations ws ON wo.workstation_id = ws.id LEFT JOIN equipment_instances ei ON wo.equipment_instance_id = ei.id WHERE ei.id = ? AND (wo.planned_start IS NOT NULL OR wo.actual_start IS NOT NULL)"
    : "SELECT wo.id, wo.wo_code, wo.title, wo.estimated_hours, wo.actual_start, wo.actual_end, wo.planned_start, wo.status, ws.name as ws_name, ws.id as ws_id, ei.id as instance_id, ei.instance_code, ei.instance_name FROM work_orders wo LEFT JOIN workstations ws ON wo.workstation_id = ws.id LEFT JOIN equipment_instances ei ON wo.equipment_instance_id = ei.id WHERE (wo.planned_start IS NOT NULL OR wo.actual_start IS NOT NULL)";
  const pnSql = instanceFilter
    ? "SELECT pn.id, pn.operation_name, pn.estimated_hours, pn.planned_start, pn.actual_start, pn.status, ws.name as ws_name, ws.id as ws_id, ei.id as instance_id, ei.instance_code, ei.instance_name FROM process_nodes pn LEFT JOIN workstations ws ON pn.required_workstation_id = ws.id JOIN equipment_instances ei ON pn.equipment_instance_id = ei.id WHERE ei.id = ? AND (pn.planned_start IS NOT NULL OR pn.actual_start IS NOT NULL)"
    : "SELECT pn.id, pn.operation_name, pn.estimated_hours, pn.planned_start, pn.actual_start, pn.status, ws.name as ws_name, ws.id as ws_id, ei.id as instance_id, ei.instance_code, ei.instance_name FROM process_nodes pn LEFT JOIN workstations ws ON pn.required_workstation_id = ws.id JOIN equipment_instances ei ON pn.equipment_instance_id = ei.id WHERE (pn.planned_start IS NOT NULL OR pn.actual_start IS NOT NULL)";
  const workOrders = all(woSql, instanceFilter ? [instanceFilter] : []);
  const processNodes = all(pnSql, instanceFilter ? [instanceFilter] : []);

  // 构建统一 items 数组（带 instance 信息）
  const items = [];
  workOrders.forEach((w) => {
    const s = w.actual_start || w.planned_start;
    if (!s) return;
    const start = new Date(s);
    const hours = w.estimated_hours || 8;
    const end = new Date(start.getTime() + hours * 3600 * 1000);
    items.push({ id: 'wo_' + w.id, type: 'work_order', name: w.wo_code + ' ' + (w.title || ''), workstation: w.ws_name || '未分配', ws_id: w.ws_id, instance_id: w.instance_id, instance_code: w.instance_code, instance_name: w.instance_name, start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), status: w.status, hours: hours });
  });
  processNodes.forEach((p) => {
    const s = p.actual_start || p.planned_start;
    if (!s) return;
    const start = new Date(s);
    const hours = p.estimated_hours || 4;
    const end = new Date(start.getTime() + hours * 3600 * 1000);
    items.push({ id: 'pn_' + p.id, type: 'process_node', name: p.operation_name, workstation: p.ws_name || '未分配', ws_id: p.ws_id, instance_id: p.instance_id, instance_code: p.instance_code, instance_name: p.instance_name, start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), status: p.status, hours: hours });
  });

  const workstations = all('SELECT id, name, workshop FROM workstations ORDER BY id');

  // ========== 工位热力图 (workstation × day -> busy_hours) ==========
  // 对每个 item 按工位分组，按 day 切片，累加 hours
  const heatmap = {}; // ws_id -> { name, by_day: { 'YYYY-MM-DD': busy_hours } }
  for (const ws of workstations) {
    heatmap[ws.id] = { ws_id: ws.id, name: ws.name, by_day: {} };
  }
  for (const it of items) {
    if (!it.ws_id) continue;
    if (!heatmap[it.ws_id]) continue;
    // 跨天切分 hours（按 day 对齐）
    const startD = new Date(it.start + 'T00:00:00');
    const endD = new Date(it.end + 'T00:00:00');
    const totalDays = Math.max(1, Math.round((endD - startD) / (24 * 3600 * 1000)));
    const perDay = it.hours / totalDays;
    for (let d = 0; d < totalDays; d++) {
      const day = new Date(startD.getTime() + d * 24 * 3600 * 1000).toISOString().slice(0, 10);
      heatmap[it.ws_id].by_day[day] = (heatmap[it.ws_id].by_day[day] || 0) + perDay;
    }
  }
  // 转成二维数组 (rows: workstation, cols: day)
  const dayList = [];
  for (let d = 0; d < numDays; d++) {
    dayList.push(new Date(startDate.getTime() + d * 24 * 3600 * 1000).toISOString().slice(0, 10));
  }
  const heatmapGrid = workstations.map((ws) => {
    const cells = dayList.map((day) => {
      const busy = heatmap[ws.id].by_day[day] || 0;
      const util = Math.min(100, Math.round(busy / 24 * 100)); // 1 工位 24h 为 100%
      return { day, busy_hours: Math.round(busy * 10) / 10, utilization_pct: util, level: util >= 90 ? 'overload' : util >= 70 ? 'busy' : util >= 30 ? 'normal' : 'idle' };
    });
    const busyHours = cells.reduce((s, c) => s + c.busy_hours, 0);
    return { ws_id: ws.id, name: ws.name, total_busy_hours: Math.round(busyHours * 10) / 10, avg_utilization_pct: Math.round(busyHours / (numDays * 24) * 100), cells };
  });

  // ========== 按项目拆分 (instance breakdown) ==========
  const byInstance = {};
  for (const it of items) {
    const key = it.instance_id || 'unassigned';
    if (!byInstance[key]) byInstance[key] = { instance_id: it.instance_id, instance_code: it.instance_code || 'N/A', instance_name: it.instance_name || '', item_count: 0, total_hours: 0, workstations: new Set() };
    byInstance[key].item_count++;
    byInstance[key].total_hours += it.hours;
    if (it.ws_id) byInstance[key].workstations.add(it.ws_id);
  }
  const instanceBreakdown = Object.values(byInstance).map((x) => ({ instance_id: x.instance_id, instance_code: x.instance_code, instance_name: x.instance_name, item_count: x.item_count, total_hours: Math.round(x.total_hours * 10) / 10, workstation_count: x.workstations.size, workstations: [...x.workstations] }));

  // ========== 工位利用率排行 ==========
  const workstationUtil = heatmapGrid.map((h) => ({ ws_id: h.ws_id, name: h.name, total_busy_hours: h.total_busy_hours, avg_utilization_pct: h.avg_utilization_pct, peak_day: h.cells.reduce((max, c) => c.busy_hours > max.busy_hours ? c : max, { day: '', busy_hours: 0 }), peak_utilization_pct: Math.max(...h.cells.map((c) => c.utilization_pct)) })).sort((a, b) => b.avg_utilization_pct - a.avg_utilization_pct);

  // ========== 优化冲突检测 (O(n log n) 排序 + sweep) ==========
  const conflicts = [];
  const byWs = {};
  for (const it of items) { if (!it.ws_id) continue; (byWs[it.ws_id] = byWs[it.ws_id] || []).push(it); }
  for (const wsId in byWs) {
    const list = byWs[wsId].sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i], b = list[i + 1];
      if (b.start <= a.end && a.ws_id) {
        const overlapHours = Math.max(0, (new Date(a.end) - new Date(b.start)) / 3600000);
        conflicts.push({ type: 'same_workstation', workstation: a.workstation, ws_id: parseInt(wsId), items: [{ id: a.id, name: a.name, instance: a.instance_code, start: a.start, end: a.end }, { id: b.id, name: b.name, instance: b.instance_code, start: b.start, end: b.end }], overlap_hours: Math.round(overlapHours * 10) / 10 });
      }
    }
  }
  // 容量超载：单工位单日 busy > 24h
  for (const h of heatmapGrid) {
    for (const cell of h.cells) {
      if (cell.busy_hours > 24) {
        conflicts.push({ type: 'capacity_overload', workstation: h.name, ws_id: h.ws_id, day: cell.day, busy_hours: cell.busy_hours, utilization_pct: cell.utilization_pct });
      }
    }
  }

  res.json({
    start_date: startDate.toISOString().slice(0, 10),
    end_date: endDate.toISOString().slice(0, 10),
    num_days: numDays,
    filter: { instance_id: instanceFilter, compare: compare === '1' },
    workstations: workstations,
    summary: { total_items: items.length, total_hours: Math.round(items.reduce((s, it) => s + it.hours, 0) * 10) / 10, instance_count: instanceBreakdown.length, workstation_count: workstations.length, conflict_count: conflicts.length },
    heatmap: { days: dayList, grid: heatmapGrid },
    instance_breakdown: instanceBreakdown,
    workstation_utilization: workstationUtil,
    items: items,
    conflicts: conflicts
  });
}

module.exports = { getResourcesGantt };
