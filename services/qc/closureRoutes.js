"use strict";

const { appendClosureNote, evaluateNcrClosure } = require("../../app/domain/qualityNcr");
const { wrap } = require("../../middleware/asyncHandler");

function registerClosureRoutes({ app, helpers, ApiError }) {
  const { all, get, run } = helpers;

  app.post("/api/qc/ncr/:id/recheck", wrap((req, res) => {
    const ncr = get("SELECT id FROM ncr_reports WHERE id = ?", [req.params.id]);
    if (!ncr) throw ApiError.notFound("NCR not found");
    const { result, inspector_id, notes } = req.body || {};
    if (!["pass", "fail"].includes(result)) throw ApiError.validation("result must be pass/fail");
    const created = run("INSERT INTO ncr_rechecks (ncr_id, result, inspector_id, notes) VALUES (?, ?, ?, ?)",
      [req.params.id, result, inspector_id || null, notes || null]);
    res.json({ id: created.lastInsertRowid, ok: true });
  }));

  app.get("/api/qc/ncr/:id/closure", wrap((req, res) => {
    const ncr = get(`
      SELECT n.*, ei.instance_code, u.full_name as created_by_name,
        CASE
          WHEN n.closed_at IS NOT NULL THEN 'closed'
          WHEN n.disposition IS NOT NULL AND n.disposition != 'pending' THEN 'disposed'
          ELSE 'open'
        END AS status
      FROM ncr_reports n
      LEFT JOIN equipment_instances ei ON n.equipment_instance_id = ei.id
      LEFT JOIN users u ON n.created_by = u.id
      WHERE n.id = ?
    `, [req.params.id]);
    if (!ncr) throw ApiError.notFound("NCR not found");
    const capaActions = all(`
      SELECT c.*, u.full_name as assignee_name,
        CASE WHEN c.due_date IS NOT NULL AND date(c.due_date) < date('now') AND c.status != 'closed' THEN 1 ELSE 0 END AS overdue
      FROM capa_actions c
      LEFT JOIN users u ON c.assigned_to = u.id
      WHERE c.ncr_id = ?
      ORDER BY c.created_at DESC
    `, [req.params.id]);
    const rechecks = all(`
      SELECT r.*, u.full_name AS inspector_name
      FROM ncr_rechecks r
      LEFT JOIN users u ON r.inspector_id = u.id
      WHERE r.ncr_id = ?
      ORDER BY r.created_at DESC
    `, [req.params.id]);
    const closure = evaluateNcrClosure(ncr, capaActions, rechecks);
    res.json({
      ncr,
      capa_actions: capaActions,
      rechecks,
      checklist: closure.checklist,
      blockers: closure.blockers,
      can_close: closure.canClose,
    });
  }));

  app.post("/api/qc/ncr/:id/close", wrap((req, res) => {
    const ncr = get("SELECT * FROM ncr_reports WHERE id = ?", [req.params.id]);
    if (!ncr) throw ApiError.notFound("NCR not found");
    const capaActions = all("SELECT status FROM capa_actions WHERE ncr_id = ?", [req.params.id]);
    const rechecks = all("SELECT result FROM ncr_rechecks WHERE ncr_id = ?", [req.params.id]);
    const closure = evaluateNcrClosure(ncr, capaActions, rechecks);
    if (!closure.canClose) throw ApiError.validation(`NCR closure checklist is not complete: ${closure.blockers.join("、")}`);
    const { note } = req.body || {};
    const rootCause = appendClosureNote(ncr.root_cause, note);
    run("UPDATE ncr_reports SET closed_at = COALESCE(closed_at, datetime('now')), root_cause = ? WHERE id = ?", [rootCause || null, req.params.id]);
    res.json({ ok: true });
  }));
}

module.exports = { registerClosureRoutes };
