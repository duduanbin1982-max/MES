"use strict";

const { wrap } = require("../../middleware/asyncHandler");

function nextNcrCode(get) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `NCR-${date}-`;
  const last = get("SELECT ncr_code FROM ncr_reports WHERE ncr_code LIKE ? ORDER BY id DESC LIMIT 1", [prefix + "%"]);
  let sequence = 1;
  if (last) {
    const lastSequence = parseInt(last.ncr_code.split("-").pop());
    if (!Number.isNaN(lastSequence)) sequence = lastSequence + 1;
  }
  return prefix + String(sequence).padStart(3, "0");
}

function registerInspectionRoutes({ app, helpers, ApiError }) {
  const { all, get, run } = helpers;

  app.get("/api/qc_inspections", wrap((req, res) => {
    const { equipment_instance_id, work_order_id, inspection_type, result } = req.query;
    let sql = "SELECT q.*, u.full_name as inspector_name FROM qc_inspections q LEFT JOIN users u ON q.inspector_id = u.id WHERE 1=1";
    const params = [];
    if (equipment_instance_id) { sql += " AND q.equipment_instance_id = ?"; params.push(equipment_instance_id); }
    if (work_order_id) { sql += " AND q.work_order_id = ?"; params.push(work_order_id); }
    if (inspection_type) { sql += " AND q.inspection_type = ?"; params.push(inspection_type); }
    if (result) { sql += " AND q.result = ?"; params.push(result); }
    sql += " ORDER BY q.inspection_date DESC";
    res.json(all(sql, params));
  }));

  app.post("/api/qc_inspections", wrap((req, res) => {
    const { equipment_instance_id, work_order_id, inspection_type, result, inspector_id, notes } = req.body;
    if (!equipment_instance_id || !inspection_type || !result) throw ApiError.validation("equipment_instance_id/inspection_type/result required");
    const created = run("INSERT INTO qc_inspections (equipment_instance_id, work_order_id, inspection_type, result, inspector_id, notes) VALUES (?, ?, ?, ?, ?, ?)",
      [equipment_instance_id, work_order_id || null, inspection_type, result, inspector_id || null, notes || null]);
    res.json({ id: created.lastInsertRowid });
  }));

  app.get("/api/qc/stats", wrap((_req, res) => {
    const total = get("SELECT COUNT(*) c FROM qc_inspections") || { c: 0 };
    const passed = get("SELECT COUNT(*) c FROM qc_inspections WHERE result='pass'") || { c: 0 };
    const failed = get("SELECT COUNT(*) c FROM qc_inspections WHERE result='fail'") || { c: 0 };
    const passRate = total.c ? Math.round(passed.c * 100 / total.c) : 0;
    const byType = all("SELECT inspection_type, COUNT(*) as total, SUM(CASE WHEN result='pass' THEN 1 ELSE 0 END) as pass_cnt, SUM(CASE WHEN result='fail' THEN 1 ELSE 0 END) as fail_cnt FROM qc_inspections GROUP BY inspection_type ORDER BY total DESC");
    const recentFail = all("SELECT q.*, ei.instance_code, u.full_name as inspector_name FROM qc_inspections q LEFT JOIN equipment_instances ei ON q.equipment_instance_id = ei.id LEFT JOIN users u ON q.inspector_id = u.id WHERE q.result='fail' ORDER BY q.inspection_date DESC LIMIT 10");
    res.json({ total: total.c, pass: passed.c, fail: failed.c, pass_rate: passRate, by_type: byType, recent_fail: recentFail });
  }));

  app.get("/api/qc/inspection-templates", wrap((req, res) => {
    const { category } = req.query;
    let sql = "SELECT * FROM inspection_templates";
    const params = [];
    if (category) { sql += " WHERE category = ?"; params.push(category); }
    sql += " ORDER BY created_at DESC";
    res.json(all(sql, params));
  }));

  app.post("/api/qc/inspection-templates", wrap((req, res) => {
    const { template_name, equipment_type_id, category, check_items } = req.body;
    if (!template_name) throw ApiError.validation("template_name required");
    const created = run("INSERT INTO inspection_templates (template_name, equipment_type_id, category, check_items) VALUES (?, ?, ?, ?)",
      [template_name, equipment_type_id || null, category || null, check_items || null]);
    res.json({ id: created.lastInsertRowid });
  }));

  app.get("/api/qc/inspection-templates/:id", wrap((req, res) => {
    const template = get("SELECT * FROM inspection_templates WHERE id = ?", [req.params.id]);
    if (!template) throw ApiError.notFound("Template not found");
    let checkItems = [];
    try { checkItems = JSON.parse(template.check_items || "[]"); } catch (_error) {}
    res.json({ ...template, check_items: checkItems });
  }));

  app.post("/api/qc/incoming-inspection", wrap((req, res) => {
    const { purchase_order_id, material_id, lot_number, supplier, inspector_id, result, defect_desc, defect_qty, notes } = req.body;
    if (!material_id || !result) throw ApiError.validation("material_id and result required");
    const created = run("INSERT INTO qc_inspections (equipment_instance_id, work_order_id, inspection_type, result, inspector_id, notes) VALUES (?,?,?,?,?,?)",
      [null, null, "incoming", result, inspector_id || null, JSON.stringify({ purchase_order_id, material_id, supplier, defect_desc, defect_qty, lot_number, notes })]);
    if (result === "fail") {
      run("INSERT INTO ncr_reports (ncr_code, source_type, source_id, part_name, defect_desc, defect_qty, severity, created_by) VALUES (?,?,?,?,?,?,?,?)",
        [nextNcrCode(get), "incoming", created.lastInsertRowid, "Material #" + material_id, defect_desc || "Incoming inspection failed", defect_qty || 1, "major", inspector_id || null]);
    }
    res.json({ id: created.lastInsertRowid, result });
  }));

  app.get("/api/qc/incoming-inspection", wrap((_req, res) => {
    res.json(all("SELECT q.*, u.full_name AS inspector_name FROM qc_inspections q LEFT JOIN users u ON q.inspector_id=u.id WHERE q.inspection_type='incoming' ORDER BY q.inspection_date DESC LIMIT 100"));
  }));
}

module.exports = { nextNcrCode, registerInspectionRoutes };
