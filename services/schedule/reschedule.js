"use strict";
// services/schedule/reschedule.js
// 2026-11-03：批量重排程（把「未开工但计划时间已过」的工序整体顺延）
//
// 背景：仪表盘审计发现 123 个工序节点处于「未开工计划过期」状态（计划时间在 7–9 月），
// 需要计划员批量顺延，而不是一条条拖甘特图。
//
// 规则（保守，只动计划时间）：
//   · 默认只处理 status IN ('pending','ready') 且 planned_end < now 的节点；
//   · 只改 planned_start / planned_end，不动状态、不动派工、不动实际时间；
//   · 预览可看明细；应用前服务端重新取候选（不信任前端列表），支持 node_ids 白名单；
//   · 每次应用写一条批次日志（含每节点新旧时间快照），可整批撤销；
//   · 已开工/已完成节点默认不在范围内（避免改写在制计划）。

const { wrap } = require("../../middleware/asyncHandler");
const { ApiError } = require("../../app/errors");

const MAX_SHIFT_DAYS = 365;
const SHIFTABLE_STATUSES = ["pending", "ready", "blocked"];
const DEFAULT_STATUSES = ["pending", "ready"];
const PREVIEW_LIMIT = 300;

function initRescheduleLog(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS process_reschedule_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_no TEXT NOT NULL,
      shift_days INTEGER NOT NULL,
      instance_id INTEGER,
      subsystem_id INTEGER,
      only_overdue INTEGER NOT NULL DEFAULT 1,
      anchor_date TEXT,
      node_count INTEGER NOT NULL DEFAULT 0,
      items_json TEXT,
      note TEXT,
      undone_at TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_reschedule_batches_no ON process_reschedule_batches(batch_no);
    CREATE INDEX IF NOT EXISTS idx_reschedule_batches_created ON process_reschedule_batches(created_at);
  `);
  // 兼容已建过的老表：补 anchor_date 列（CREATE TABLE IF NOT EXISTS 不会改已有表）
  const columns = new Set(db.prepare("PRAGMA table_info(process_reschedule_batches)").all().map((column) => column.name));
  if (!columns.has("anchor_date")) {
    db.exec("ALTER TABLE process_reschedule_batches ADD COLUMN anchor_date TEXT");
  }
}

/** 解析 `YYYY-MM-DD` 或 `YYYY-MM-DD HH:MM[:SS]`，保持原格式回写 */
function parseDateTime(value) {
  if (value === null || value === undefined || value === "") return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?$/.exec(String(value).trim());
  if (!match) return null;
  return { date: match[1], time: match[2] || "" };
}

/** 顺延 N 天；无法识别的格式原样返回（不猜） */
function shiftDateTime(value, days) {
  const parsed = parseDateTime(value);
  if (!parsed) return value;
  const base = new Date(`${parsed.date}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  const nextDate = base.toISOString().slice(0, 10);
  return parsed.time ? `${nextDate} ${parsed.time}` : nextDate;
}

function normalizeDays(value) {
  const days = Number(value);
  if (!Number.isInteger(days) || days === 0 || Math.abs(days) > MAX_SHIFT_DAYS) {
    throw ApiError.validation(`shift_days 必须是 1~${MAX_SHIFT_DAYS} 的整数`);
  }
  return days;
}

function normalizeStatuses(value) {
  const raw = Array.isArray(value) ? value : typeof value === "string" && value ? value.split(",") : DEFAULT_STATUSES;
  const statuses = raw.map((item) => String(item).trim()).filter(Boolean);
  if (!statuses.length) return DEFAULT_STATUSES.slice();
  const invalid = statuses.filter((status) => !SHIFTABLE_STATUSES.includes(status));
  if (invalid.length) {
    throw ApiError.validation(`statuses 只允许 ${SHIFTABLE_STATUSES.join("/")}（不重排已开工/已完成节点）：${invalid.join(",")}`);
  }
  return [...new Set(statuses)];
}

function normalizeOnlyOverdue(value) {
  if (value === undefined || value === null || value === "") return true;
  return !["0", "false", "no"].includes(String(value).toLowerCase());
}

function dayDiffDays(fromDate, toDate) {
  const from = new Date(`${fromDate}T00:00:00Z`).getTime();
  const to = new Date(`${toDate}T00:00:00Z`).getTime();
  return Math.round((to - from) / 86400000);
}

function normalizeAnchorDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw ApiError.validation("anchor_date 必须是 YYYY-MM-DD");
  return text;
}

/** 取候选节点，并算出顺延后的时间（支持 shift_days 或 anchor_date 对齐两种模式） */
function collectCandidates(db, options) {
  const { instanceId, subsystemId, statuses, onlyOverdue } = options;
  const conditions = [`p.status IN (${statuses.map(() => "?").join(",")})`];
  const params = [...statuses];
  if (instanceId) {
    conditions.push("p.equipment_instance_id = ?");
    params.push(instanceId);
  }
  if (subsystemId) {
    conditions.push("p.subsystem_id = ?");
    params.push(subsystemId);
  }
  if (onlyOverdue) conditions.push("p.planned_end IS NOT NULL AND p.planned_end < datetime('now')");
  const rows = db.prepare(`
    SELECT p.id, p.operation_name, p.status, p.planned_start, p.planned_end,
           p.equipment_instance_id, p.subsystem_id, ei.instance_code
      FROM process_nodes p
      LEFT JOIN equipment_instances ei ON ei.id = p.equipment_instance_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY p.planned_start IS NULL, p.planned_start, p.id
  `).all(params);

  // 有效顺延天数：anchor_date 模式 = 目标日期 - 最早计划开始日期（没有开始时间时用最早计划结束日期）
  let effectiveDays = options.shiftDays;
  if (options.anchorDate) {
    const firstStart = rows.map((row) => parseDateTime(row.planned_start)).filter(Boolean).map((item) => item.date).sort()[0]
      || rows.map((row) => parseDateTime(row.planned_end)).filter(Boolean).map((item) => item.date).sort()[0];
    effectiveDays = firstStart ? dayDiffDays(firstStart, options.anchorDate) : 0;
  }
  const items = rows.map((row) => ({
    id: row.id,
    operation_name: row.operation_name,
    status: row.status,
    instance_id: row.equipment_instance_id,
    instance_code: row.instance_code,
    subsystem_id: row.subsystem_id,
    old_planned_start: row.planned_start,
    old_planned_end: row.planned_end,
    new_planned_start: shiftDateTime(row.planned_start, effectiveDays),
    new_planned_end: shiftDateTime(row.planned_end, effectiveDays),
  }));
  return { items, shiftDays: effectiveDays };
}

function summarize(items) {
  const byInstance = new Map();
  for (const item of items) {
    const key = item.instance_code || "未关联项目";
    byInstance.set(key, (byInstance.get(key) || 0) + 1);
  }
  return {
    total: items.length,
    instance_count: byInstance.size,
    by_instance: [...byInstance.entries()].map(([instance_code, count]) => ({ instance_code, count })),
  };
}

function nextBatchNo(db) {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const row = db.prepare("SELECT COUNT(*) AS c FROM process_reschedule_batches WHERE batch_no LIKE ?").get(`RS-${day}-%`);
  return `RS-${day}-${String(Number(row.c) + 1).padStart(3, "0")}`;
}

function registerRescheduleRoutes(app, db) {
  const parseScope = (source) => ({
    instanceId: Number(source.instance_id) || null,
    subsystemId: Number(source.subsystem_id) || null,
  });

  // 预览：只读，返回将被改动的节点与前后时间
  app.get("/api/schedule/reschedule/preview", wrap((req, res) => {
    const scope = parseScope(req.query);
    const anchorDate = normalizeAnchorDate(req.query.anchor_date);
    const shiftDays = anchorDate ? null : normalizeDays(req.query.shift_days);
    const statuses = normalizeStatuses(req.query.statuses);
    const onlyOverdue = normalizeOnlyOverdue(req.query.only_overdue);
    const { items, shiftDays: effectiveDays } = collectCandidates(db, { ...scope, shiftDays, anchorDate, statuses, onlyOverdue });
    res.json({
      anchor_date: anchorDate,
      shift_days: effectiveDays,
      scope: { instance_id: scope.instanceId, subsystem_id: scope.subsystemId, statuses, only_overdue: onlyOverdue, anchor_date: anchorDate },
      stats: summarize(items),
      items: items.slice(0, PREVIEW_LIMIT),
      truncated: items.length > PREVIEW_LIMIT,
    });
  }));

  // 应用：服务端重新取候选（不信任前端列表），事务内逐条更新
  app.post("/api/schedule/reschedule/apply", wrap((req, res) => {
    const body = req.body || {};
    const scope = parseScope(body);
    const anchorDate = normalizeAnchorDate(body.anchor_date);
    const shiftDays = anchorDate ? null : normalizeDays(body.shift_days);
    const statuses = normalizeStatuses(body.statuses);
    const onlyOverdue = normalizeOnlyOverdue(body.only_overdue);
    const { items: allItems, shiftDays: effectiveDays } = collectCandidates(db, { ...scope, shiftDays, anchorDate, statuses, onlyOverdue });

    let items = allItems;
    if (Array.isArray(body.node_ids) && body.node_ids.length) {
      const allow = new Set(body.node_ids.map((id) => Number(id)));
      items = allItems.filter((item) => allow.has(Number(item.id)));
    }
    if (!items.length) throw ApiError.validation("没有可重排的工序节点（检查筛选条件）");

    const batchNo = nextBatchNo(db);
    const itemsJson = JSON.stringify(items.map((item) => ({
      id: item.id,
      status: item.status,
      old_planned_start: item.old_planned_start,
      old_planned_end: item.old_planned_end,
      new_planned_start: item.new_planned_start,
      new_planned_end: item.new_planned_end,
    })));
    const update = db.prepare("UPDATE process_nodes SET planned_start = ?, planned_end = ?, updated_at = datetime('now') WHERE id = ?");

    const applyAll = db.transaction(() => {
      for (const item of items) update.run(item.new_planned_start, item.new_planned_end, item.id);
      db.prepare(`INSERT INTO process_reschedule_batches
          (batch_no, shift_days, instance_id, subsystem_id, only_overdue, anchor_date, node_count, items_json, note, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        batchNo, effectiveDays, scope.instanceId, scope.subsystemId, onlyOverdue ? 1 : 0, anchorDate,
        items.length, itemsJson, String(body.note || "").slice(0, 200) || null,
        req.user?.sub || req.user?.uid || null,
      );
    });
    applyAll();

    const batch = db.prepare("SELECT * FROM process_reschedule_batches WHERE batch_no = ?").get(batchNo);
    res.json({
      ok: true,
      batch_id: batch.id,
      batch_no: batchNo,
      node_count: items.length,
      shift_days: effectiveDays,
      stats: summarize(items),
    });
  }));

  // 批次历史
  app.get("/api/schedule/reschedule/batches", wrap((req, res) => {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const items = db.prepare(`
      SELECT id, batch_no, shift_days, instance_id, subsystem_id, only_overdue, node_count, note, undone_at, created_at
        FROM process_reschedule_batches ORDER BY id DESC LIMIT ?
    `).all(limit);
    res.json({ total: items.length, items });
  }));

  // 撤销整批（只还原"当前时间仍等于本批次写入值"的节点，避免覆盖后续手工调整）
  app.post("/api/schedule/reschedule/batches/:id/undo", wrap((req, res) => {
    const batch = db.prepare("SELECT * FROM process_reschedule_batches WHERE id = ?").get(req.params.id);
    if (!batch) throw ApiError.notFound("batch not found");
    if (batch.undone_at) throw ApiError.validation(`批次 ${batch.batch_no} 已撤销过`);
    const items = JSON.parse(batch.items_json || "[]");
    const restore = db.prepare(`UPDATE process_nodes SET planned_start = ?, planned_end = ?, updated_at = datetime('now')
      WHERE id = ? AND IFNULL(planned_start, '') = IFNULL(?, '') AND IFNULL(planned_end, '') = IFNULL(?, '')`);
    let restored = 0;
    let skipped = 0;
    db.transaction(() => {
      for (const item of items) {
        const result = restore.run(item.old_planned_start, item.old_planned_end, item.id, item.new_planned_start, item.new_planned_end);
        if (result.changes) restored += 1;
        else skipped += 1;
      }
      db.prepare("UPDATE process_reschedule_batches SET undone_at = datetime('now') WHERE id = ?").run(batch.id);
    })();
    res.json({ ok: true, batch_no: batch.batch_no, restored, skipped });
  }));
}

module.exports = {
  registerRescheduleRoutes,
  initRescheduleLog,
  collectCandidates,
  shiftDateTime,
  parseDateTime,
  normalizeStatuses,
  normalizeDays,
  normalizeAnchorDate,
  summarize,
  MAX_SHIFT_DAYS,
  SHIFTABLE_STATUSES,
  DEFAULT_STATUSES,
};
