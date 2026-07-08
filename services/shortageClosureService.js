"use strict";
const { ApiError } = require("../app/errors");
const { wrap } = require("../middleware/asyncHandler");
const audit = require("../app/audit");
const { getBomRows, aggregateDemand, getStockMap, computeKitItems } = require("./kitCheckCore");
const { SHORTAGE_STATUSES } = require("../app/domain/statusCatalog");

function register(app, db) {
  runMigration(db);

  const all = (sql, p = []) => db.prepare(sql).all(p);
  const get = (sql, p = []) => db.prepare(sql).get(p);
  const run = (sql, p = []) => db.prepare(sql).run(p);

  function runMigration(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS shortage_cases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        work_order_id INTEGER NOT NULL,
        equipment_instance_id INTEGER,
        material_id INTEGER NOT NULL,
        shortage_qty REAL NOT NULL,
        required_qty REAL,
        available_qty REAL,
        unit TEXT,
        status TEXT DEFAULT 'open',
        owner_id INTEGER,
        owner_name TEXT,
        expected_date TEXT,
        purchase_request_no TEXT,
        priority TEXT DEFAULT 'normal',
        last_note TEXT,
        closed_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(work_order_id, material_id)
      );
      CREATE TABLE IF NOT EXISTS shortage_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shortage_case_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        note TEXT,
        created_by INTEGER,
        created_by_name TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_shortage_cases_status ON shortage_cases(status);
      CREATE INDEX IF NOT EXISTS idx_shortage_cases_wo ON shortage_cases(work_order_id);
    `);
  }

  function actor(req) {
    return {
      id: req.user?.uid || req.user?.sub || req.user?.id || null,
      name: req.user?.full_name || req.user?.username || req.user?.name || null,
    };
  }

  function priorityOf(item) {
    if (item.is_key) return "critical";
    if (item.status === "empty") return "high";
    if (item.fulfill_rate < 50) return "high";
    return "normal";
  }

  function computeKit(woId) {
    const wo = get("SELECT * FROM work_orders WHERE id = ?", [woId]);
    if (!wo) throw ApiError.notFound("工单不存在");
    const bomRows = getBomRows(db, wo.equipment_instance_id);
    const demandMap = aggregateDemand(db, bomRows);
    const demandIds = Object.keys(demandMap).map(Number);
    const stockMap = getStockMap(db, demandIds);
    const items = computeKitItems(demandMap, stockMap);
    const shortItems = items.filter((i) => i.shortage_qty > 0);
    const kitRate = items.length > 0 ? Math.round(((items.length - shortItems.length) / items.length) * 100) : 100;
    return { wo, items, shortItems, kitRate };
  }

  function upsertCases(req, wo, shortItems) {
    const existing = new Map(all("SELECT * FROM shortage_cases WHERE work_order_id = ?", [wo.id]).map((r) => [r.material_id, r]));
    const activeMaterialIds = new Set(shortItems.map((i) => i.material_id));
    const created = [];
    const updated = [];

    for (const item of shortItems) {
      const current = existing.get(item.material_id);
      const priority = priorityOf(item);
      if (!current) {
        const r = run(
          `INSERT INTO shortage_cases
           (work_order_id, equipment_instance_id, material_id, shortage_qty, required_qty, available_qty, unit, status, priority, last_note)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
          [wo.id, wo.equipment_instance_id, item.material_id, item.shortage_qty, item.required_qty, item.available_qty, item.unit, priority, "齐套检查自动生成"]
        );
        addAction(req, r.lastInsertRowid, "create", "齐套检查自动生成缺料");
        created.push(r.lastInsertRowid);
      } else {
        run(
          `UPDATE shortage_cases SET shortage_qty = ?, required_qty = ?, available_qty = ?, unit = ?, priority = ?,
           status = CASE WHEN status = 'closed' THEN 'closed' ELSE status END,
           updated_at = datetime('now') WHERE id = ?`,
          [item.shortage_qty, item.required_qty, item.available_qty, item.unit, priority, current.id]
        );
        updated.push(current.id);
      }
    }

    for (const current of existing.values()) {
      if (!activeMaterialIds.has(current.material_id) && current.status !== "closed") {
        run("UPDATE shortage_cases SET status = 'closed', closed_at = datetime('now'), last_note = ?, updated_at = datetime('now') WHERE id = ?", ["库存已补齐，自动关闭", current.id]);
        addAction(req, current.id, "auto_close", "库存已补齐，自动关闭");
      }
    }
    return { created, updated };
  }

  function addAction(req, caseId, action, note) {
    const a = actor(req);
    run(
      "INSERT INTO shortage_actions (shortage_case_id, action, note, created_by, created_by_name) VALUES (?, ?, ?, ?, ?)",
      [caseId, action, note || null, a.id, a.name]
    );
    audit.record(db, req, {
      action: `shortage.${action}`,
      resource_type: "shortage_case",
      resource_id: caseId,
      after: { shortage_case_id: caseId, action, note },
    });
  }

  function caseRows(where = "1=1", params = []) {
    return all(
      `SELECT sc.*, wo.wo_code, wo.title AS wo_title, ei.instance_code, ei.instance_name,
              m.material_code, m.material_name, m.spec, m.default_supplier
       FROM shortage_cases sc
       JOIN work_orders wo ON wo.id = sc.work_order_id
       LEFT JOIN equipment_instances ei ON ei.id = sc.equipment_instance_id
       LEFT JOIN materials m ON m.id = sc.material_id
       WHERE ${where}
       ORDER BY CASE sc.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
                sc.expected_date IS NULL, sc.expected_date ASC, sc.id DESC`,
      params
    );
  }

  function summary(rows) {
    const byStatus = { open: 0, assigned: 0, purchasing: 0, arrived: 0, closed: 0 };
    const byPriority = { critical: 0, high: 0, normal: 0, low: 0 };
    let shortageQty = 0;
    for (const r of rows) {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      byPriority[r.priority] = (byPriority[r.priority] || 0) + 1;
      if (r.status !== "closed") shortageQty += Number(r.shortage_qty || 0);
    }
    return { total: rows.filter((r) => r.status !== "closed").length, all_total: rows.length, by_status: byStatus, by_priority: byPriority, shortage_qty: Math.round(shortageQty * 100) / 100 };
  }

  app.post("/api/work_orders/:id/kit-sync", wrap((req, res) => {
    const { wo, items, shortItems, kitRate } = computeKit(req.params.id);
    const result = upsertCases(req, wo, shortItems);
    const cases = caseRows("sc.work_order_id = ?", [wo.id]);
    res.json({
      wo_id: wo.id,
      wo_code: wo.wo_code,
      kit_ready: shortItems.length === 0,
      kit_rate: kitRate,
      total_items: items.length,
      short_items: shortItems.length,
      sync: result,
      cases,
      summary: summary(cases),
    });
  }));

  app.get("/api/shortages", wrap((req, res) => {
    const where = [];
    const params = [];
    if (req.query.status) { where.push("sc.status = ?"); params.push(req.query.status); }
    if (req.query.priority) { where.push("sc.priority = ?"); params.push(req.query.priority); }
    if (req.query.work_order_id) { where.push("sc.work_order_id = ?"); params.push(req.query.work_order_id); }
    if (req.query.instance_id) { where.push("sc.equipment_instance_id = ?"); params.push(req.query.instance_id); }
    if (req.query.include_closed !== "1") where.push("sc.status <> 'closed'");
    const rows = caseRows(where.length ? where.join(" AND ") : "1=1", params);
    res.json({ rows, summary: summary(rows) });
  }));

  app.get("/api/shortages/:id", wrap((req, res) => {
    const row = caseRows("sc.id = ?", [req.params.id])[0];
    if (!row) throw ApiError.notFound("缺料单不存在");
    const actions = all("SELECT * FROM shortage_actions WHERE shortage_case_id = ? ORDER BY id DESC", [req.params.id]);
    res.json({ row, actions });
  }));

  app.post("/api/shortages/:id/assign", wrap((req, res) => {
    const id = Number(req.params.id);
    const user = get("SELECT id, full_name, username FROM users WHERE id = ?", [req.body?.owner_id]);
    if (!user) throw ApiError.validation("owner_id 必填且有效");
    const ownerName = user.full_name || user.username || String(user.id);
    run("UPDATE shortage_cases SET status = 'assigned', owner_id = ?, owner_name = ?, expected_date = COALESCE(?, expected_date), last_note = ?, updated_at = datetime('now') WHERE id = ?", [user.id, ownerName, req.body?.expected_date || null, req.body?.note || `分派给 ${ownerName}`, id]);
    addAction(req, id, "assign", req.body?.note || `分派给 ${ownerName}`);
    res.json({ ok: true, row: caseRows("sc.id = ?", [id])[0] });
  }));

  app.post("/api/shortages/:id/follow-up", wrap((req, res) => {
    const id = Number(req.params.id);
    const status = req.body?.status || "purchasing";
    const valid = SHORTAGE_STATUSES;
    if (!valid.includes(status)) throw ApiError.validation("status 无效");
    run("UPDATE shortage_cases SET status = ?, expected_date = COALESCE(?, expected_date), purchase_request_no = COALESCE(?, purchase_request_no), last_note = ?, updated_at = datetime('now') WHERE id = ?", [status, req.body?.expected_date || null, req.body?.purchase_request_no || null, req.body?.note || null, id]);
    addAction(req, id, "follow_up", req.body?.note || `状态更新为 ${status}`);
    res.json({ ok: true, row: caseRows("sc.id = ?", [id])[0] });
  }));

  app.post("/api/shortages/:id/close", wrap((req, res) => {
    const id = Number(req.params.id);
    run("UPDATE shortage_cases SET status = 'closed', closed_at = datetime('now'), last_note = ?, updated_at = datetime('now') WHERE id = ?", [req.body?.note || "已补齐关闭", id]);
    addAction(req, id, "close", req.body?.note || "已补齐关闭");
    res.json({ ok: true, row: caseRows("sc.id = ?", [id])[0] });
  }));

  app.post("/api/shortages/:id/purchase-request", wrap((req, res) => {
    const id = Number(req.params.id);
    const row = caseRows("sc.id = ?", [id])[0];
    if (!row) throw ApiError.notFound("缺料单不存在");
    const prNo = req.body?.purchase_request_no || `PR-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(id).padStart(4, "0")}`;
    run("UPDATE shortage_cases SET status = 'purchasing', purchase_request_no = ?, expected_date = COALESCE(?, expected_date), last_note = ?, updated_at = datetime('now') WHERE id = ?", [prNo, req.body?.expected_date || null, req.body?.note || "已生成采购申请", id]);
    addAction(req, id, "purchase_request", req.body?.note || `生成采购申请 ${prNo}`);
    res.json({ ok: true, purchase_request_no: prNo, row: caseRows("sc.id = ?", [id])[0] });
  }));
}

module.exports = { register };
