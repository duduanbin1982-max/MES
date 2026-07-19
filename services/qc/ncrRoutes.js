"use strict";

const { wrap } = require("../../middleware/asyncHandler");
const { nextNcrCode } = require("./inspectionRoutes");

function registerNcrRoutes({ app, helpers, ApiError }) {
  const { all, get, run } = helpers;

  app.post("/api/qc/ncr", wrap((req, res) => {
    const { source_type, source_id, equipment_instance_id, part_name, defect_desc, defect_qty, severity, created_by } = req.body;
    if (!defect_desc) throw ApiError.validation("defect_desc required");
    const ncrCode = nextNcrCode(get);
    const created = run(
      "INSERT INTO ncr_reports (ncr_code, source_type, source_id, equipment_instance_id, part_name, defect_desc, defect_qty, severity, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [ncrCode, source_type || null, source_id || null, equipment_instance_id || null, part_name || null, defect_desc, defect_qty || null, severity || "minor", created_by || null]
    );
    res.json({ id: created.lastInsertRowid, ncr_code: ncrCode });
  }));

  app.get("/api/qc/ncr", wrap((req, res) => {
    const { equipment_instance_id, severity, status } = req.query;
    let sql = `SELECT n.*, ei.instance_code, u.full_name as created_by_name,
      CASE
        WHEN n.closed_at IS NOT NULL THEN 'closed'
        WHEN n.disposition IS NOT NULL AND n.disposition != 'pending' THEN 'disposed'
        ELSE 'open'
      END AS status
      FROM ncr_reports n
      LEFT JOIN equipment_instances ei ON n.equipment_instance_id = ei.id
      LEFT JOIN users u ON n.created_by = u.id
      WHERE 1=1`;
    const params = [];
    if (equipment_instance_id) { sql += " AND n.equipment_instance_id = ?"; params.push(equipment_instance_id); }
    if (severity) { sql += " AND n.severity = ?"; params.push(severity); }
    if (status === "open") sql += " AND n.closed_at IS NULL AND (n.disposition IS NULL OR n.disposition = 'pending')";
    if (status === "disposed") sql += " AND n.closed_at IS NULL AND n.disposition IS NOT NULL AND n.disposition != 'pending'";
    if (status === "closed") sql += " AND n.closed_at IS NOT NULL";
    sql += " ORDER BY n.created_at DESC";
    res.json(all(sql, params));
  }));

  app.get("/api/qc/ncr/stats", wrap((_req, res) => {
    const total = get("SELECT COUNT(*) c FROM ncr_reports") || { c: 0 };
    const byDisposition = all("SELECT disposition, COUNT(*) c FROM ncr_reports GROUP BY disposition");
    const bySeverity = all("SELECT severity, COUNT(*) c FROM ncr_reports GROUP BY severity");
    res.json({ total: total.c, by_disposition: byDisposition, by_severity: bySeverity });
  }));

  app.get("/api/qc/ncr/:id", wrap((req, res) => {
    const ncr = get("SELECT n.*, ei.instance_code, u.full_name as created_by_name FROM ncr_reports n LEFT JOIN equipment_instances ei ON n.equipment_instance_id = ei.id LEFT JOIN users u ON n.created_by = u.id WHERE n.id = ?", [req.params.id]);
    if (!ncr) throw ApiError.notFound("NCR not found");
    const capaActions = all("SELECT c.*, u.full_name as assignee_name FROM capa_actions c LEFT JOIN users u ON c.assigned_to = u.id WHERE c.ncr_id = ? ORDER BY c.created_at", [req.params.id]);
    res.json({ ...ncr, capa_actions: capaActions });
  }));

  app.put("/api/qc/ncr/:id/disposition", wrap((req, res) => {
    const { disposition, disposition_by, root_cause, reason } = req.body;
    if (!disposition || !["accept", "rework", "reject"].includes(disposition)) {
      throw ApiError.validation("disposition must be accept/rework/reject");
    }
    const ncr = get("SELECT id FROM ncr_reports WHERE id = ?", [req.params.id]);
    if (!ncr) throw ApiError.notFound("NCR not found");
    const closedAt = disposition === "accept" ? new Date().toISOString() : null;
    run("UPDATE ncr_reports SET disposition = ?, disposition_by = ?, disposition_at = datetime('now'), root_cause = ?, closed_at = ? WHERE id = ?",
      [disposition, disposition_by || null, root_cause || reason || null, closedAt, req.params.id]);
    res.json({ ok: true });
  }));
}

module.exports = { registerNcrRoutes };
