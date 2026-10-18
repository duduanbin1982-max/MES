#!/usr/bin/env node
"use strict";
// scripts/data-backfill.js
// P0-B（2026-10-18）：数据补录工具 —— 把"建好但没数据"的功能接上真实数据。
//
// 支持三类补录（都只做**字段级 UPDATE/INSERT**，可回滚）：
//   1) bom-lots   instance_bom.material_lot_id / serial_id   ← 设计 BOM ↔ 实装批次/序列号
//   2) serials    serial_numbers 建档（序列号 → 批次/装备/工单）
//   3) oee-shifts oee_shift_log 的三层时间基线（计划停机 / 故障 / 换型 / 待料 / 空转）
//
// 安全设计：
//   - 默认 --dry-run：只打印"将改什么"，不写库
//   - --apply 才真正写；每批生成边车记录 data/backfill/batch-<ts>.json，含每一行的旧值
//   - --rollback <batch-file> 按边车记录逐字段还原（只还原本工具改过的列）
//   - 写库前检查最近备份年龄（>6h 时默认拒绝，--force 跳过）
//   - 已填过值的行默认跳过（--overwrite 才覆盖）
//
// 用法：
//   node scripts/data-backfill.js --type=bom-lots  --csv=t.csv            # dry-run
//   node scripts/data-backfill.js --type=bom-lots  --csv=t.csv --apply
//   node scripts/data-backfill.js --rollback=data/backfill/batch-20261018_223000.json
//   node scripts/data-backfill.js --type=oee-shifts --csv=shifts.csv --apply
//   node scripts/data-backfill.js --type=serials --csv=serials.csv --apply
//
// CSV 表头见 docs/backfill.md；模板可用 node scripts/gen-backfill-templates.js 生成。

const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const ROOT = path.resolve(__dirname, "..");
const DB_PATH = path.join(ROOT, "data", "mes.db");
const BACKFILL_DIR = path.join(ROOT, "data", "backfill");
const MAX_BACKUP_AGE_H = 6;

// ---------------------------------------------------------------- CSV
/**
 * CSV 字节 → 文本（自动识别编码）。
 * 背景：Excel 中文环境「另存为 CSV」默认是 GBK/GB18030，直接按 utf8 读会乱码，
 * 导致 supplier/notes 变成乱码、甚至 material_code 匹配失败。
 */
function decodeCsvBuffer(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch (_error) {
    return { text: new TextDecoder("gbk").decode(bytes), encoding: "gbk" };
  }
}

/** 极简 RFC4180 解析：支持引号、逗号、CRLF、BOM 头 */
function parseCsv(text) {
  const clean = String(text || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ",") { row.push(field); field = ""; continue; }
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    if (ch === "\r") continue;
    field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const nonEmpty = rows.filter((r) => r.some((cell) => String(cell).trim() !== ""));
  if (nonEmpty.length === 0) return [];
  const header = nonEmpty[0].map((h) => String(h).trim());
  return nonEmpty.slice(1).map((cells) => {
    const obj = {};
    header.forEach((key, idx) => { obj[key] = String(cells[idx] === undefined ? "" : cells[idx]).trim(); });
    return obj;
  });
}

/**
 * 日期归一：Excel 常把 2026-10-15 写成 2026/10/15 或 2026.10.15。
 * 统一转成 YYYY-MM-DD；无法识别返回 null（调用方报错）。
 */
function normalizeDate(value) {
  const text = String(value === undefined || value === null ? "" : value).trim();
  if (!text) return null;
  const match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  // 粗校验：月份 1-12、日期 1-31
  if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) return null;
  return `${year}-${mm}-${dd}`;
}

function num(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------- 计划（纯函数，可单测）
function planBomLots(db, rows, options = {}) {
  const plan = { type: "bom-lots", changes: [], skipped: [], errors: [] };
  const getInstance = db.prepare("SELECT id, instance_code FROM equipment_instances WHERE instance_code = ?");
  for (const [index, row] of rows.entries()) {
    const line = index + 2;
    const instanceCode = row.instance_code || row["装备编码"];
    const materialCode = row.material_code || row["物料编码"] || null;
    const partNumber = row.part_number || row["零件号"] || null;
    const lotNo = row.lot_no || row["批次号"];
    const serialNo = row.serial_no || row["序列号"] || null;
    if (!instanceCode || (!materialCode && !partNumber) || (!lotNo && !serialNo)) {
      plan.errors.push({ line, reason: "instance_code / (material_code 或 part_number) / (lot_no 或 serial_no) 必填", row });
      continue;
    }
    const instance = getInstance.get(instanceCode);
    if (!instance) { plan.errors.push({ line, reason: `装备编码不存在: ${instanceCode}`, row }); continue; }

    // 现网 BOM 行可能没有 part_number（只有 material_id），所以优先按物料编码匹配
    let bomRow;
    let matchedBy;
    if (materialCode) {
      const material = db.prepare("SELECT id FROM materials WHERE material_code = ?").get(materialCode);
      if (!material) { plan.errors.push({ line, reason: `物料编码不存在: ${materialCode}`, row }); continue; }
      const rowsFound = db.prepare(
        "SELECT id, material_id, material_lot_id, serial_id FROM instance_bom WHERE equipment_instance_id = ? AND material_id = ?"
      ).all(instance.id, material.id);
      if (rowsFound.length === 0) { plan.errors.push({ line, reason: `BOM 行不存在: ${instanceCode} / 物料 ${materialCode}`, row }); continue; }
      if (rowsFound.length > 1) { plan.errors.push({ line, reason: `同一装备同一物料有多条 BOM 行（${rowsFound.length} 条），请改用 part_number 精确匹配`, row }); continue; }
      bomRow = rowsFound[0];
      matchedBy = materialCode;
    } else {
      bomRow = db.prepare(
        "SELECT id, material_id, material_lot_id, serial_id FROM instance_bom WHERE equipment_instance_id = ? AND part_number = ?"
      ).get(instance.id, partNumber);
      if (!bomRow) { plan.errors.push({ line, reason: `BOM 行不存在: ${instanceCode} / ${partNumber}`, row }); continue; }
      matchedBy = partNumber;
    }
    let lotId = null;
    if (lotNo) {
      const lot = db.prepare("SELECT id, material_id FROM material_lots WHERE lot_no = ?").get(lotNo);
      if (!lot) { plan.errors.push({ line, reason: `批次号不存在: ${lotNo}`, row }); continue; }
      if (lot.material_id !== bomRow.material_id && !options.allowMaterialMismatch) {
        plan.errors.push({ line, reason: `批次物料与 BOM 物料不一致（lot.material_id=${lot.material_id}, bom.material_id=${bomRow.material_id}），如确认可加 --allow-material-mismatch`, row });
        continue;
      }
      lotId = lot.id;
    }
    let serialId = null;
    if (serialNo) {
      const serial = db.prepare("SELECT id FROM serial_numbers WHERE serial_no = ?").get(serialNo);
      if (!serial) { plan.errors.push({ line, reason: `序列号不存在: ${serialNo}（先用 --type=serials 建档）`, row }); continue; }
      serialId = serial.id;
    }
    if (bomRow.material_lot_id && lotId && !options.overwrite) {
      plan.skipped.push({ line, reason: "material_lot_id 已有值（加 --overwrite 覆盖）", id: bomRow.id });
      continue;
    }
    if (lotId) plan.changes.push({ table: "instance_bom", rowId: bomRow.id, column: "material_lot_id", oldValue: bomRow.material_lot_id, newValue: lotId, key: `${instanceCode}/${matchedBy}` });
    if (serialId) plan.changes.push({ table: "instance_bom", rowId: bomRow.id, column: "serial_id", oldValue: bomRow.serial_id, newValue: serialId, key: `${instanceCode}/${matchedBy}` });
  }
  return plan;
}

function planSerials(db, rows) {
  const plan = { type: "serials", inserts: [], skipped: [], errors: [] };
  const seen = new Set();
  for (const [index, row] of rows.entries()) {
    const line = index + 2;
    const serialNo = row.serial_no || row["序列号"];
    if (!serialNo) { plan.errors.push({ line, reason: "serial_no 必填", row }); continue; }
    if (seen.has(serialNo)) {
      plan.skipped.push({ line, reason: `CSV 内重复序列号: ${serialNo}` });
      continue;
    }
    if (db.prepare("SELECT id FROM serial_numbers WHERE serial_no = ?").get(serialNo)) {
      plan.skipped.push({ line, reason: `序列号已存在: ${serialNo}` });
      continue;
    }
    seen.add(serialNo);
    let lotId = null;
    const lotNo = row.lot_no || row["批次号"];
    if (lotNo) {
      const lot = db.prepare("SELECT id FROM material_lots WHERE lot_no = ?").get(lotNo);
      if (!lot) { plan.errors.push({ line, reason: `批次号不存在: ${lotNo}`, row }); continue; }
      lotId = lot.id;
    }
    let instanceId = null;
    const instanceCode = row.instance_code || row["装备编码"];
    if (instanceCode) {
      const instance = db.prepare("SELECT id FROM equipment_instances WHERE instance_code = ?").get(instanceCode);
      if (!instance) { plan.errors.push({ line, reason: `装备编码不存在: ${instanceCode}`, row }); continue; }
      instanceId = instance.id;
    }
    let workOrderId = null;
    const woCode = row.work_order_code || row["工单号"];
    if (woCode) {
      const wo = db.prepare("SELECT id FROM work_orders WHERE wo_code = ?").get(woCode);
      if (!wo) { plan.errors.push({ line, reason: `工单号不存在: ${woCode}`, row }); continue; }
      workOrderId = wo.id;
    }
    plan.inserts.push({ table: "serial_numbers", values: {
      serial_no: serialNo, lot_id: lotId, equipment_instance_id: instanceId,
      status: row.status || row["状态"] || "in_stock", work_order_id: workOrderId,
    } });
  }
  return plan;
}

const OEE_COLUMNS = ["shift_minutes", "planned_stop_minutes", "fault_minutes", "changeover_minutes", "material_wait_minutes", "idle_minutes"];

// B-2（2026-10-18）：批次批量登记 —— 现在库里只有 3 个批次，BOM 补录根本无从谈起。
// CSV: material_code, lot_no, supplier, heat_no, certificate_no, received_date, quantity, unit, quality_status, notes
function planLots(db, rows) {
  const plan = { type: "lots", inserts: [], skipped: [], errors: [] };
  const seen = new Set();
  for (const [index, row] of rows.entries()) {
    const line = index + 2;
    const materialCode = row.material_code || row["物料编码"];
    const lotNo = row.lot_no || row["批次号"];
    if (!materialCode || !lotNo) { plan.errors.push({ line, reason: "material_code / lot_no 必填", row }); continue; }
    const material = db.prepare("SELECT id, material_name FROM materials WHERE material_code = ?").get(materialCode);
    if (!material) { plan.errors.push({ line, reason: `物料编码不存在: ${materialCode}`, row }); continue; }
    const key = `${material.id}|${lotNo}`;
    if (seen.has(key)) { plan.skipped.push({ line, reason: `CSV 内重复批次: ${materialCode} / ${lotNo}` }); continue; }
    if (db.prepare("SELECT id FROM material_lots WHERE material_id = ? AND lot_no = ?").get(material.id, lotNo)) {
      plan.skipped.push({ line, reason: `批次已存在: ${materialCode} / ${lotNo}` });
      continue;
    }
    const quantity = num(row.quantity);
    if (quantity !== null && quantity < 0) { plan.errors.push({ line, reason: `quantity 不能为负: ${row.quantity}`, row }); continue; }
    const rawDate = row.received_date || row["到货日期"] || "";
    const receivedDate = normalizeDate(rawDate);
    if (String(rawDate).trim() && !receivedDate) {
      plan.errors.push({ line, reason: `received_date 无法识别（支持 2026-10-15 / 2026/10/15）: ${rawDate}`, row }); continue;
    }
    seen.add(key);
    plan.inserts.push({ table: "material_lots", values: {
      material_id: material.id,
      lot_no: lotNo,
      supplier: row.supplier || row["供应商"] || null,
      heat_no: row.heat_no || row["炉号"] || null,
      certificate_no: row.certificate_no || row["质保书号"] || null,
      received_date: receivedDate,
      quantity: quantity,
      unit: row.unit || row["单位"] || null,
      quality_status: row.quality_status || row["质检状态"] || "pending",
      notes: row.notes || row["备注"] || null,
    } });
  }
  return plan;
}

// 数据完备度报告（只读）：看清"还差多少才能做 BOM 批次补录"
function completenessReport(db) {
  const one = (sql, params = []) => { try { return db.prepare(sql).get(params) || {}; } catch (_e) { return {}; } };
  const count = (sql, params = []) => Number(one(sql, params).c || 0);
  const materials = count("SELECT COUNT(*) c FROM materials");
  const lots = count("SELECT COUNT(*) c FROM material_lots");
  const materialsWithLot = count("SELECT COUNT(DISTINCT material_id) c FROM material_lots");
  const instances = count("SELECT COUNT(*) c FROM equipment_instances");
  const serials = count("SELECT COUNT(*) c FROM serial_numbers");
  const bomRows = count("SELECT COUNT(*) c FROM instance_bom");
  const bomWithMaterial = count("SELECT COUNT(*) c FROM instance_bom WHERE material_id IS NOT NULL");
  const bomWithLot = count("SELECT COUNT(*) c FROM instance_bom WHERE material_lot_id IS NOT NULL");
  const bomWithSerial = count("SELECT COUNT(*) c FROM instance_bom WHERE serial_id IS NOT NULL");
  const oeeShifts = count("SELECT COUNT(*) c FROM oee_shift_log");
  const oeeExplicit = count(`SELECT COUNT(*) c FROM oee_shift_log
    WHERE COALESCE(fault_minutes,0)+COALESCE(changeover_minutes,0)+COALESCE(material_wait_minutes,0) > 0`);
  const materialsWithoutLot = db.prepare(`
    SELECT m.material_code, m.material_name
    FROM materials m LEFT JOIN material_lots ml ON ml.material_id = m.id
    WHERE ml.id IS NULL ORDER BY m.material_code
  `).all();
  const pct = (part, total) => (total ? Math.round((part / total) * 1000) / 10 : null);
  return {
    materials: { total: materials, with_lot: materialsWithLot, pct: pct(materialsWithLot, materials) },
    lots: { total: lots },
    instances: { total: instances },
    serials: { total: serials },
    bom: { total: bomRows, with_material: bomWithMaterial, with_lot: bomWithLot, with_serial: bomWithSerial, lot_pct: pct(bomWithLot, bomRows) },
    oee: { shifts: oeeShifts, with_explicit_loss: oeeExplicit, pct: pct(oeeExplicit, oeeShifts) },
    materials_without_lot: materialsWithoutLot,
  };
}

function planOeeShifts(db, rows) {
  const plan = { type: "oee-shifts", changes: [], skipped: [], errors: [] };
  for (const [index, row] of rows.entries()) {
    const line = index + 2;
    const shiftId = num(row.shift_id);
    if (!shiftId) { plan.errors.push({ line, reason: "shift_id 必填", row }); continue; }
    const shift = db.prepare("SELECT * FROM oee_shift_log WHERE id = ?").get(shiftId);
    if (!shift) { plan.errors.push({ line, reason: `班次不存在: ${shiftId}`, row }); continue; }
    let touched = 0;
    for (const column of OEE_COLUMNS) {
      const value = num(row[column]);
      if (value === null) continue;
      if (Number(shift[column] || 0) === value) continue;
      plan.changes.push({ table: "oee_shift_log", rowId: shiftId, column, oldValue: shift[column], newValue: value, key: `${shift.shift_date}/${shift.shift_name}` });
      touched++;
    }
    if (!touched) plan.skipped.push({ line, reason: "无需变更", id: shiftId });
  }
  return plan;
}

// ---------------------------------------------------------------- 应用 / 回滚
function latestBackupAgeHours() {
  const dir = path.join(ROOT, "backups");
  try {
    const files = fs.readdirSync(dir).filter((f) => f.startsWith("mes.db.") && !f.includes("weekly"));
    if (!files.length) return Infinity;
    const newest = Math.max(...files.map((f) => fs.statSync(path.join(dir, f)).mtimeMs));
    return (Date.now() - newest) / 3600000;
  } catch (_error) {
    return Infinity;
  }
}

function applyPlan(db, plan, options = {}) {
  if (!fs.existsSync(BACKFILL_DIR)) fs.mkdirSync(BACKFILL_DIR, { recursive: true });
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const batchFile = path.join(BACKFILL_DIR, `batch-${stamp}-${plan.type}.json`);
  const applied = [];

  const tx = db.transaction(() => {
    for (const change of plan.changes || []) {
      db.prepare(`UPDATE ${change.table} SET ${change.column} = ? WHERE id = ?`).run(change.newValue, change.rowId);
      applied.push(change);
    }
    for (const insert of plan.inserts || []) {
      const columns = Object.keys(insert.values);
      const result = db.prepare(`INSERT INTO ${insert.table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`)
        .run(...columns.map((c) => insert.values[c]));
      applied.push({ table: insert.table, rowId: Number(result.lastInsertRowid), column: "__insert__", oldValue: null, newValue: insert.values });
    }
  });
  tx();

  const record = {
    batch: path.basename(batchFile), type: plan.type, created_at: new Date().toISOString(),
    db: DB_PATH, applied, skipped: plan.skipped || [], errors: plan.errors || [], rolled_back: false,
  };
  fs.writeFileSync(batchFile, JSON.stringify(record, null, 2));
  return { batchFile, applied: applied.length };
}

function rollbackBatch(db, batchFile) {
  const record = JSON.parse(fs.readFileSync(batchFile, "utf8"));
  if (record.rolled_back) return { already: true, reverted: 0 };
  let reverted = 0;
  const tx = db.transaction(() => {
    for (const change of [...record.applied].reverse()) {
      if (change.column === "__insert__") {
        db.prepare(`DELETE FROM ${change.table} WHERE id = ?`).run(change.rowId);
      } else {
        db.prepare(`UPDATE ${change.table} SET ${change.column} = ? WHERE id = ?`).run(change.oldValue, change.rowId);
      }
      reverted++;
    }
  });
  tx();
  record.rolled_back = true;
  record.rolled_back_at = new Date().toISOString();
  fs.writeFileSync(batchFile, JSON.stringify(record, null, 2));
  return { already: false, reverted };
}

// ---------------------------------------------------------------- CLI
function parseArgs(argv) {
  const args = {};
  for (const item of argv) {
    if (item.startsWith("--")) {
      const [key, value] = item.slice(2).split("=");
      args[key] = value === undefined ? true : value;
    }
  }
  return args;
}

function printPlan(plan, limit = 10) {
  const total = (plan.changes || []).length + (plan.inserts || []).length;
  console.log(`类型 ${plan.type}：将写入 ${total} 处变更，跳过 ${(plan.skipped || []).length}，错误 ${(plan.errors || []).length}`);
  const preview = [...(plan.changes || []), ...(plan.inserts || [])].slice(0, limit);
  for (const item of preview) {
    if (item.values || item.column === "__insert__") {
      console.log(`  + ${item.table} INSERT ${JSON.stringify(item.values)}`);
    } else {
      console.log(`  ~ ${item.table}#${item.rowId} ${item.column}: ${item.oldValue} → ${item.newValue}  (${item.key})`);
    }
  }
  if (total > preview.length) console.log(`  ... 其余 ${total - preview.length} 处省略`);
  for (const error of (plan.errors || []).slice(0, limit)) console.log(`  ✗ 第 ${error.line} 行: ${error.reason}`);
  for (const skip of (plan.skipped || []).slice(0, 3)) console.log(`  - 跳过: ${skip.reason}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = new Database(DB_PATH);

  if (args.report) {
    const report = completenessReport(db);
    console.log(JSON.stringify(report, null, 2));
    db.close();
    return;
  }

  if (args.rollback) {
    const result = rollbackBatch(db, path.resolve(ROOT, String(args.rollback)));
    console.log(result.already ? "该批次已回滚过" : `已回滚 ${result.reverted} 处变更`);
    db.close();
    return;
  }

  const type = String(args.type || "");
  if (!type || !args.csv) {
    console.error("用法: node scripts/data-backfill.js --type=bom-lots|lots|serials|oee-shifts --csv=file.csv [--apply] [--overwrite] [--allow-material-mismatch] [--force]");
    console.error("      node scripts/data-backfill.js --report            # 数据完备度报告（只读）");
    console.error("      node scripts/data-backfill.js --rollback=batch.json");
    process.exit(2);
  }
  const raw = fs.readFileSync(path.resolve(ROOT, String(args.csv)));
  const decoded = decodeCsvBuffer(raw);
  if (decoded.encoding !== "utf-8") {
    console.log(`（检测到 ${decoded.encoding.toUpperCase()} 编码，已自动转换：Excel 默认另存为 CSV 时常见）`);
  }
  const rows = parseCsv(decoded.text);
  if (!rows.length) { console.error("CSV 没有数据行"); process.exit(2); }

  let plan;
  if (type === "bom-lots") plan = planBomLots(db, rows, { overwrite: !!args.overwrite, allowMaterialMismatch: !!args["allow-material-mismatch"] });
  else if (type === "serials") plan = planSerials(db, rows);
  else if (type === "oee-shifts") plan = planOeeShifts(db, rows);
  else if (type === "lots") plan = planLots(db, rows);
  else { console.error("未知类型: " + type); process.exit(2); }

  printPlan(plan);
  if (!args.apply) { console.log("\n（dry-run，未写库；确认无误后加 --apply）"); db.close(); return; }

  const ageH = latestBackupAgeHours();
  if (ageH > MAX_BACKUP_AGE_H && !args.force) {
    console.error(`\n拒绝写库：最近备份已 ${ageH.toFixed(1)}h 前（>${MAX_BACKUP_AGE_H}h）。先跑 scripts/backup-db.sh，或加 --force`);
    db.close();
    process.exit(3);
  }
  const result = applyPlan(db, plan);
  console.log(`\n已应用：${result.applied} 处；边车记录 ${result.batchFile}`);
  console.log("回滚：node scripts/data-backfill.js --rollback=" + path.relative(ROOT, result.batchFile));
  db.close();
}

module.exports = { parseCsv, decodeCsvBuffer, normalizeDate, planBomLots, planSerials, planOeeShifts, planLots, completenessReport, applyPlan, rollbackBatch, latestBackupAgeHours, OEE_COLUMNS };

if (require.main === module) main();
