#!/usr/bin/env node
"use strict";
// scripts/trace-chain-audit.js
// P0-2 验收工具：追溯五级链路的**结构 + 填充率**审计（只读）。
//
//   L1 装备 → L2 工单 → L3 工序 → L4 批次/序列号 → L5 检验与证据
//
// 用法：
//   node scripts/trace-chain-audit.js            # 打印表格
//   node scripts/trace-chain-audit.js --json     # 输出 JSON（给巡检/看板）
//   node scripts/trace-chain-audit.js --strict   # 结构缺列/缺索引时退出码 1

const path = require("node:path");
const Database = require("better-sqlite3");

const ROOT = path.resolve(__dirname, "..");
const DB_PATH = path.join(ROOT, "data", "mes.db");
const { SOFT_LINKS, INDEXES } = require(path.join(ROOT, "services", "trace", "chainSchema"));

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const STRICT = args.includes("--strict");

const db = new Database(DB_PATH, { readonly: true });

function hasTable(t) {
  return db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name=?").get(t).c > 0;
}
function hasColumn(t, c) {
  if (!hasTable(t)) return false;
  return db.prepare(`PRAGMA table_info(${t})`).all().some((x) => x.name === c);
}
function hasIndex(name) {
  return db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='index' AND name=?").get(name).c > 0;
}
function count(sql) {
  try { return db.prepare(sql).get().c; } catch (_e) { return null; }
}

// ---------- 结构审计
const structure = [];
for (const [table, ddl] of SOFT_LINKS) {
  const column = ddl.split(" ")[0];
  structure.push({ kind: "column", table, column, ok: hasColumn(table, column) });
}
for (const sql of INDEXES) {
  const name = /INDEX IF NOT EXISTS (\w+)/.exec(sql)[1];
  const table = /ON (\w+)/.exec(sql)[1];
  structure.push({ kind: "index", table, name, ok: hasIndex(name) });
}

// ---------- 填充率审计（只统计可以反查的表）
function fillRate(table, column, where = "") {
  if (!hasTable(table) || !hasColumn(table, column)) return { table, column, total: null, filled: null, pct: null };
  const total = count(`SELECT COUNT(*) c FROM ${table} ${where}`);
  const filled = count(`SELECT COUNT(*) c FROM ${table} ${where ? where + " AND" : "WHERE"} ${column} IS NOT NULL`);
  return { table, column, total, filled, pct: total ? Math.round((filled / total) * 1000) / 10 : null };
}

const fill = [
  fillRate("instance_bom", "material_lot_id"),
  fillRate("instance_bom", "serial_id"),
  fillRate("weld_records", "equipment_instance_id"),
  fillRate("weld_records", "process_node_id"),
  fillRate("assembly_records", "equipment_instance_id"),
  fillRate("serial_numbers", "work_order_id"),
  fillRate("documents", "work_order_id"),
  fillRate("qc_inspections", "serial_id"),
];

// ---------- 链路覆盖率（每个装备是否有该级证据）
const instances = count("SELECT COUNT(*) c FROM equipment_instances") || 0;
const coverage = [
  { level: 1, key: "instance", label: "项目装备", count: instances },
  { level: 2, key: "work_order", label: "有工单", count: count("SELECT COUNT(DISTINCT equipment_instance_id) c FROM work_orders") },
  { level: 3, key: "operation", label: "有工序执行", count: count("SELECT COUNT(DISTINCT wo.equipment_instance_id) c FROM work_order_operations wop JOIN work_orders wo ON wo.id = wop.work_order_id") },
  { level: 4, key: "serial", label: "有序列号", count: count("SELECT COUNT(DISTINCT equipment_instance_id) c FROM serial_numbers WHERE equipment_instance_id IS NOT NULL") },
  { level: 4, key: "bom_lot", label: "BOM 有实装批次", count: count("SELECT COUNT(DISTINCT equipment_instance_id) c FROM instance_bom WHERE material_lot_id IS NOT NULL") },
  { level: 5, key: "qc", label: "有检验", count: count("SELECT COUNT(DISTINCT equipment_instance_id) c FROM qc_inspections") },
  { level: 5, key: "weld", label: "有焊缝", count: count("SELECT COUNT(DISTINCT equipment_instance_id) c FROM weld_records WHERE equipment_instance_id IS NOT NULL") },
  { level: 5, key: "document", label: "有关联文档", count: count("SELECT COUNT(DISTINCT equipment_instance_id) c FROM documents") },
].map((row) => ({ ...row, pct: instances ? Math.round((Number(row.count) / instances) * 1000) / 10 : 0 }));

const structuralFailures = structure.filter((s) => !s.ok);
const result = {
  generated_at: new Date().toISOString(),
  db: DB_PATH,
  instances,
  structure,
  structure_ok: structuralFailures.length === 0,
  structure_failures: structuralFailures,
  fill,
  coverage,
  gaps: [],
};

// ---------- 结论 / 建议
if (!result.structure_ok) result.gaps.push("结构缺口：软关联列或索引缺失，请重启服务让 ensureChainSchema 生效");
for (const f of fill) {
  if (f.total === 0) result.gaps.push(`${f.table}.${f.column}：表为空，暂无数据（不算缺陷，但链路级无法验证）`);
  else if (f.filled === 0) result.gaps.push(`${f.table}.${f.column}：${f.total} 行全部未填（该级链路只能靠多跳推导）`);
}
for (const c of coverage) {
  if (c.level > 1 && c.count === 0) result.gaps.push(`L${c.level} ${c.label}：0/${instances} 台装备有该级证据`);
}

if (JSON_OUT) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log("追溯五级链路审计");
  console.log(`  数据库: ${DB_PATH}`);
  console.log(`  装备数: ${instances}\n`);

  console.log("结构（软关联列 / 索引）");
  if (result.structure_ok) {
    console.log(`  ✅ ${structure.length} 项全部就位`);
  } else {
    for (const fail of structuralFailures) console.log(`  ❌ ${fail.kind} ${fail.table}.${fail.column || fail.name} 缺失`);
  }

  console.log("\n填充率");
  for (const f of fill) {
    const text = f.total === null ? "表/列不存在" : `${f.filled}/${f.total}（${f.pct}%）`;
    console.log(`  ${(f.table + "." + f.column).padEnd(36)} ${text}`);
  }

  console.log("\n链路覆盖率（按装备）");
  for (const c of coverage) {
    console.log(`  L${c.level} ${c.label.padEnd(12)} ${String(c.count).padStart(3)}/${instances} 台（${c.pct}%）`);
  }

  console.log("\n断点与建议");
  if (result.gaps.length === 0) console.log("  ✅ 未发现明显断点");
  else for (const g of result.gaps) console.log(`  ⚠️  ${g}`);
}

db.close();
if (STRICT && !result.structure_ok) process.exit(1);
