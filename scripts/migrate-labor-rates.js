"use strict";
// scripts/migrate-labor-rates.js
// 2026-11-06（工时审计剩余边界 #1 人工费率差异化）：
//   · 创建 labor_rate_cards 表（工种 × 技能等级 × 生效日期 → 小时费率）
//   · 空表时按当前统一费率（system_settings / 环境变量 / 200）为 6 个工种各插一条初始费率卡
// 用法：
//   node scripts/migrate-labor-rates.js --verify
//   node scripts/migrate-labor-rates.js --apply
const Database = require("better-sqlite3");
const path = require("node:path");

const FLAG_DB = process.argv.indexOf("--db");
const DB_PATH = FLAG_DB > -1 && process.argv[FLAG_DB + 1] ? path.resolve(process.argv[FLAG_DB + 1]) : path.resolve(__dirname, "..", "data", "mes.db");
const WORK_TYPES = ["assembly", "welding", "machining", "testing", "qc", "other"];

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function seedRate(db) {
  try {
    const row = db.prepare("SELECT value FROM system_settings WHERE key='labor_rate_per_hour'").get();
    const numeric = Number(row && row.value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  } catch (_error) { /* ignore */ }
  const envRate = Number(process.env.LABOR_RATE_PER_HOUR);
  return Number.isFinite(envRate) && envRate > 0 ? envRate : 200;
}

function planSeed(db) {
  if (!tableExists(db, "labor_rate_cards")) return { actions: [], seed: [], rate: seedRate(db) };
  const existing = db.prepare("SELECT COUNT(*) c FROM labor_rate_cards").get().c;
  const rate = seedRate(db);
  const seed = existing > 0 ? [] : WORK_TYPES.map((workType) => ({ workType, rate }));
  return { actions: [], seed, rate };
}

function apply(db) {
  const created = tableExists(db, "labor_rate_cards") ? false : true;
  db.exec(`CREATE TABLE IF NOT EXISTS labor_rate_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_type TEXT NOT NULL,
    skill_level TEXT NOT NULL DEFAULT 'default',
    hourly_rate REAL NOT NULL CHECK (hourly_rate > 0),
    currency TEXT NOT NULL DEFAULT 'CNY',
    effective_from TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(work_type, skill_level, effective_from)
  )`);
  const plan = planSeed(db);
  const insert = db.prepare(`INSERT OR IGNORE INTO labor_rate_cards (work_type, skill_level, hourly_rate, effective_from, note)
    VALUES (?, 'default', ?, '2026-01-01', '初始值=统一费率，可按工种/技能调整')`);
  let inserted = 0;
  for (const item of plan.seed) {
    const result = insert.run(item.workType, item.rate);
    inserted += result.changes;
  }
  return { created, inserted, rate: plan.rate };
}

function main() {
  const applyMode = process.argv.includes("--apply");
  const db = new Database(DB_PATH);
  try {
    const exists = tableExists(db, "labor_rate_cards");
    const count = exists ? db.prepare("SELECT COUNT(*) c FROM labor_rate_cards").get().c : 0;
    const plan = planSeed(db);
    console.log(`[labor-rates] 数据库: ${DB_PATH}`);
    console.log(`劳动费率表: ${exists ? "存在" : "缺失"}，现有费率卡 ${count} 条，初始费率 ${plan.rate} 元/h`);
    if (plan.seed.length) console.log(`计划插入初始费率卡: ${plan.seed.map((item) => item.workType + "=" + item.rate).join(", ")}`);
    if (applyMode) {
      const result = apply(db);
      console.log(`✅ 建表=${result.created}，插入初始费率卡 ${result.inserted} 条（统一费率 ${result.rate} 元/h）`);
    } else {
      console.log("（未执行，加 --apply 生效）");
    }
    const after = tableExists(db, "labor_rate_cards") ? db.prepare("SELECT work_type, hourly_rate FROM labor_rate_cards ORDER BY work_type").all() : [];
    console.log("当前费率卡:", JSON.stringify(after));
  } finally { db.close(); }
}

module.exports = { planSeed, apply, tableExists, WORK_TYPES };
if (require.main === module) main();
