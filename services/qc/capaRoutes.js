"use strict";

const { wrap } = require("../../middleware/asyncHandler");

function registerCapaRoutes({ app, helpers, ApiError }) {
  const { all, get, run } = helpers;

  app.post("/api/qc/ncr/:id/capa", wrap((req, res) => {
    const ncr = get("SELECT id FROM ncr_reports WHERE id = ?", [req.params.id]);
    if (!ncr) throw ApiError.notFound("NCR not found");
    const { action_type, action_desc, assigned_to, due_date } = req.body;
    if (!action_type || !action_desc) throw ApiError.validation("action_type/action_desc required");
    const created = run("INSERT INTO capa_actions (ncr_id, action_type, action_desc, assigned_to, due_date) VALUES (?, ?, ?, ?, ?)",
      [req.params.id, action_type, action_desc, assigned_to || null, due_date || null]);
    res.json({ id: created.lastInsertRowid });
  }));

  app.get("/api/qc/capa", wrap((req, res) => {
    const { status, assigned_to } = req.query;
    let sql = `SELECT c.*, n.ncr_code, n.defect_desc, u.full_name as assignee_name,
      CASE WHEN c.due_date IS NOT NULL AND date(c.due_date) < date('now') AND c.status != 'closed' THEN 1 ELSE 0 END AS overdue
      FROM capa_actions c
      LEFT JOIN ncr_reports n ON c.ncr_id = n.id
      LEFT JOIN users u ON c.assigned_to = u.id
      WHERE 1=1`;
    const params = [];
    if (status === "overdue") sql += " AND c.due_date IS NOT NULL AND date(c.due_date) < date('now') AND c.status != 'closed'";
    else if (status) { sql += " AND c.status = ?"; params.push(status); }
    if (assigned_to) { sql += " AND c.assigned_to = ?"; params.push(assigned_to); }
    sql += " ORDER BY c.created_at DESC";
    res.json(all(sql, params));
  }));

  app.put("/api/qc/capa/:id", wrap((req, res) => {
    const capa = get("SELECT id, status FROM capa_actions WHERE id = ?", [req.params.id]);
    if (!capa) throw ApiError.notFound("CAPA not found");
    const { status, completed_at, verified_by, effectiveness } = req.body;
    run("UPDATE capa_actions SET status = ?, completed_at = ?, verified_by = ?, verified_at = CASE WHEN ? IS NOT NULL THEN datetime('now') ELSE verified_at END, effectiveness = ? WHERE id = ?",
      [status || capa.status, completed_at || null, verified_by || null, verified_by, effectiveness || null, req.params.id]);
    res.json({ ok: true });
  }));

  app.get("/api/qc/ncr/:id/capa", wrap((req, res) => {
    const ncr = get("SELECT id FROM ncr_reports WHERE id = ?", [req.params.id]);
    if (!ncr) throw ApiError.notFound("NCR not found");
    const rows = all(`
      SELECT c.*, u.full_name as assignee_name,
        CASE WHEN c.due_date IS NOT NULL AND date(c.due_date) < date('now') AND c.status != 'closed' THEN 1 ELSE 0 END AS overdue
      FROM capa_actions c
      LEFT JOIN users u ON c.assigned_to = u.id
      WHERE c.ncr_id = ?
      ORDER BY c.created_at DESC
    `, [req.params.id]);
    res.json(rows);
  }));

  app.put("/api/qc/capa/:id/complete", wrap((req, res) => {
    const capa = get("SELECT id FROM capa_actions WHERE id = ?", [req.params.id]);
    if (!capa) throw ApiError.notFound("CAPA not found");
    const { effectiveness, verified_by } = req.body || {};
    run(`
      UPDATE capa_actions
      SET status = 'closed',
          completed_at = COALESCE(completed_at, datetime('now')),
          verified_by = COALESCE(?, verified_by),
          verified_at = CASE WHEN ? IS NOT NULL THEN datetime('now') ELSE verified_at END,
          effectiveness = COALESCE(?, effectiveness)
      WHERE id = ?
    `, [verified_by || null, verified_by || null, effectiveness || null, req.params.id]);
    res.json({ ok: true });
  }));
}

module.exports = { registerCapaRoutes };
