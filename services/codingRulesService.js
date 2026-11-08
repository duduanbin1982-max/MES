"use strict";
// services/codingRulesService.js
// 2026-11-08（编码规则审计）：把硬编码的装备/模板编码规则落成可配置规则 + 原子序列。
const { ApiError } = require("../app/errors");
const { wrap } = require("../middleware/asyncHandler");
const audit = require("../app/audit");
const logger = require("../app/logger").createLogger("codingRulesService");

const ENTITY_TYPES = ["equipment_instance", "equipment_template", "generic"];
const YEAR_MODES = ["none", "year", "month"];
const CUSTOMER_MODES = ["none", "token"];
const RESET_POLICIES = ["never", "year", "month"];

const ENTITY_TABLE = {
  equipment_instance: { table: "equipment_instances", column: "instance_code" },
  equipment_template: { table: "equipment_instance_templates", column: "template_code" },
};

const DEFAULT_RULES = [
  {
    rule_code: "equipment_instance", name: "项目装备编码", entity_type: "equipment_instance",
    prefix: "TBM", separator: "-", year_mode: "year", customer_mode: "token",
    sequence_width: 3, reset_policy: "year", customer_map_json: "{}", description: "TBM-客户缩写-YYYY-###",
  },
  {
    rule_code: "equipment_template", name: "项目模板编码", entity_type: "equipment_template",
    prefix: "TPL", separator: "-", year_mode: "year", customer_mode: "token",
    sequence_width: 3, reset_policy: "year", customer_map_json: "{}", description: "TPL-分类-YYYY-###",
  },
];

function runMigration(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS coding_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      prefix TEXT NOT NULL DEFAULT '',
      separator TEXT NOT NULL DEFAULT '-',
      year_mode TEXT NOT NULL DEFAULT 'year',
      customer_mode TEXT NOT NULL DEFAULT 'none',
      sequence_width INTEGER NOT NULL DEFAULT 3,
      reset_policy TEXT NOT NULL DEFAULT 'year',
      customer_map_json TEXT NOT NULL DEFAULT '{}',
      is_active INTEGER NOT NULL DEFAULT 1,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS coding_sequences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_code TEXT NOT NULL,
      period_key TEXT NOT NULL,
      last_sequence INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(rule_code, period_key)
    );
    CREATE INDEX IF NOT EXISTS idx_coding_sequences_rule ON coding_sequences(rule_code, period_key);
  `);
  const insert = db.prepare(`INSERT OR IGNORE INTO coding_rules
    (rule_code, name, entity_type, prefix, separator, year_mode, customer_mode, sequence_width, reset_policy, customer_map_json, description)
    VALUES (@rule_code, @name, @entity_type, @prefix, @separator, @year_mode, @customer_mode, @sequence_width, @reset_policy, @customer_map_json, @description)`);
  for (const rule of DEFAULT_RULES) insert.run(rule);
}

function cleanToken(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 8);
}

function normalizeYear(value) {
  const year = String(value || new Date().getFullYear()).replace(/\D/g, "").slice(0, 4);
  return year || String(new Date().getFullYear());
}

function parseCustomerMap(raw) {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function customerToken(rule, context) {
  if (rule.customer_mode !== "token") return "";
  const source = String(context.customer ?? context.category ?? "").trim();
  if (!source) return "";
  const map = parseCustomerMap(rule.customer_map_json);
  if (map[source]) return cleanToken(map[source]) || cleanToken(source);
  const normalized = Object.keys(map).find((key) => key.trim().toLowerCase() === source.toLowerCase());
  if (normalized && map[normalized]) return cleanToken(map[normalized]) || cleanToken(source);
  return cleanToken(source);
}

function periodKey(rule, context) {
  if (rule.reset_policy === "never") return "all";
  const year = normalizeYear(context.year);
  if (rule.reset_policy === "month") return `${year}-${String(context.month || new Date().getMonth() + 1).padStart(2, "0")}`;
  return year;
}

function buildCode(rule, context, sequence) {
  const parts = [];
  if (rule.prefix) parts.push(rule.prefix);
  const token = customerToken(rule, context);
  if (token) parts.push(token);
  if (rule.year_mode === "year") parts.push(normalizeYear(context.year));
  else if (rule.year_mode === "month") parts.push(`${normalizeYear(context.year)}${String(context.month || new Date().getMonth() + 1).padStart(2, "0")}`);
  parts.push(String(sequence).padStart(Number(rule.sequence_width || 3), "0"));
  return parts.filter(Boolean).join(rule.separator || "-");
}

function createCodeAllocator(db) {
  const getRule = (ruleCode) => {
    try {
      return db.prepare("SELECT * FROM coding_rules WHERE rule_code = ? AND is_active = 1").get(ruleCode) || null;
    } catch (_error) {
      return null;
    }
  };
  const exists = (rule, code) => {
    const entity = ENTITY_TABLE[rule.entity_type];
    if (!entity) return false;
    try {
      return Boolean(db.prepare(`SELECT 1 FROM ${entity.table} WHERE ${entity.column} = ?`).get(code));
    } catch (_error) {
      return false;
    }
  };
  const currentSequence = (ruleCode, key) => {
    try {
      return Number(db.prepare("SELECT last_sequence FROM coding_sequences WHERE rule_code = ? AND period_key = ?").get(ruleCode, key)?.last_sequence || 0);
    } catch (_error) { return 0; }
  };
  const allocateSequence = (ruleCode, key) => {
    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO coding_sequences (rule_code, period_key, last_sequence) VALUES (?, ?, 1)
        ON CONFLICT(rule_code, period_key) DO UPDATE SET last_sequence = last_sequence + 1, updated_at = datetime('now')`).run(ruleCode, key);
      return Number(db.prepare("SELECT last_sequence FROM coding_sequences WHERE rule_code = ? AND period_key = ?").get(ruleCode, key).last_sequence);
    });
    return tx();
  };
  const nextCode = (ruleCode, context = {}, { preview = false } = {}) => {
    const rule = getRule(ruleCode);
    if (!rule) return null;
    const key = periodKey(rule, context);
    let sequence = preview ? currentSequence(ruleCode, key) + 1 : 0;
    for (let i = 0; i < 200; i += 1) {
      if (preview) sequence += i === 0 ? 0 : 1;
      else sequence = allocateSequence(ruleCode, key);
      const code = buildCode(rule, context, sequence);
      if (!exists(rule, code)) return { code, rule, sequence, period_key: key };
      if (preview && i === 0) continue;
    }
    throw ApiError.conflict("编码序列冲突，请检查编码规则或手工处理");
  };
  const reserveCode = (ruleCode, code, context = {}) => {
    const rule = getRule(ruleCode);
    if (!rule || !code) return;
    const match = String(code).match(/(\d+)$/);
    if (!match) return;
    const sequence = Number(match[1]);
    if (!Number.isInteger(sequence) || sequence <= 0) return;
    const key = periodKey(rule, context);
    db.prepare(`INSERT INTO coding_sequences (rule_code, period_key, last_sequence) VALUES (?, ?, ?)
      ON CONFLICT(rule_code, period_key) DO UPDATE SET last_sequence = MAX(last_sequence, excluded.last_sequence), updated_at = datetime('now')`)
      .run(ruleCode, key, sequence);
  };
  const describeRule = (ruleCode) => {
    const rule = getRule(ruleCode);
    if (!rule) return null;
    return { rule_code: rule.rule_code, description: rule.description, prefix: rule.prefix, separator: rule.separator, year_mode: rule.year_mode, customer_mode: rule.customer_mode, sequence_width: rule.sequence_width, reset_policy: rule.reset_policy };
  };
  return { nextCode, reserveCode, describeRule, getRule };
}

function normalizeRule(body, { partial = false } = {}) {
  const source = body || {};
  const has = (key) => Object.prototype.hasOwnProperty.call(source, key);
  const payload = {};
  if (!partial || has("rule_code")) {
    const ruleCode = String(source.rule_code || "").trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{1,50}$/.test(ruleCode)) throw ApiError.validation("rule_code 需为小写字母/数字/下划线（2~51 位）");
    payload.rule_code = ruleCode;
  }
  if (!partial || has("name")) payload.name = String(source.name || "").trim().slice(0, 100) || null;
  if (!payload.name && !partial) throw ApiError.validation("name 必填");
  if (!partial || has("entity_type")) {
    const entityType = String(source.entity_type || "generic");
    if (!ENTITY_TYPES.includes(entityType)) throw ApiError.validation(`entity_type 必须是 ${ENTITY_TYPES.join(" / ")}`);
    payload.entity_type = entityType;
  }
  if (!partial || has("prefix")) {
    const prefix = String(source.prefix || "").trim().toUpperCase();
    if (!/^[A-Z0-9_-]{0,20}$/.test(prefix)) throw ApiError.validation("prefix 只能包含字母/数字/_/-（最多 20）");
    payload.prefix = prefix;
  }
  if (!partial || has("separator")) {
    const separator = String(source.separator || "-");
    if (!/^[-_.]$/.test(separator)) throw ApiError.validation("separator 只能是 - _ .");
    payload.separator = separator;
  }
  if (!partial || has("year_mode")) {
    const mode = String(source.year_mode || "year");
    if (!YEAR_MODES.includes(mode)) throw ApiError.validation(`year_mode 必须是 ${YEAR_MODES.join(" / ")}`);
    payload.year_mode = mode;
  }
  if (!partial || has("customer_mode")) {
    const mode = String(source.customer_mode || "none");
    if (!CUSTOMER_MODES.includes(mode)) throw ApiError.validation(`customer_mode 必须是 ${CUSTOMER_MODES.join(" / ")}`);
    payload.customer_mode = mode;
  }
  if (!partial || has("sequence_width")) {
    const width = Number(source.sequence_width ?? 3);
    if (!Number.isInteger(width) || width < 1 || width > 8) throw ApiError.validation("sequence_width 需在 1~8");
    payload.sequence_width = width;
  }
  if (!partial || has("reset_policy")) {
    const policy = String(source.reset_policy || "year");
    if (!RESET_POLICIES.includes(policy)) throw ApiError.validation(`reset_policy 必须是 ${RESET_POLICIES.join(" / ")}`);
    payload.reset_policy = policy;
  }
  if (!partial || has("customer_map_json")) {
    let map = {};
    if (source.customer_map_json !== undefined) {
      if (typeof source.customer_map_json === "string") {
        try { map = JSON.parse(source.customer_map_json || "{}"); } catch (_error) { throw ApiError.validation("customer_map_json 必须是合法 JSON"); }
      } else map = source.customer_map_json;
    }
    if (!map || typeof map !== "object" || Array.isArray(map)) throw ApiError.validation("customer_map_json 必须是对象");
    payload.customer_map_json = JSON.stringify(map);
  }
  if (!partial || has("is_active")) payload.is_active = source.is_active === false || source.is_active === 0 ? 0 : 1;
  if (!partial || has("description")) payload.description = source.description == null ? null : String(source.description).slice(0, 500);
  return payload;
}

function register(app, db) {
  runMigration(db);
  const all = (sql, p = []) => db.prepare(sql).all(...p);
  const get = (sql, p = []) => db.prepare(sql).get(...p);
  const run = (sql, p = []) => db.prepare(sql).run(...p);
  const allocator = createCodeAllocator(db);

  app.get("/api/coding-rules", wrap((_req, res) => {
    res.json({ rules: all("SELECT * FROM coding_rules ORDER BY entity_type, rule_code") });
  }));

  app.get("/api/coding-rules/:ruleCode", wrap((req, res) => {
    const rule = get("SELECT * FROM coding_rules WHERE rule_code = ?", [req.params.ruleCode]);
    if (!rule) throw ApiError.notFound("编码规则不存在");
    res.json(rule);
  }));

  app.post("/api/coding-rules", wrap((req, res) => {
    const payload = normalizeRule(req.body || {});
    if (!payload.name) throw ApiError.validation("name 必填");
    if (get("SELECT id FROM coding_rules WHERE rule_code = ?", [payload.rule_code])) throw ApiError.conflict("rule_code 已存在");
    const columns = Object.keys(payload).filter((key) => payload[key] !== undefined);
    const result = run(`INSERT INTO coding_rules (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`, columns.map((key) => payload[key]));
    audit.record(db, req, { action: "coding_rule.create", resource_type: "coding_rule", resource_id: result.lastInsertRowid, after: payload, diff_summary: `新增编码规则 ${payload.rule_code}` });
    res.status(201).json({ id: result.lastInsertRowid, rule_code: payload.rule_code });
  }));

  app.put("/api/coding-rules/:ruleCode", wrap((req, res) => {
    const current = get("SELECT * FROM coding_rules WHERE rule_code = ?", [req.params.ruleCode]);
    if (!current) throw ApiError.notFound("编码规则不存在");
    const payload = normalizeRule(req.body || {}, { partial: true });
    delete payload.rule_code;
    const entries = Object.entries(payload);
    if (!entries.length) throw ApiError.validation("无可更新字段");
    run(`UPDATE coding_rules SET ${entries.map(([key]) => `${key} = ?`).join(",")}, updated_at = datetime('now') WHERE id = ?`, [...entries.map(([, value]) => value), current.id]);
    audit.record(db, req, { action: "coding_rule.update", resource_type: "coding_rule", resource_id: current.id, before: current, after: payload, diff_summary: `更新编码规则 ${current.rule_code}` });
    res.json({ success: true });
  }));

  app.delete("/api/coding-rules/:ruleCode", wrap((req, res) => {
    const current = get("SELECT * FROM coding_rules WHERE rule_code = ?", [req.params.ruleCode]);
    if (!current) throw ApiError.notFound("编码规则不存在");
    run("DELETE FROM coding_rules WHERE id = ?", [current.id]);
    audit.record(db, req, { action: "coding_rule.delete", resource_type: "coding_rule", resource_id: current.id, before: current, diff_summary: `删除编码规则 ${current.rule_code}` });
    res.json({ success: true });
  }));

  app.get("/api/coding-rules/:ruleCode/preview", wrap((req, res) => {
    const rule = get("SELECT * FROM coding_rules WHERE rule_code = ? AND is_active = 1", [req.params.ruleCode]);
    if (!rule) throw ApiError.notFound("编码规则不存在或已停用");
    const result = allocator.nextCode(rule.rule_code, { customer: req.query.customer, category: req.query.category, year: req.query.year, month: req.query.month }, { preview: true });
    res.json({ rule_code: rule.rule_code, code: result.code, preview: true, description: rule.description });
  }));

  logger.info("[codingRulesService] coding rules registered");
}

module.exports = { register, runMigration, createCodeAllocator, DEFAULT_RULES };
