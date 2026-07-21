"use strict";

const { ApiError } = require("../../app/errors");
const { wrap } = require("../../middleware/asyncHandler");

function registerEcoRoutes(app, context, buildImpact) {
  const { all, get, run } = context;

  app.get("/api/equipment_instances/:id/eco", wrap((req, res) => {
    res.json(all("SELECT * FROM instance_eco WHERE equipment_instance_id = ? ORDER BY id DESC", req.params.id));
  }));

  app.post("/api/equipment_instances/:id/eco", wrap((req, res) => {
    const { eco_no, title, reason, affected_scope, effective_date, created_by } = req.body;
    if (!eco_no || !title) throw ApiError.validation("eco_no/title 必填");
    const result = run(
      "INSERT INTO instance_eco (equipment_instance_id, eco_no, title, reason, affected_scope, effective_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [req.params.id, eco_no, title, reason || null, affected_scope || null, effective_date || null, created_by || null]
    );
    res.json({ id: result.lastInsertRowid });
  }));

  app.get("/api/instance_eco/:id/impact", wrap((req, res) => {
    const eco = get("SELECT * FROM instance_eco WHERE id = ?", req.params.id);
    if (!eco) throw ApiError.notFound("ECO 不存在");
    res.json(buildImpact(eco));
  }));

  app.put("/api/instance_eco/:id", wrap((req, res) => {
    const { effective_date, reason, affected_scope, title } = req.body;
    const assignments = [];
    const params = [];
    if (title !== undefined) { assignments.push("title = ?"); params.push(title); }
    if (effective_date !== undefined) { assignments.push("effective_date = ?"); params.push(effective_date); }
    if (reason !== undefined) { assignments.push("reason = ?"); params.push(reason); }
    if (affected_scope !== undefined) { assignments.push("affected_scope = ?"); params.push(affected_scope); }
    if (!assignments.length) throw ApiError.validation("无可更新字段");
    assignments.push("updated_at = datetime('now')");
    params.push(req.params.id);
    const result = run(`UPDATE instance_eco SET ${assignments.join(", ")} WHERE id = ?`, params);
    res.json({ changes: result.changes });
  }));
}

function registerWorkflowRoutes(app, context, workflow, archiveDocuments) {
  const { db, get, run } = context;
  app.post("/api/instance_eco/:id/transit", wrap((req, res) => {
    const { action, comment, effective_date, closed_date } = req.body;
    if (!action) throw ApiError.validation("action 必填");
    let instance = db.prepare("SELECT * FROM workflow_instances WHERE entity_type = 'eco' AND entity_id = ? ORDER BY id DESC LIMIT 1").get(req.params.id);
    if (!instance) {
      const eco = get("SELECT * FROM instance_eco WHERE id = ?", req.params.id);
      if (!eco) throw ApiError.notFound("ECO 不存在");
      instance = workflow.start("eco_change", "eco", Number(req.params.id), {
        assigned_to: req.user && req.user.sub,
        data: { eco_no: eco.eco_no, title: eco.title },
        created_by: req.user && req.user.sub,
        comment: `从 ${eco.status || "open"} 迁移`,
      }).instance;
    }
    const extra = {};
    if (effective_date) extra.effective_date = effective_date;
    if (closed_date) extra.closed_date = closed_date;
    const result = workflow.transit(Number(instance.id), action, req.user && req.user.sub, comment, extra);
    const newState = result.instance.current_state;
    if (newState) {
      const assignments = ["status = ?", "updated_at = datetime('now')"];
      const params = [newState];
      if (effective_date) { assignments.push("effective_date = ?"); params.push(effective_date); }
      if (closed_date) { assignments.push("closed_date = ?"); params.push(closed_date); }
      params.push(req.params.id);
      run(`UPDATE instance_eco SET ${assignments.join(", ")} WHERE id = ?`, params);
      archiveDocuments(Number(req.params.id), newState);
    }
    res.json(result);
  }));
}

module.exports = { registerEcoRoutes, registerWorkflowRoutes };
