"use strict";
const { wrap } = require("../middleware/asyncHandler");

function register(app, db) {
  function all(sql, params = []) {
    try { return db.prepare(sql).all(params); } catch (_e) { return []; }
  }
  function get(sql, params = []) {
    try { return db.prepare(sql).get(params) || null; } catch (_e) { return null; }
  }
  function tableExists(name) {
    return Boolean(get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [name]));
  }

  app.get("/api/shopfloor/overview", wrap((req, res) => {
    const uid = req.user?.sub || req.user?.uid || req.user?.id || null;
    const workOrders = all(`
      SELECT wo.*, ei.instance_code, ws.name AS workstation_name
      FROM work_orders wo
      LEFT JOIN equipment_instances ei ON ei.id = wo.equipment_instance_id
      LEFT JOIN workstations ws ON ws.id = wo.workstation_id
      WHERE COALESCE(wo.status, '') NOT IN ('completed', 'closed', 'cancelled')
      ORDER BY
        CASE wo.status WHEN 'in_progress' THEN 0 WHEN 'dispatched' THEN 1 ELSE 2 END,
        wo.planned_end IS NULL,
        wo.planned_end ASC,
        wo.id DESC
      LIMIT 20
    `);
    const activeWo = workOrders[0] || null;

    const pendingDocs = tableExists("documents") ? all(`
      SELECT d.*, ei.instance_code
      FROM documents d
      LEFT JOIN equipment_instances ei ON ei.id = d.equipment_instance_id
      WHERE d.status = 'issued'
        AND d.id NOT IN (SELECT doc_id FROM doc_acknowledgements WHERE ack_by = ?)
      ORDER BY d.issued_at DESC, d.id DESC
      LIMIT 10
    `, [uid || 0]) : [];

    const exceptions = tableExists("exception_cases") ? all(`
      SELECT ec.*, ec.exception_id AS id
      FROM exception_cases ec
      WHERE COALESCE(ec.status, 'open') != 'closed'
      ORDER BY ec.updated_at DESC
      LIMIT 10
    `) : [];

    const recentReports = tableExists("work_report_details") ? all(`
      SELECT wr.*, wo.wo_code, wo.title AS wo_title, u.full_name AS worker_name
      FROM work_report_details wr
      LEFT JOIN work_orders wo ON wo.id = wr.work_order_id
      LEFT JOIN users u ON u.id = wr.worker_id
      ORDER BY wr.reported_at DESC
      LIMIT 10
    `) : [];

    const qcRecent = tableExists("qc_inspections") ? all(`
      SELECT q.*, ei.instance_code, u.full_name AS inspector_name
      FROM qc_inspections q
      LEFT JOIN equipment_instances ei ON ei.id = q.equipment_instance_id
      LEFT JOIN users u ON u.id = q.inspector_id
      ORDER BY q.inspection_date DESC
      LIMIT 10
    `) : [];

    const todayReports = tableExists("work_report_details")
      ? get("SELECT COUNT(*) AS c, COALESCE(SUM(hours_spent),0) AS hours FROM work_report_details WHERE date(reported_at)=date('now')")
      : { c: 0, hours: 0 };
    const todayQcFail = tableExists("qc_inspections")
      ? get("SELECT COUNT(*) AS c FROM qc_inspections WHERE date(inspection_date)=date('now') AND result='fail'")
      : { c: 0 };

    res.json({
      summary: {
        active_work_orders: workOrders.length,
        pending_docs: pendingDocs.length,
        open_exceptions: exceptions.length,
        today_reports: todayReports?.c || 0,
        today_hours: Math.round((todayReports?.hours || 0) * 10) / 10,
        today_qc_fail: todayQcFail?.c || 0,
      },
      active_work_order: activeWo,
      work_orders: workOrders,
      pending_documents: pendingDocs,
      exceptions,
      recent_reports: recentReports,
      qc_recent: qcRecent,
    });
  }));
}

module.exports = { register };
