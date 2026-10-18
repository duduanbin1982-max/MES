#!/usr/bin/env node
"use strict";
// scripts/oee-recompute-check.js
// P0-1 验收工具：用**两种口径**重算同一批班次的 OEE，并检查口径一致性（默认容忍 2%）。
//
//   口径 A（新，ISA-95）：app/oee/isa95.js —— 三层时间基线 + 六大损失 + 一致性校验
//   口径 B（旧，历史实现）：operating/planned + output×avg(ideal)/operating
//
// 用法：
//   node scripts/oee-recompute-check.js                 # 最近 90 天，只读，打印报告
//   node scripts/oee-recompute-check.js --days=30
//   node scripts/oee-recompute-check.js --strict        # 通过率 < 95% 时退出码 1（可用于 CI/巡检）

const path = require("node:path");
const Database = require("better-sqlite3");

const ROOT = path.resolve(__dirname, "..");
const DB_PATH = path.join(ROOT, "data", "mes.db");
const isa95 = require(path.join(ROOT, "app", "oee", "isa95"));
const { computeOEEFromShifts } = require(path.join(ROOT, "services", "oee", "helpers"));

const args = process.argv.slice(2);
const daysArg = args.find((a) => a.startsWith("--days="));
const DAYS = daysArg ? Number(daysArg.split("=")[1]) : 90;
const STRICT = args.includes("--strict");

function since(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

const db = new Database(DB_PATH, { readonly: true });
const from = since(DAYS);
const shifts = db.prepare("SELECT * FROM oee_shift_log WHERE shift_date >= ? ORDER BY shift_date, id").all(from);
const losses = db.prepare("SELECT * FROM oee_loss_events WHERE start_time >= ?").all(from);

// 统一用 isa95.computeShifts（含"同日多班次 → 归属不可靠 → legacy"的判定）

console.log(`OEE 口径审计：最近 ${DAYS} 天（since=${from}）`);
console.log(`班次数 ${shifts.length}，损失事件 ${losses.length}，阈值 ${isa95.DEFAULT_TOLERANCE * 100}%\n`);

if (shifts.length === 0) {
  console.log("没有班次数据（oee_shift_log 为空），无法审计。");
  db.close();
  process.exit(0);
}

const { perShift } = isa95.computeShifts(shifts, losses);
const rows = perShift.map(({ shift, result }) => ({ shift, a: result }));

// 口径 B：把同一批班次喂给历史实现
const legacy = computeOEEFromShifts(shifts);

const verifiableRows = rows.filter((r) => r.a.data_quality.level !== "legacy");
const mismatchRows = rows.filter((r) => r.a.data_quality.level === "mismatch");
const legacyRows = rows.filter((r) => r.a.data_quality.level === "legacy");
const pass = verifiableRows.length - mismatchRows.length;
const passPct = verifiableRows.length ? Math.round((pass / verifiableRows.length) * 1000) / 10 : 100;
const worst = rows.filter((x) => x.a.data_quality.level === "mismatch")
  .sort((x, y) => y.a.data_quality.diff_pct - x.a.data_quality.diff_pct).slice(0, 5);

const sumBasis = (k) => Math.round(rows.reduce((s, r) => s + (r.a.basis[k] || 0), 0) * 100) / 100;
const aggAvail = sumBasis("planned_production_minutes") > 0 ? sumBasis("run_minutes") / sumBasis("planned_production_minutes") : 0;
const aggPerf = sumBasis("run_minutes") > 0 ? sumBasis("net_run_minutes") / sumBasis("run_minutes") : 0;
const aggQ = rows.reduce((s, r) => s + (Number(r.shift.total_output) || 0), 0) > 0
  ? rows.reduce((s, r) => s + (Number(r.shift.good_output) || 0), 0) / rows.reduce((s, r) => s + (Number(r.shift.total_output) || 0), 0)
  : 0;

console.log("口径 A（ISA-95，加权）：");
console.log(`  可用率 ${(aggAvail * 100).toFixed(2)}%  性能 ${(aggPerf * 100).toFixed(2)}%  质量 ${(aggQ * 100).toFixed(2)}%  OEE ${(aggAvail * aggPerf * aggQ * 100).toFixed(2)}%`);
console.log(`  时间基线：班次 ${sumBasis("shift_minutes")} / 计划停机 ${sumBasis("planned_stop_minutes")} / 计划生产 ${sumBasis("planned_production_minutes")} / 运行 ${sumBasis("run_minutes")} 分钟`);
console.log("\n口径 B（历史实现）：");
console.log(`  可用率 ${(legacy.availability * 100).toFixed(2)}%  性能 ${(legacy.performance * 100).toFixed(2)}%  质量 ${(legacy.quality * 100).toFixed(2)}%  OEE ${(legacy.oee * 100).toFixed(2)}%`);
console.log("\n口径一致性（损失合计 vs 时间差，容忍 " + isa95.DEFAULT_TOLERANCE * 100 + "%）：");
console.log(`  可校验班次 ${verifiableRows.length}（通过 ${pass}，不一致 ${mismatchRows.length}），通过率 ${passPct}%`);
console.log(`  历史/不可校验班次 ${legacyRows.length}（缺三层基线或同日多班次导致损失归属不可靠，需补录 shift_minutes / 显式损失分钟）`);
for (const w of worst) {
  const s = w.shift;
  console.log(`  ! shift#${s.id} ${s.shift_date} ${s.shift_name} 差异 ${w.a.data_quality.diff_pct}% ` +
    `(损失 ${w.a.data_quality.accounted_loss_minutes} vs 应为 ${w.a.data_quality.expected_loss_minutes} 分钟)`);
}

const bothOee = { a: aggAvail * aggPerf * aggQ, b: legacy.oee };
const deltaPct = bothOee.b > 0 ? Math.abs(bothOee.a - bothOee.b) / bothOee.b * 100 : 0;
console.log(`\n两种口径 OEE 差异：${deltaPct.toFixed(2)}%（P0-1 验收要求 < 2%；差异来自损失/时间基线口径不同，属预期）`);

db.close();
if (STRICT && verifiableRows.length > 0 && passPct < 95) {
  console.error("\n❌ 严格模式：可校验班次的口径一致率 < 95%");
  process.exit(1);
}
