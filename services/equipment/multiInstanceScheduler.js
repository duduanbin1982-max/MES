'use strict';
const { wrap } = require('../../middleware/asyncHandler');
// services/multiInstanceScheduler.js
// P2 扩展: 跨实例资源池调度
// 思路: 对每个 instance 跑 P2-#A 的单实例排程(dryRun), 然后聚合工位占用, 检测跨实例冲突
// 冲突时不自动解决 - 只报告, 让用户决定 (人工挪工期 / 加设备 / 接外协)

function register(app, db) {
  const all = (sql, params = []) => db.prepare(sql).all(params);
  const get = (sql, params = []) => db.prepare(sql).get(params);
  



  // 单实例排程 (与 services/scheduler.js 同算法, 但 dryRun 必为 true)
  // 读 DB 中已排程的 planned_start/planned_end (不重新算)
  function scheduleFromDB(instanceId) {
    const inst = get('SELECT * FROM equipment_instances WHERE id = ?', instanceId);
    if (!inst) return { error: 'instance not found' };
    const rows = all("SELECT id, operation_name, planned_start, planned_end, estimated_hours, required_workstation_id as ws_id, status FROM process_nodes WHERE equipment_instance_id = ? AND planned_start IS NOT NULL AND planned_end IS NOT NULL ORDER BY planned_start", instanceId);
    const scheduled = rows.map(r => ({
      id: r.id, operation_name: r.operation_name,
      planned_start: r.planned_start, planned_end: r.planned_end,
      hours: r.estimated_hours || 0, ws_id: r.ws_id, status: r.status
    }));
    return { instance_id: instanceId, instance_code: inst.instance_code, instance_name: inst.instance_name, scheduled };
  }

  function getGlobal(req, res) {
    const instances = all("SELECT id, instance_code, instance_name, planned_start, start_date, status FROM equipment_instances WHERE status != 'cancelled' ORDER BY planned_start, id");
    const workstations = all('SELECT id, name FROM workstations ORDER BY id');

    const results = [];
    const wsUsage = {};
    for (const ws of workstations) wsUsage[ws.id] = { ws_id: ws.id, name: ws.name, bookings: [] };

    for (const inst of instances) {
      const r = scheduleFromDB(inst.id);
      if (r.error) { results.push({ instance_id: inst.id, instance_code: inst.instance_code, error: r.error }); continue; }
      results.push({ instance_id: inst.id, instance_code: inst.instance_code, instance_name: inst.instance_name, scheduled_count: r.scheduled.length });
      for (const node of r.scheduled) {
        if (node.ws_id) {
          wsUsage[node.ws_id].bookings.push({
            start: node.planned_start, end: node.planned_end, hours: node.hours,
            instance_id: inst.id, instance_code: inst.instance_code,
            node_id: node.id, node_name: node.operation_name
          });
        }
      }
    }

    // 跨实例冲突检测
    const crossConflicts = [];
    for (const wsId in wsUsage) {
      const bookings = wsUsage[wsId].bookings.sort((a, b) => a.start.localeCompare(b.start));
      for (let i = 0; i < bookings.length - 1; i++) {
        const a = bookings[i], b = bookings[i + 1];
        if (b.start < a.end && a.instance_id !== b.instance_id) {
          const overlapMs = Math.min(new Date(a.end), new Date(b.end)) - Math.max(new Date(a.start), new Date(b.start)); const overlapHours = Math.max(0, overlapMs / 3600000);
          crossConflicts.push({
            type: 'cross_instance',
            ws_id: parseInt(wsId),
            workstation: wsUsage[wsId].name,
            instances: [a.instance_code, b.instance_code],
            items: [
              { instance: a.instance_code, node: a.node_name, start: a.start, end: a.end },
              { instance: b.instance_code, node: b.node_name, start: b.start, end: b.end }
            ],
            overlap_hours: Math.round(overlapHours * 10) / 10
          });
        }
      }
    }

    const wsSummary = Object.values(wsUsage).map(w => ({
      ws_id: w.ws_id, name: w.name, booking_count: w.bookings.length,
      total_hours: Math.round(w.bookings.reduce((s, b) => s + b.hours, 0) * 10) / 10,
      instances: [...new Set(w.bookings.map(b => b.instance_code))]
    })).sort((a, b) => b.total_hours - a.total_hours);

    const summary = {
      instance_count: instances.length,
      workstation_count: workstations.length,
      cross_conflict_count: crossConflicts.length,
      most_contested: crossConflicts.length > 0 ? crossConflicts[0].workstation : null
    };

    res.json({ summary, instances: results, workstation_summary: wsSummary, cross_instance_conflicts: crossConflicts });
  }

  app.get('/api/schedule/global', wrap(getGlobal));
  app.post('/api/schedule/global', wrap(getGlobal));
}

module.exports = { register };
