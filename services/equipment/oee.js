"use strict";
// services/equipment/oee.js
// GET /api/equipment/oee —— 工位利用率 / 简化 OEE（Availability）
//
// 2026-11-05 审计整改（P1）：
//   1) 窗口改为「近 N 天」（原实现从今天往后算，统计的是未来计划负荷，字段却叫利用率）；
//      仍支持显式 ?start_date= 用于回看历史。
//   2) busy 工时按任务工时 × 窗口重叠比例摊销（原实现用日历重叠天数 × 24h，
//      跨天任务会被严重高估，例如 4h 任务跨 2 天算成 48h）。
//   3) 每日可用工时按工位班次 × 人数（与 /multi-schedule 同一口径），不再固定 24h/天。
//   4) 响应带 capacity_basis / window 与 data_range，前端可解释口径与提示数据区间。
const { wrap } = require("../../middleware/asyncHandler");
const { workstationDailyCapacity } = require("../../shared/capacity");

const MS_PER_HOUR = 3600 * 1000;

function parseDateUtc(value) {
  if (!value) return new Date(NaN);
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(raw + "T00:00:00Z");
  if (raw.endsWith("Z")) return new Date(raw);
  return new Date(raw.replace(" ", "T") + "Z");
}

function formatDateUtc(date) {
  return date.toISOString().slice(0, 10);
}

function shiftDateUtc(date, days) {
  return new Date(date.getTime() + Number(days || 0) * 24 * MS_PER_HOUR);
}

function register(app, db) {
  const all = (sql, params = []) => db.prepare(sql).all(params);

  function workstationColumns() {
    try {
      return new Set(db.prepare("PRAGMA table_info(workstations)").all().map((column) => column.name));
    } catch (_error) {
      return new Set();
    }
  }

  function getOEE(req, res) {
    const numDays = Math.min(Math.max(Number.parseInt(req.query.days, 10) || 30, 1), 365);
    const todayUtc = parseDateUtc(formatDateUtc(new Date()));
    let startDate;
    let windowMode = "past";
    if (req.query.start_date) {
      startDate = parseDateUtc(req.query.start_date);
      if (Number.isNaN(startDate.getTime())) startDate = shiftDateUtc(todayUtc, -numDays);
      else windowMode = "explicit";
    } else {
      // 近 N 天：今天往前 N 天（含今天）
      startDate = shiftDateUtc(todayUtc, -(numDays - 1));
    }
    const endDate = shiftDateUtc(startDate, numDays);

    const columns = workstationColumns();
    const shiftSelect = columns.has("shift") ? ", shift" : ", 'day' AS shift";
    const workerSelect = columns.has("max_workers") ? ", max_workers" : ", 1 AS max_workers";
    const workstations = all(`SELECT id, name, workshop${shiftSelect}${workerSelect} FROM workstations ORDER BY id`);

    const items = all(
      "SELECT pn.id, pn.estimated_hours AS hours, pn.planned_start, pn.planned_end, pn.actual_start, pn.actual_end, pn.status, pn.required_workstation_id AS ws_id, ei.instance_code FROM process_nodes pn JOIN equipment_instances ei ON pn.equipment_instance_id = ei.id WHERE pn.required_workstation_id IS NOT NULL AND (pn.planned_start IS NOT NULL OR pn.actual_start IS NOT NULL)"
    );

    const wsBusy = {};
    const wsItems = {};
    for (const ws of workstations) {
      wsBusy[ws.id] = 0;
      wsItems[ws.id] = new Set();
    }

    let earliestStart = null;
    let latestEnd = null;
    for (const item of items) {
      const start = item.actual_start || item.planned_start;
      const end = item.actual_end || item.planned_end;
      if (!start || !end) continue;
      const startD = parseDateUtc(start);
      const endD = parseDateUtc(end);
      if (Number.isNaN(startD.getTime()) || Number.isNaN(endD.getTime()) || endD <= startD) continue;
      if (!earliestStart || startD < earliestStart) earliestStart = startD;
      if (!latestEnd || endD > latestEnd) latestEnd = endD;
      if (endD < startDate || startD > endDate) continue;
      const clipStart = startD < startDate ? startDate : startD;
      const clipEnd = endD > endDate ? endDate : endD;
      const overlapHours = Math.max(0, (clipEnd.getTime() - clipStart.getTime()) / MS_PER_HOUR);
      if (overlapHours <= 0) continue;
      if (!item.ws_id || wsBusy[item.ws_id] === undefined) continue;

      // 任务工时：优先 estimated_hours；缺失时用计划/实际跨度
      const spanHours = Math.max((endD.getTime() - startD.getTime()) / MS_PER_HOUR, 0.25);
      const taskHours = Number(item.hours) > 0 ? Number(item.hours) : spanHours;
      const ratio = Math.min(1, overlapHours / spanHours);
      wsBusy[item.ws_id] += taskHours * ratio;
      wsItems[item.ws_id].add(item.id);
    }

    const wsMetrics = workstations.map((ws) => {
      const dailyCapacity = workstationDailyCapacity(ws);
      const availableHours = numDays * dailyCapacity;
      const busy = Math.round(wsBusy[ws.id] * 10) / 10;
      const utilization = availableHours > 0 ? Math.round((busy / availableHours) * 100) : 0;
      let level = "idle";
      if (utilization >= 90) level = "overload";
      else if (utilization >= 70) level = "busy";
      else if (utilization >= 30) level = "normal";
      return {
        ws_id: ws.id,
        name: ws.name,
        workshop: ws.workshop,
        shift: ws.shift || "day",
        max_workers: Number(ws.max_workers || 1),
        daily_capacity_hours: dailyCapacity,
        available_hours: availableHours,
        busy_hours: busy,
        idle_hours: Math.max(0, Math.round((availableHours - busy) * 10) / 10),
        utilization_pct: utilization,
        item_count: wsItems[ws.id].size,
        level,
      };
    }).sort((a, b) => b.utilization_pct - a.utilization_pct || a.ws_id - b.ws_id);

    const fleetAvailable = wsMetrics.reduce((sum, row) => sum + row.available_hours, 0);
    const fleetBusy = Math.round(wsMetrics.reduce((sum, row) => sum + row.busy_hours, 0) * 10) / 10;
    const fleetUtil = fleetAvailable > 0 ? Math.round((fleetBusy / fleetAvailable) * 100) : 0;
    const bottleneck = wsMetrics[0];
    const leastBusy = wsMetrics[wsMetrics.length - 1];
    const overloaded = wsMetrics.filter((row) => row.level === "overload").length;
    const idle = wsMetrics.filter((row) => row.level === "idle").length;

    res.json({
      start_date: formatDateUtc(startDate),
      end_date: formatDateUtc(endDate),
      num_days: numDays,
      today: formatDateUtc(todayUtc),
      window: { mode: windowMode, days: numDays },
      capacity_basis: "shift_workers",
      data_range: {
        earliest_node_start: earliestStart ? formatDateUtc(earliestStart) : null,
        latest_node_end: latestEnd ? formatDateUtc(latestEnd) : null,
      },
      summary: {
        fleet_available_hours: fleetAvailable,
        fleet_busy_hours: fleetBusy,
        fleet_utilization_pct: fleetUtil,
        workstation_count: workstations.length,
        overloaded_count: overloaded,
        idle_count: idle,
        bottleneck: bottleneck && bottleneck.utilization_pct > 0
          ? { ws_id: bottleneck.ws_id, name: bottleneck.name, utilization_pct: bottleneck.utilization_pct }
          : null,
        least_busy: leastBusy && leastBusy.utilization_pct < bottleneck.utilization_pct
          ? { ws_id: leastBusy.ws_id, name: leastBusy.name, utilization_pct: leastBusy.utilization_pct }
          : null,
      },
      workstations: wsMetrics,
      note: "OEE 简化为工位可用率 (Availability)；可用工时 = 班次工时 × 人数（封顶 24h），busy = 任务工时按窗口重叠比例摊销。完整 OEE = A × P × Q，等生产实绩/班次数据接入。",
    });
  }

  app.get("/api/equipment/oee", wrap(getOEE));
}

module.exports = { register };
