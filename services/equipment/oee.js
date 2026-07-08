'use strict';
const { wrap } = require('../../middleware/asyncHandler');
// services/oee.js
// P2-#C OEE 设备产能分析
// 公式 (简化版):
//   Available = 24h × days × 1 (单机位)
//   Busy = sum of item.hours overlapping the window
//   Utilization% = Busy / Available × 100
//   (真正的 OEE = A × P × Q, 我们暂时只算 A, 等生产实绩数据)

function register(app, db) {
  const all = (sql, params = []) => db.prepare(sql).all(params);
  

  function getOEE(req, res) {
    const startDate = new Date(req.query.start_date || new Date().toISOString().slice(0, 10));
    const numDays = Math.min(parseInt(req.query.days) || 30, 365);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + numDays);
    const today = new Date().toISOString().slice(0, 10);

    const workstations = all('SELECT id, name, workshop FROM workstations ORDER BY id');

    // 窗口内的 process_nodes (按 planned 或 actual)
    const items = all(
      "SELECT pn.id, pn.estimated_hours as hours, pn.planned_start, pn.planned_end, pn.actual_start, pn.actual_end, pn.status, pn.required_workstation_id as ws_id, ei.instance_code FROM process_nodes pn JOIN equipment_instances ei ON pn.equipment_instance_id = ei.id WHERE pn.required_workstation_id IS NOT NULL AND (pn.planned_end IS NOT NULL OR pn.actual_end IS NOT NULL)"
    );

    // 按工位聚合 busy_hours (按天切片, 与 P2-#B heatmap 一致)
    const wsBusy = {};
    for (const ws of workstations) wsBusy[ws.id] = 0;
    const wsItems = {};
    for (const ws of workstations) wsItems[ws.id] = new Set();

    for (const it of items) {
      const start = it.actual_start || it.planned_start;
      const end = it.actual_end || it.planned_end;
      if (!start || !end) continue;
      const startD = new Date(start);
      const endD = new Date(end);
      if (endD < startDate || startD > endDate) continue;
      // 裁剪到窗口
      const clipStart = startD < startDate ? startDate : startD;
      const clipEnd = endD > endDate ? endDate : endD;
      const overlapDays = Math.max(0, (clipEnd - clipStart) / (24 * 3600 * 1000));
      if (overlapDays > 0 && it.ws_id && wsBusy[it.ws_id] !== undefined) {
        wsBusy[it.ws_id] += overlapDays * 24; // days → hours
      }
      if (it.ws_id) wsItems[it.ws_id].add(it.id);
    }

    const availablePerWs = numDays * 24;
    const fleetAvailable = availablePerWs * workstations.length;

    const wsMetrics = workstations.map(ws => {
      const busy = Math.round(wsBusy[ws.id] * 10) / 10;
      const util = availablePerWs > 0 ? Math.round(busy / availablePerWs * 100) : 0;
      let level = 'idle';
      if (util >= 90) level = 'overload';
      else if (util >= 70) level = 'busy';
      else if (util >= 30) level = 'normal';
      return {
        ws_id: ws.id,
        name: ws.name,
        workshop: ws.workshop,
        available_hours: availablePerWs,
        busy_hours: busy,
        idle_hours: Math.round((availablePerWs - busy) * 10) / 10,
        utilization_pct: util,
        item_count: wsItems[ws.id].size,
        level: level
      };
    }).sort((a, b) => b.utilization_pct - a.utilization_pct);

    const fleetBusy = wsMetrics.reduce((s, w) => s + w.busy_hours, 0);
    const fleetUtil = fleetAvailable > 0 ? Math.round(fleetBusy / fleetAvailable * 100) : 0;
    const bottleneck = wsMetrics[0];
    const leastBusy = wsMetrics[wsMetrics.length - 1];
    const overloaded = wsMetrics.filter(w => w.level === 'overload').length;
    const idle = wsMetrics.filter(w => w.level === 'idle').length;

    res.json({
      start_date: startDate.toISOString().slice(0, 10),
      end_date: endDate.toISOString().slice(0, 10),
      num_days: numDays,
      today: today,
      summary: {
        fleet_available_hours: fleetAvailable,
        fleet_busy_hours: Math.round(fleetBusy * 10) / 10,
        fleet_utilization_pct: fleetUtil,
        workstation_count: workstations.length,
        overloaded_count: overloaded,
        idle_count: idle,
        bottleneck: bottleneck && bottleneck.utilization_pct > 0 ? { ws_id: bottleneck.ws_id, name: bottleneck.name, utilization_pct: bottleneck.utilization_pct } : null,
        least_busy: leastBusy && leastBusy.utilization_pct < bottleneck.utilization_pct ? { ws_id: leastBusy.ws_id, name: leastBusy.name, utilization_pct: leastBusy.utilization_pct } : null
      },
      workstations: wsMetrics,
      note: 'OEE 简化为单工位利用率 (Availability). 完整 OEE = A × P × Q, 等生产实绩数据接入.'
    });
  }

  app.get('/api/equipment/oee', wrap(getOEE));
}

module.exports = { register };
