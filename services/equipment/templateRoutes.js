"use strict";

const {
  EMPTY_TEMPLATE_SCOPE,
  INSTANCE_TEMPLATE_SCOPE,
  TEMPLATE_SCOPE_OPTIONS,
} = require("./catalog");

function registerTemplateRoutes({ app, wrap, all, get, run, ApiError, nextTemplateCode, reserveTemplateCode, templateStore }) {
  app.get("/api/equipment_instance_templates/scope-options", wrap((_req, res) => {
    res.json(TEMPLATE_SCOPE_OPTIONS);
  }));

  app.get("/api/equipment_instance_templates", wrap((req, res) => {
    const { status, category } = req.query;
    let sql = `
      SELECT t.*, ei.instance_code AS source_instance_code, ei.instance_name AS source_instance_name
      FROM equipment_instance_templates t
      LEFT JOIN equipment_instances ei ON ei.id = t.source_instance_id
      WHERE 1=1
    `;
    const params = [];
    if (status) { sql += " AND t.status = ?"; params.push(status); }
    if (category) { sql += " AND t.category = ?"; params.push(category); }
    sql += " ORDER BY CASE t.status WHEN 'published' THEN 1 WHEN 'draft' THEN 2 ELSE 3 END, t.updated_at DESC, t.id DESC";
    res.json(all(sql, params).map(templateStore.templateRow));
  }));

  app.post("/api/equipment_instance_templates", wrap((req, res) => {
    const body = req.body || {};
    const templateName = String(body.template_name || "").trim();
    if (!templateName) throw ApiError.validation("template_name 必填");
    const category = String(body.category || "TBM").trim() || "TBM";
    const templateCode = String(body.template_code || nextTemplateCode(category)).trim().toUpperCase();
    if (body.template_code && typeof reserveTemplateCode === "function") {
      try { reserveTemplateCode(templateCode, { category }); } catch (_error) { /* 回退到旧编码不阻断 */ }
    }
    const status = ["draft", "published", "disabled"].includes(body.status) ? body.status : "published";
    const version = String(body.version || "A0").trim() || "A0";
    const sourceInstanceId = body.source_instance_id ? Number(body.source_instance_id) : null;
    if (sourceInstanceId && !get("SELECT id FROM equipment_instances WHERE id = ?", sourceInstanceId)) {
      throw ApiError.validation("来源项目装备不存在");
    }
    if (get("SELECT id FROM equipment_instance_templates WHERE template_code = ?", templateCode)) {
      throw ApiError.validation("模板编码已存在: " + templateCode);
    }
    const copyScope = templateStore.normalizeCopyScope(
      body.copy_scope,
      sourceInstanceId ? INSTANCE_TEMPLATE_SCOPE : EMPTY_TEMPLATE_SCOPE
    );
    const result = run(
      `INSERT INTO equipment_instance_templates
        (template_code, template_name, category, version, source_instance_id, copy_scope, status, description, created_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        templateCode, templateName, category, version, sourceInstanceId, JSON.stringify(copyScope),
        status, body.description || null, req.user?.sub || req.user?.id || null,
      ]
    );
    res.json({ id: result.lastInsertRowid, template_code: templateCode, copy_scope: copyScope, status });
  }));

  app.put("/api/equipment_instance_templates/:id", wrap((req, res) => {
    const current = get("SELECT * FROM equipment_instance_templates WHERE id = ?", req.params.id);
    if (!current) throw ApiError.notFound("项目装备模板不存在");
    const body = req.body || {};
    const updates = [];
    const params = [];
    for (const field of ["template_name", "category", "version", "description"]) {
      if (body[field] !== undefined) { updates.push(`${field} = ?`); params.push(body[field]); }
    }
    if (body.source_instance_id !== undefined) {
      const sourceInstanceId = body.source_instance_id ? Number(body.source_instance_id) : null;
      if (sourceInstanceId && !get("SELECT id FROM equipment_instances WHERE id = ?", sourceInstanceId)) {
        throw ApiError.validation("来源项目装备不存在");
      }
      updates.push("source_instance_id = ?");
      params.push(sourceInstanceId);
    }
    if (body.copy_scope !== undefined) {
      const sourceInstanceId = body.source_instance_id === undefined ? current.source_instance_id : body.source_instance_id || null;
      updates.push("copy_scope = ?");
      params.push(JSON.stringify(templateStore.normalizeCopyScope(
        body.copy_scope,
        sourceInstanceId ? INSTANCE_TEMPLATE_SCOPE : EMPTY_TEMPLATE_SCOPE
      )));
    }
    if (body.status !== undefined) {
      if (!["draft", "published", "disabled"].includes(body.status)) throw ApiError.validation("模板状态不合法");
      updates.push("status = ?");
      params.push(body.status);
    }
    if (!updates.length) throw ApiError.validation("no fields");
    updates.push("updated_at = datetime('now')");
    params.push(req.params.id);
    const result = run(`UPDATE equipment_instance_templates SET ${updates.join(", ")} WHERE id = ?`, params);
    res.json({ changes: result.changes });
  }));

  app.post("/api/equipment_instance_templates/:id/status", wrap((req, res) => {
    const status = req.body?.status;
    if (!["draft", "published", "disabled"].includes(status)) throw ApiError.validation("模板状态不合法");
    if (!get("SELECT id FROM equipment_instance_templates WHERE id = ?", req.params.id)) {
      throw ApiError.notFound("项目装备模板不存在");
    }
    const result = run(
      "UPDATE equipment_instance_templates SET status = ?, updated_at = datetime('now') WHERE id = ?",
      [status, req.params.id]
    );
    res.json({ id: Number(req.params.id), status, changes: result.changes });
  }));
}

module.exports = { registerTemplateRoutes };
