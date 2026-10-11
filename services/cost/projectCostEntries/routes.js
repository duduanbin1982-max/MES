"use strict";
// services/cost/projectCostEntries/routes.js
// HTTP 路由: 列表 / 汇总 / 新增 / 修改 / 回填 / 作废。
// (原 services/cost/projectCostEntries.js 第 130-332 行)

const { wrap } = require("../../../middleware/asyncHandler");
const { requireRole } = require("../../../middleware/auth");
const {
  COST_TYPES,
  COST_TYPE_LABELS,
  nowISO,
  todayISO,
  round2,
  normalizeBody,
  makeDbHelpers,
} = require("./_helpers");
const { ensureSchema } = require("./schema");

function register(app, db) {
  ensureSchema(db);

  const { all, get, run } = makeDbHelpers(db);
  const writeRoles = requireRole("admin", "foreman");

  app.get("/api/project_cost_entries", wrap((req, res) => {
    const where = ["deleted_at IS NULL"];
    const params = [];
    if (req.query.equipment_instance_id) {
      where.push("equipment_instance_id = ?");
      params.push(Number(req.query.equipment_instance_id));
    }
    if (req.query.cost_type) {
      where.push("cost_type = ?");
      params.push(String(req.query.cost_type));
    }
    if (req.query.status) {
      where.push("status = ?");
      params.push(String(req.query.status));
    }
    const rows = all(`
      SELECT e.*,
             ei.instance_code,
             ei.instance_name,
             CASE e.cost_type
               WHEN 'material' THEN '材料'
               WHEN 'labor' THEN '人工'
               WHEN 'outsourcing' THEN '外协'
               WHEN 'depreciation' THEN '折旧'
               WHEN 'rework' THEN '返工'
               WHEN 'quality_loss' THEN '质量损失'
               ELSE e.cost_type
             END AS cost_type_label
        FROM project_cost_entries e
        LEFT JOIN equipment_instances ei ON ei.id = e.equipment_instance_id
       WHERE ${where.join(" AND ")}
       ORDER BY e.occurred_on DESC, e.id DESC
    `, ...params);
    res.json({ count: rows.length, items: rows });
  }));

  app.get("/api/project_cost_entries/summary", wrap((req, res) => {
    const where = ["deleted_at IS NULL", "status != 'void'"];
    const params = [];
    if (req.query.equipment_instance_id) {
      where.push("equipment_instance_id = ?");
      params.push(Number(req.query.equipment_instance_id));
    }
    const rows = all(`
      SELECT cost_type, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount
        FROM project_cost_entries
       WHERE ${where.join(" AND ")}
       GROUP BY cost_type
    `, ...params);
    const by_type = Object.fromEntries(
      Array.from(COST_TYPES).map((type) => [type, { label: COST_TYPE_LABELS[type] || type, count: 0, amount: 0 }])
    );
    for (const row of rows) {
      if (by_type[row.cost_type]) {
        by_type[row.cost_type].count = Number(row.count || 0);
        by_type[row.cost_type].amount = round2(row.amount);
      }
    }
    const total = round2(Object.values(by_type).reduce((sum, item) => sum + Number(item.amount || 0), 0));
    res.json({ by_type, total });
  }));

  app.post("/api/project_cost_entries", writeRoles, wrap((req, res) => {
    let body;
    try {
      body = normalizeBody(req.body || {});
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    const instance = get("SELECT id FROM equipment_instances WHERE id = ?", body.equipment_instance_id);
    if (!instance) return res.status(404).json({ error: "equipment_instance not found" });
    const createdBy = req.user && (req.user.uid || req.user.id || req.user.sub) ? (req.user.uid || req.user.id || req.user.sub) : null;
    const result = run(`
      INSERT INTO project_cost_entries (
        equipment_instance_id, bom_node_id, work_order_id, cost_type, source_type, source_ref,
        description, vendor, amount, currency, occurred_on, status, notes, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, body.equipment_instance_id, body.bom_node_id || null, body.work_order_id || null, body.cost_type,
      body.source_type || null, body.source_ref || null, body.description, body.vendor || null,
      body.amount, body.currency || "CNY", body.occurred_on, body.status || "posted", body.notes || null,
      createdBy, nowISO(), nowISO());
    res.json({ ok: true, item: get("SELECT * FROM project_cost_entries WHERE id = ?", result.lastInsertRowid) });
  }));

  app.put("/api/project_cost_entries/:id", writeRoles, wrap((req, res) => {
    const id = Number(req.params.id);
    const existing = get("SELECT * FROM project_cost_entries WHERE id = ? AND deleted_at IS NULL", id);
    if (!existing) return res.status(404).json({ error: "project_cost_entry not found" });
    let body;
    try {
      body = normalizeBody(req.body || {}, true);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    const fields = Object.keys(body);
    if (!fields.length) return res.status(400).json({ error: "没有可更新字段" });
    fields.push("updated_at");
    const params = Object.keys(body).map((key) => body[key]);
    params.push(nowISO(), id);
    run(`UPDATE project_cost_entries SET ${fields.map((field) => `${field} = ?`).join(", ")} WHERE id = ?`, ...params);
    res.json({ ok: true, item: get("SELECT * FROM project_cost_entries WHERE id = ?", id) });
  }));


  app.post("/api/project_cost_entries/backfill", writeRoles, wrap((req, res) => {
    const hourlyRate = Number(req.body?.hourly_rate || 200);
    const include = new Set(Array.isArray(req.body?.include) && req.body.include.length ? req.body.include : ["material", "labor"]);
    const createdBy = req.user && (req.user.uid || req.user.id || req.user.sub) ? (req.user.uid || req.user.id || req.user.sub) : null;
    const created = { material: 0, labor: 0 };
    const skipped = { material: 0, labor: 0 };
    const insert = db.prepare(`
      INSERT INTO project_cost_entries (
        equipment_instance_id, bom_node_id, work_order_id, cost_type, source_type, source_ref,
        description, vendor, amount, currency, occurred_on, status, notes, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'CNY', ?, 'posted', ?, ?, ?, ?)
    `);
    const exists = db.prepare("SELECT id FROM project_cost_entries WHERE source_type = ? AND source_ref = ? AND deleted_at IS NULL LIMIT 1");

    const tx = db.transaction(() => {
      if (include.has("material")) {
        const rows = all(`
          SELECT poi.id, poi.bom_node_id, poi.material_id, poi.quantity, poi.unit_price, poi.total_price,
                 po.id AS po_id, po.po_no, po.equipment_instance_id, NULL AS supplier_name,
                 m.material_code, m.material_name
            FROM purchase_order_items poi
            JOIN purchase_orders po ON po.id = poi.po_id
            LEFT JOIN materials m ON m.id = poi.material_id
           WHERE po.equipment_instance_id IS NOT NULL
             AND COALESCE(poi.total_price, poi.quantity * poi.unit_price, 0) > 0
        `);
        for (const row of rows) {
          const sourceRef = `purchase_order_item:${row.id}:material`;
          if (exists.get("purchase_order_item", sourceRef)) { skipped.material += 1; continue; }
          insert.run(
            row.equipment_instance_id,
            row.bom_node_id || null,
            null,
            "material",
            "purchase_order_item",
            sourceRef,
            `采购材料成本 ${row.po_no || row.po_id} ${row.material_code || row.material_name || ""}`.trim(),
            row.supplier_name || null,
            round2(row.total_price || Number(row.quantity || 0) * Number(row.unit_price || 0)),
            todayISO(),
            "由采购订单明细自动回填",
            createdBy,
            nowISO(),
            nowISO(),
          );
          created.material += 1;
        }
      }
      if (include.has("labor")) {
        const rows = all(`
          SELECT id, equipment_instance_id, wo_code, title, actual_hours, estimated_hours, actual_end, planned_end
            FROM work_orders
           WHERE equipment_instance_id IS NOT NULL
             AND COALESCE(actual_hours, estimated_hours, 0) > 0
        `);
        for (const row of rows) {
          const sourceRef = `work_order:${row.id}:labor`;
          if (exists.get("work_order", sourceRef)) { skipped.labor += 1; continue; }
          const hours = Number(row.actual_hours || row.estimated_hours || 0);
          insert.run(
            row.equipment_instance_id,
            null,
            row.id,
            "labor",
            "work_order",
            sourceRef,
            `工单人工成本 ${row.wo_code || row.id} ${row.title || ""}`.trim(),
            null,
            round2(hours * hourlyRate),
            String(row.actual_end || row.planned_end || todayISO()).slice(0, 10),
            `按 ${hours}h × ${hourlyRate} 元/h 自动回填`,
            createdBy,
            nowISO(),
            nowISO(),
          );
          created.labor += 1;
        }
      }
    });
    tx();
    res.json({ ok: true, created, skipped, hourly_rate: hourlyRate });
  }));

  app.delete("/api/project_cost_entries/:id", writeRoles, wrap((req, res) => {
    const id = Number(req.params.id);
    const existing = get("SELECT * FROM project_cost_entries WHERE id = ? AND deleted_at IS NULL", id);
    if (!existing) return res.status(404).json({ error: "project_cost_entry not found" });
    run("UPDATE project_cost_entries SET status = 'void', deleted_at = ?, updated_at = ? WHERE id = ?", nowISO(), nowISO(), id);
    res.json({ ok: true });
  }));
}

module.exports = { register };
