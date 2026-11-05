"use strict";
// scripts/migrate-purchase-invoices.js
// 2026-11-05（采购链路深挖）：创建 purchase_invoices 表（对账用）。
// 存量库：服务 register 阶段 DDL 会被 serviceMigrations 抑制，需用本脚本一次性建表。
// 用法：
//   node scripts/migrate-purchase-invoices.js --apply
//   node scripts/migrate-purchase-invoices.js --verify
const Database = require("better-sqlite3");
const path = require("node:path");

const DB_FLAG = process.argv.indexOf("--db");
const DB_PATH = DB_FLAG > -1 && process.argv[DB_FLAG + 1] ? path.resolve(process.argv[DB_FLAG + 1]) : path.resolve(__dirname, "..", "data", "mes.db");

function ensure(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS purchase_invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    po_id INTEGER NOT NULL,
    invoice_no TEXT NOT NULL,
    invoice_date TEXT,
    amount REAL NOT NULL,
    tax_amount REAL DEFAULT 0,
    currency TEXT DEFAULT 'CNY',
    status TEXT NOT NULL DEFAULT 'pending',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS ux_purchase_invoices_no ON purchase_invoices(invoice_no)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_purchase_invoices_po ON purchase_invoices(po_id)");
}

function main() {
  const apply = process.argv.includes("--apply");
  const db = new Database(DB_PATH);
  try {
    const exists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'purchase_invoices'").get();
    console.log(`[purchase-invoices] 数据库: ${DB_PATH}`);
    console.log(`purchase_invoices: ${exists ? "存在" : "缺失"}`);
    if (apply && !exists) {
      ensure(db);
      console.log("✅ 已创建 purchase_invoices 及索引");
    } else if (apply) {
      console.log("表已存在，跳过");
    }
    const after = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'purchase_invoices'").get();
    console.log(`校验: ${after ? "✅ 通过" : "❌ 仍缺失（用 --apply 执行）"}`);
    process.exitCode = after ? 0 : 1;
  } finally {
    db.close();
  }
}

main();
