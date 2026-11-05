"use strict";
// services/delivery/records.js
// 2026-11-02：交付单 / 验收单（补「交付/验收无单据表」断点）
//
// 之前交付与验收只有 instance_milestones 上的阶段标记（S6 客户验收 / S7 交付发运 / S9 试掘进/验收），
// 没有可承载"发运批次、承运信息、随机文件、验收结论、客户签署"的单据。
//
// 本文件提供：
//   · delivery_orders   交付单（一次发运一条：计划/实际日期、承运、跟踪号、包装、合格证）
//   · acceptance_records 验收单（FAT 厂内 / SAT 现场 / 终验：结论、签署人、验收报告）
//   · 交付单状态机：planned → shipped → in_transit → arrived → accepted（任意状态可 cancelled）
//   · 验收结论：pending → passed / conditional / rejected
//
// 不写 instance_milestones：里程碑由项目侧维护，单据只做记录与关联（milestone_id 为软引用）。

const { wrap } = require("../../middleware/asyncHandler");
const { ApiError } = require("../../app/errors");
const { todaySqlDate } = require("../../shared/datetime");

const DELIVERY_STATUSES = ["planned", "shipped", "in_transit", "arrived", "accepted", "cancelled"];
const DELIVERY_TRANSITIONS = {
  planned: ["shipped", "cancelled"],
  shipped: ["in_transit", "cancelled"],
  in_transit: ["arrived", "cancelled"],
  arrived: ["accepted", "cancelled"],
  accepted: [],
  cancelled: [],
};
const DELIVERY_TYPES = ["machine", "spare_parts", "tools", "other"];
const TRANSPORT_MODES = ["road", "rail", "sea", "air"];
const ACCEPTANCE_TYPES = ["fat", "sat", "final"];
const ACCEPTANCE_RESULTS = ["pending", "passed", "conditional", "rejected"];

const DELIVERY_FIELDS = [
  "delivery_type", "planned_date", "actual_date", "status", "transport_mode", "carrier",
  "tracking_no", "ship_to", "contact_name", "contact_phone", "package_count", "gross_weight",
  "certificate_document_id", "milestone_id", "notes",
];
const ACCEPTANCE_FIELDS = [
  "acceptance_type", "planned_date", "actual_date", "result", "condition_note",
  "customer_name", "signer_name", "signer_title", "signed_at", "report_document_id", "delivery_order_id", "milestone_id", "notes",
];

function initDeliveryRecordsSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS delivery_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      delivery_no TEXT NOT NULL,
      equipment_instance_id INTEGER NOT NULL,
      milestone_id INTEGER,
      delivery_type TEXT NOT NULL DEFAULT 'machine',
      planned_date TEXT,
      actual_date TEXT,
      status TEXT NOT NULL DEFAULT 'planned',
      transport_mode TEXT,
      carrier TEXT,
      tracking_no TEXT,
      ship_to TEXT,
      contact_name TEXT,
      contact_phone TEXT,
      package_count INTEGER,
      gross_weight REAL,
      certificate_document_id INTEGER,
      notes TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_orders_no ON delivery_orders(delivery_no);
    CREATE INDEX IF NOT EXISTS idx_delivery_orders_instance ON delivery_orders(equipment_instance_id, status);

    CREATE TABLE IF NOT EXISTS acceptance_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      acceptance_no TEXT NOT NULL,
      equipment_instance_id INTEGER NOT NULL,
      delivery_order_id INTEGER,
      milestone_id INTEGER,
      acceptance_type TEXT NOT NULL DEFAULT 'fat',
      planned_date TEXT,
      actual_date TEXT,
      result TEXT NOT NULL DEFAULT 'pending',
      condition_note TEXT,
      customer_name TEXT,
      signer_name TEXT,
      signer_title TEXT,
      signed_at TEXT,
      report_document_id INTEGER,
      notes TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_acceptance_records_no ON acceptance_records(acceptance_no);
    CREATE INDEX IF NOT EXISTS idx_acceptance_records_instance ON acceptance_records(equipment_instance_id, result);
  `);
}

function createRepositories(db) {
  const all = (sql, params = []) => db.prepare(sql).all(params);
  const get = (sql, params = []) => db.prepare(sql).get(params);
  const run = (sql, params = []) => db.prepare(sql).run(params);
  return { all, get, run };
}

/** 生成 `前缀-实例编码-序号` 的单号（同实例内递增） */
function nextDocumentNo({ get }, table, column, prefix, instanceCode) {
  const row = get(`SELECT COUNT(*) AS c FROM ${table} WHERE equipment_instance_id = (SELECT id FROM equipment_instances WHERE instance_code = ?)`, [instanceCode]);
  let seq = Number(row?.c || 0) + 1;
  let candidate = `${prefix}-${instanceCode}-${String(seq).padStart(3, "0")}`;
  while (get(`SELECT id FROM ${table} WHERE ${column} = ?`, [candidate])) {
    seq += 1;
    candidate = `${prefix}-${instanceCode}-${String(seq).padStart(3, "0")}`;
  }
  return candidate;
}

function pickFields(body, allowed) {
  const out = {};
  for (const key of allowed) if (body[key] !== undefined) out[key] = body[key];
  return out;
}

function registerDeliveryRecordRoutes(app, db) {
  const repo = createRepositories(db);
  const { all, get, run } = repo;

  const instanceOf = (id) => get("SELECT id, instance_code, instance_name FROM equipment_instances WHERE id = ?", [id]);

  // ---------------------------------------------------------------- 交付单
  app.get("/api/equipment_instances/:id/deliveries", wrap((req, res) => {
    const instance = instanceOf(req.params.id);
    if (!instance) throw ApiError.notFound("equipment_instance not found");
    const items = all(
      `SELECT * FROM delivery_orders WHERE equipment_instance_id = ? ORDER BY COALESCE(planned_date, created_at) DESC, id DESC`,
      [instance.id]
    );
    res.json({ equipment_instance_id: instance.id, total: items.length, items });
  }));

  app.post("/api/equipment_instances/:id/deliveries", wrap((req, res) => {
    const instance = instanceOf(req.params.id);
    if (!instance) throw ApiError.notFound("equipment_instance not found");
    const body = req.body || {};
    const values = pickFields(body, DELIVERY_FIELDS);
    if (values.delivery_type && !DELIVERY_TYPES.includes(values.delivery_type)) throw ApiError.validation(`delivery_type 必须是 ${DELIVERY_TYPES.join("/")}`);
    if (values.transport_mode && !TRANSPORT_MODES.includes(values.transport_mode)) throw ApiError.validation(`transport_mode 必须是 ${TRANSPORT_MODES.join("/")}`);
    if (values.status && !DELIVERY_STATUSES.includes(values.status)) throw ApiError.validation(`status 必须是 ${DELIVERY_STATUSES.join("/")}`);
    const deliveryNo = String(body.delivery_no || "").trim() || nextDocumentNo(repo, "delivery_orders", "delivery_no", "DO", instance.instance_code);
    const result = run(
      `INSERT INTO delivery_orders (delivery_no, equipment_instance_id, milestone_id, delivery_type, planned_date, actual_date, status,
        transport_mode, carrier, tracking_no, ship_to, contact_name, contact_phone, package_count, gross_weight, certificate_document_id, notes, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        deliveryNo, instance.id, values.milestone_id ?? null, values.delivery_type || "machine",
        values.planned_date ?? null, values.actual_date ?? null, values.status || "planned",
        values.transport_mode ?? null, values.carrier ?? null, values.tracking_no ?? null,
        values.ship_to ?? null, values.contact_name ?? null, values.contact_phone ?? null,
        values.package_count ?? null, values.gross_weight ?? null, values.certificate_document_id ?? null,
        values.notes ?? null, req.user?.sub || req.user?.uid || null,
      ]
    );
    res.json({ id: result.lastInsertRowid, delivery_no: deliveryNo, item: get("SELECT * FROM delivery_orders WHERE id = ?", [result.lastInsertRowid]) });
  }));

  app.put("/api/deliveries/:id", wrap((req, res) => {
    const existing = get("SELECT * FROM delivery_orders WHERE id = ?", [req.params.id]);
    if (!existing) throw ApiError.notFound("delivery order not found");
    const values = pickFields(req.body || {}, DELIVERY_FIELDS);
    delete values.status; // 状态只能走 /status，避免绕过状态机
    const keys = Object.keys(values);
    if (!keys.length) throw ApiError.validation("no fields");
    run(`UPDATE delivery_orders SET ${keys.map((key) => `${key} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`, [...keys.map((key) => values[key]), req.params.id]);
    res.json({ changes: 1, item: get("SELECT * FROM delivery_orders WHERE id = ?", [req.params.id]) });
  }));

  app.post("/api/deliveries/:id/status", wrap((req, res) => {
    const existing = get("SELECT * FROM delivery_orders WHERE id = ?", [req.params.id]);
    if (!existing) throw ApiError.notFound("delivery order not found");
    const next = String((req.body || {}).status || "");
    if (!DELIVERY_STATUSES.includes(next)) throw ApiError.validation(`status 必须是 ${DELIVERY_STATUSES.join("/")}`);
    const allowed = DELIVERY_TRANSITIONS[existing.status] || [];
    if (!allowed.includes(next)) throw ApiError.validation(`不合法的状态流转：${existing.status} → ${next}（允许：${allowed.join("/") || "无"}）`);
    // 2026-11-05（交付链路深挖）：用本地日期，避免 toISOString 的 UTC 偏移导致跨天
    const actualDate = next === "shipped" || next === "arrived" ? (req.body.actual_date || todaySqlDate()) : existing.actual_date;
    run("UPDATE delivery_orders SET status = ?, actual_date = COALESCE(?, actual_date), updated_at = datetime('now') WHERE id = ?", [next, actualDate, req.params.id]);
    res.json({ ok: true, id: existing.id, from: existing.status, to: next, item: get("SELECT * FROM delivery_orders WHERE id = ?", [req.params.id]) });
  }));

  app.delete("/api/deliveries/:id", wrap((req, res) => {
    const result = run("DELETE FROM delivery_orders WHERE id = ?", [req.params.id]);
    if (!result.changes) throw ApiError.notFound("delivery order not found");
    res.json({ deleted: [Number(req.params.id)] });
  }));

  // ---------------------------------------------------------------- 验收单
  app.get("/api/equipment_instances/:id/acceptances", wrap((req, res) => {
    const instance = instanceOf(req.params.id);
    if (!instance) throw ApiError.notFound("equipment_instance not found");
    const items = all(
      `SELECT * FROM acceptance_records WHERE equipment_instance_id = ? ORDER BY COALESCE(planned_date, created_at) DESC, id DESC`,
      [instance.id]
    );
    res.json({ equipment_instance_id: instance.id, total: items.length, items });
  }));

  app.post("/api/equipment_instances/:id/acceptances", wrap((req, res) => {
    const instance = instanceOf(req.params.id);
    if (!instance) throw ApiError.notFound("equipment_instance not found");
    const body = req.body || {};
    const values = pickFields(body, ACCEPTANCE_FIELDS);
    if (values.acceptance_type && !ACCEPTANCE_TYPES.includes(values.acceptance_type)) throw ApiError.validation(`acceptance_type 必须是 ${ACCEPTANCE_TYPES.join("/")}`);
    if (values.result && !ACCEPTANCE_RESULTS.includes(values.result)) throw ApiError.validation(`result 必须是 ${ACCEPTANCE_RESULTS.join("/")}`);
    const acceptanceNo = String(body.acceptance_no || "").trim() || nextDocumentNo(repo, "acceptance_records", "acceptance_no", "AC", instance.instance_code);
    const result = run(
      `INSERT INTO acceptance_records (acceptance_no, equipment_instance_id, delivery_order_id, milestone_id, acceptance_type,
        planned_date, actual_date, result, condition_note, customer_name, signer_name, signer_title, signed_at, report_document_id, notes, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        acceptanceNo, instance.id, values.delivery_order_id ?? null, values.milestone_id ?? null,
        values.acceptance_type || "fat", values.planned_date ?? null, values.actual_date ?? null,
        values.result || "pending", values.condition_note ?? null, values.customer_name ?? null,
        values.signer_name ?? null, values.signer_title ?? null, values.signed_at ?? null,
        values.report_document_id ?? null, values.notes ?? null, req.user?.sub || req.user?.uid || null,
      ]
    );
    res.json({ id: result.lastInsertRowid, acceptance_no: acceptanceNo, item: get("SELECT * FROM acceptance_records WHERE id = ?", [result.lastInsertRowid]) });
  }));

  app.put("/api/acceptances/:id", wrap((req, res) => {
    const existing = get("SELECT * FROM acceptance_records WHERE id = ?", [req.params.id]);
    if (!existing) throw ApiError.notFound("acceptance record not found");
    const values = pickFields(req.body || {}, ACCEPTANCE_FIELDS);
    delete values.result; // 结论只能通过签署接口写入
    const keys = Object.keys(values);
    if (!keys.length) throw ApiError.validation("no fields");
    run(`UPDATE acceptance_records SET ${keys.map((key) => `${key} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`, [...keys.map((key) => values[key]), req.params.id]);
    res.json({ changes: 1, item: get("SELECT * FROM acceptance_records WHERE id = ?", [req.params.id]) });
  }));

  app.delete("/api/acceptances/:id", wrap((req, res) => {
    const result = run("DELETE FROM acceptance_records WHERE id = ?", [req.params.id]);
    if (!result.changes) throw ApiError.notFound("acceptance record not found");
    res.json({ deleted: [Number(req.params.id)] });
  }));

  app.post("/api/acceptances/:id/sign", wrap((req, res) => {
    const existing = get("SELECT * FROM acceptance_records WHERE id = ?", [req.params.id]);
    if (!existing) throw ApiError.notFound("acceptance record not found");
    const body = req.body || {};
    const result = String(body.result || "");
    if (!["passed", "conditional", "rejected"].includes(result)) {
      throw ApiError.validation("result 必须是 passed / conditional / rejected");
    }
    const signerName = String(body.signer_name || "").trim();
    if (!signerName) throw ApiError.validation("signer_name 必填（客户签署人）");
    if (result === "conditional" && !String(body.condition_note || "").trim()) {
      throw ApiError.validation("让步接收必须填写 condition_note");
    }
    const signedAt = body.signed_at || `${todaySqlDate()} ${new Date().toTimeString().slice(0, 8)}`;
    const actualDate = body.actual_date || signedAt.slice(0, 10);
    run(
      `UPDATE acceptance_records
          SET result = ?, signer_name = ?, signer_title = ?, signed_at = ?, actual_date = ?,
              condition_note = COALESCE(?, condition_note), report_document_id = COALESCE(?, report_document_id),
              updated_at = datetime('now')
        WHERE id = ?`,
      [result, signerName, body.signer_title ?? null, signedAt, actualDate,
        body.condition_note ?? null, body.report_document_id ?? null, req.params.id]
    );

    // 2026-11-05（交付链路深挖）：验收结论联动交付单与合同里程碑，避免"验收通过但交付单还停在 arrived"。
    const warnings = [];
    if (["passed", "conditional"].includes(result)) {
      if (existing.delivery_order_id) {
        const delivery = get("SELECT * FROM delivery_orders WHERE id = ?", [existing.delivery_order_id]);
        if (!delivery) {
          warnings.push("关联交付单不存在: " + existing.delivery_order_id);
        } else if (delivery.status === "arrived") {
          run("UPDATE delivery_orders SET status = 'accepted', actual_date = COALESCE(actual_date, ?), updated_at = datetime('now') WHERE id = ?", [actualDate, delivery.id]);
        } else if (delivery.status !== "accepted") {
          warnings.push(`交付单当前状态为 ${delivery.status}（需先到 arrived 才能自动置 accepted）`);
        }
      }
      if (existing.milestone_id) {
        run("UPDATE contract_milestones SET status = 'completed', actual_date = COALESCE(actual_date, ?), updated_at = datetime('now') WHERE id = ? AND status <> 'completed'", [actualDate, existing.milestone_id]);
      }
    }
    res.json({ ok: true, id: existing.id, result, warnings, item: get("SELECT * FROM acceptance_records WHERE id = ?", [req.params.id]) });
  }));
}

module.exports = {
  initDeliveryRecordsSchema,
  registerDeliveryRecordRoutes,
  DELIVERY_STATUSES,
  DELIVERY_TRANSITIONS,
  DELIVERY_TYPES,
  TRANSPORT_MODES,
  ACCEPTANCE_TYPES,
  ACCEPTANCE_RESULTS,
  nextDocumentNo,
};
