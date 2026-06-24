'use strict';
// services/delayAlerts.js
// P2-#D 延误预警
// 规则: planned_end < today AND status NOT IN ('completed', 'cancelled')
// 严重度: > 7d=critical, > 3d=high, > 0d=warning

function register(app, db) {
  const all = (sql, params = []) => db.prepare(sql).all(params);
  const wrap = (h) => (req, res) => { try { h(req, res); } catch (e) { console.error(e); res.status(500).json({ error: e.message }); } };

  function severityOf(d) {
    if (d > 7) return 'critical';
    if (d >= 3) return 'high';
    if (d > 0) return 'warning';
    return 'on_track';
  }

  function getDelays(req, res) {
    const today = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const severityFilter = req.query.severity;

    const woSql = "SELECT wo.id, 'wo_' || wo.id as uid, 'work_order' as type, wo.wo_code as code, wo.title as name, wo.planned_end, wo.status, wo.equipment_instance_id, ei.instance_code, ei.instance_name, CAST(julianday(?) - julianday(wo.planned_end) AS REAL) as days_overdue FROM work_orders wo JOIN equipment_instances ei ON wo.equipment_instance_id = ei.id WHERE wo.planned_end IS NOT NULL AND wo.planned_end < ? AND wo.status NOT IN ('completed', 'cancelled') ORDER BY wo.planned_end ASC";
    const pnSql = "SELECT pn.id, 'pn_' || pn.id as uid, 'process_node' as type, NULL as code, pn.operation_name as name, pn.planned_end, pn.status, pn.equipment_instance_id, ei.instance_code, ei.instance_name, CAST(julianday(?) - julianday(pn.planned_end) AS REAL) as days_overdue FROM process_nodes pn JOIN equipment_instances ei ON pn.equipment_instance_id = ei.id WHERE pn.planned_end IS NOT NULL AND pn.planned_end < ? AND pn.status NOT IN ('completed') ORDER BY pn.planned_end ASC";

    const woRows = all(woSql, [today, today]);
    const pnRows = all(pnSql, [today, today]);

    const delays = [];
    for (const w of woRows) {
      const d = Math.round(w.days_overdue * 10) / 10;
      delays.push({ uid: w.uid, type: w.type, id: w.id, code: w.code, name: w.name, planned_end: w.planned_end, status: w.status, instance_id: w.equipment_instance_id, instance_code: w.instance_code, instance_name: w.instance_name, days_overdue: d, severity: severityOf(d) });
    }
    for (const p of pnRows) {
      const d = Math.round(p.days_overdue * 10) / 10;
      delays.push({ uid: p.uid, type: p.type, id: p.id, code: p.code, name: p.name, planned_end: p.planned_end, status: p.status, instance_id: p.equipment_instance_id, instance_code: p.instance_code, instance_name: p.instance_name, days_overdue: d, severity: severityOf(d) });
    }
    delays.sort((a, b) => b.days_overdue - a.days_overdue);

    const filtered = severityFilter ? delays.filter(d => d.severity === severityFilter) : delays;
    const bySeverity = { critical: 0, high: 0, warning: 0 };
    for (const d of delays) bySeverity[d.severity]++;

    res.json({ today: today, total: delays.length, by_severity: bySeverity, items: filtered.slice(0, limit) });
  }

  function getDelaySummary(req, res) {
    const today = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const woCount = all("SELECT count(*) c FROM work_orders WHERE planned_end < ? AND planned_end IS NOT NULL AND status NOT IN ('completed', 'cancelled')", [today])[0].c;
    const pnCount = all("SELECT count(*) c FROM process_nodes WHERE planned_end < ? AND planned_end IS NOT NULL AND status NOT IN ('completed')", [today])[0].c;
    res.json({ today: today, work_order_delays: woCount, process_node_delays: pnCount, total: woCount + pnCount });
  }

  app.get('/api/dashboard/delays', wrap(getDelays));
  app.get('/api/dashboard/delays/summary', wrap(getDelaySummary));
}

module.exports = { register };
