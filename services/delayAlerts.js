'use strict';
require('../app/errors');
const { wrap } = require('../middleware/asyncHandler');
// services/delayAlerts.js
// P2-#D 延误预警
// 规则: planned_end < now AND status NOT IN ('completed', 'cancelled')
// 严重度: > 7d=critical, >= 3d=high, > 0d=warning
// 2026-11-02：拆两档（业务确认）—— phase=started 已开工超期 / phase=not_started 未开工计划过期 / phase=blocked 受阻

function register(app, db) {
  const { all } = require('./material/core').makeDbHelpers(db);

  const STARTED_STATUSES = new Set(['in_progress', 'paused']);
  const NOT_STARTED_STATUSES = new Set(['pending', 'ready']);

  function phaseOf(status) {
    if (STARTED_STATUSES.has(status)) return 'started';
    if (NOT_STARTED_STATUSES.has(status)) return 'not_started';
    if (status === 'blocked') return 'blocked';
    return 'not_started';
  }

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
    const phaseFilter = req.query.phase;

    const woSql = "SELECT wo.id, 'wo_' || wo.id as uid, 'work_order' as type, wo.wo_code as code, wo.title as name, wo.planned_end, wo.status, wo.equipment_instance_id, ei.instance_code, ei.instance_name, CAST(julianday(?) - julianday(wo.planned_end) AS REAL) as days_overdue FROM work_orders wo JOIN equipment_instances ei ON wo.equipment_instance_id = ei.id WHERE wo.planned_end IS NOT NULL AND wo.planned_end < ? AND wo.status NOT IN ('completed', 'cancelled') ORDER BY wo.planned_end ASC";
    const pnSql = "SELECT pn.id, 'pn_' || pn.id as uid, 'process_node' as type, NULL as code, pn.operation_name as name, pn.planned_end, pn.status, pn.equipment_instance_id, ei.instance_code, ei.instance_name, CAST(julianday(?) - julianday(pn.planned_end) AS REAL) as days_overdue FROM process_nodes pn JOIN equipment_instances ei ON pn.equipment_instance_id = ei.id WHERE pn.planned_end IS NOT NULL AND pn.planned_end < ? AND pn.status NOT IN ('completed', 'cancelled') ORDER BY pn.planned_end ASC";

    const woRows = all(woSql, [today, today]);
    const pnRows = all(pnSql, [today, today]);

    const delays = [];
    for (const w of woRows) {
      const d = Math.round(w.days_overdue * 10) / 10;
      delays.push({ uid: w.uid, type: w.type, id: w.id, code: w.code, name: w.name, planned_end: w.planned_end, status: w.status, phase: phaseOf(w.status), instance_id: w.equipment_instance_id, instance_code: w.instance_code, instance_name: w.instance_name, days_overdue: d, severity: severityOf(d) });
    }
    for (const p of pnRows) {
      const d = Math.round(p.days_overdue * 10) / 10;
      delays.push({ uid: p.uid, type: p.type, id: p.id, code: p.code, name: p.name, planned_end: p.planned_end, status: p.status, phase: phaseOf(p.status), instance_id: p.equipment_instance_id, instance_code: p.instance_code, instance_name: p.instance_name, days_overdue: d, severity: severityOf(d) });
    }
    delays.sort((a, b) => b.days_overdue - a.days_overdue);

    let filtered = severityFilter ? delays.filter(d => d.severity === severityFilter) : delays;
    if (phaseFilter) filtered = filtered.filter(d => d.phase === phaseFilter);
    const bySeverity = { critical: 0, high: 0, warning: 0 };
    const byPhase = { started: 0, not_started: 0, blocked: 0 };
    for (const d of delays) { bySeverity[d.severity]++; byPhase[d.phase]++; }

    res.json({ today: today, total: delays.length, by_severity: bySeverity, by_phase: byPhase, items: filtered.slice(0, limit) });
  }

  function getDelaySummary(req, res) {
    const today = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const count = (sql) => all(sql, [today])[0].c;
    const base = "planned_end < ? AND planned_end IS NOT NULL";
    const woStarted = count(`SELECT count(*) c FROM work_orders WHERE ${base} AND status IN ('in_progress', 'paused')`);
    const woNotStarted = count(`SELECT count(*) c FROM work_orders WHERE ${base} AND status IN ('pending', 'ready')`);
    const pnStarted = count(`SELECT count(*) c FROM process_nodes WHERE ${base} AND status IN ('in_progress', 'paused')`);
    const pnNotStarted = count(`SELECT count(*) c FROM process_nodes WHERE ${base} AND status IN ('pending', 'ready')`);
    const pnBlocked = count(`SELECT count(*) c FROM process_nodes WHERE ${base} AND status = 'blocked'`);
    const woCount = woStarted + woNotStarted;
    const pnCount = pnStarted + pnNotStarted + pnBlocked;
    res.json({
      today: today,
      // 合计（兼容旧消费方）
      work_order_delays: woCount,
      process_node_delays: pnCount,
      total: woCount + pnCount,
      // 2026-11-02：拆分口径
      started: woStarted + pnStarted,
      not_started: woNotStarted + pnNotStarted,
      blocked: pnBlocked,
      by_phase: {
        started: { work_orders: woStarted, process_nodes: pnStarted },
        not_started: { work_orders: woNotStarted, process_nodes: pnNotStarted },
        blocked: { process_nodes: pnBlocked },
      },
    });
  }

  app.get('/api/dashboard/delays', wrap(getDelays));
  app.get('/api/dashboard/delays/summary', wrap(getDelaySummary));
}

module.exports = { register };
