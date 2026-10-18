#!/usr/bin/env node
"use strict";
// scripts/gen-backfill-templates.js
// P0-B（2026-10-18）：生成三类补录模板（CSV），交给业务填写。
//
//   node scripts/gen-backfill-templates.js                # 生成全部三类
//   node scripts/gen-backfill-templates.js --type=bom-lots
//
// 输出目录：data/backfill/templates/
//   bom-lots.csv     instance_bom 的 79 行（含装备/零件号/已知批次列为空待填）
//   serials.csv      关键件序列号建档模板（示例 1 行 + 表头）
//   oee-shifts.csv   三层基线待补录的班次（自动预填建议值，业务改成分摊后的真实分钟）

const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "data", "backfill", "templates");
const db = new Database(path.join(ROOT, "data", "mes.db"), { readonly: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

function csvEscape(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}
function writeCsv(name, header, rows) {
  const lines = [header.join(","), ...rows.map((row) => header.map((key) => csvEscape(row[key])).join(","))];
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, lines.join("\n") + "\n");
  console.log(`${name}: ${rows.length} 行 → ${path.relative(ROOT, file)}`);
}

const args = {};
for (const item of process.argv.slice(2)) {
  if (item.startsWith("--")) { const [k, v] = item.slice(2).split("="); args[k] = v === undefined ? true : v; }
}
const want = (type) => !args.type || args.type === type;

// 1) bom-lots：每个 BOM 行一行，待填 lot_no / serial_no
if (want("bom-lots")) {
  const rows = db.prepare(`
    SELECT ei.instance_code, ib.part_number AS part_number, m.material_code AS material_code,
           m.material_name AS material_name, ib.quantity AS qty, ib.is_key_component AS is_key_component,
           ml.lot_no AS current_lot_no
    FROM instance_bom ib
    JOIN equipment_instances ei ON ei.id = ib.equipment_instance_id
    JOIN materials m ON m.id = ib.material_id
    LEFT JOIN material_lots ml ON ml.id = ib.material_lot_id
    WHERE m.material_code IS NOT NULL
    ORDER BY ei.instance_code, ib.id
  `).all();
  const skipped = db.prepare(`
    SELECT COUNT(*) c FROM instance_bom ib
    LEFT JOIN materials m ON m.id = ib.material_id
    WHERE ib.material_id IS NULL OR m.material_code IS NULL
  `).get().c;
  if (skipped) console.log(`（跳过 ${skipped} 行无零件号/无物料的 BOM 行：通常是装配/工艺节点，不参与批次补录）`);
  writeCsv("bom-lots.csv",
    ["instance_code", "material_code", "part_number", "material_name", "qty", "is_key_component", "lot_no", "serial_no", "current_lot_no"],
    rows.map((row) => ({ ...row, lot_no: "", serial_no: "" })));
}

// 2) serials：给关键件建档的模板（表头 + 两行示例，示例行请替换）
if (want("serials")) {
  const keyParts = db.prepare(`
    SELECT ei.instance_code, ib.part_number, m.material_code, m.material_name
    FROM instance_bom ib
    JOIN equipment_instances ei ON ei.id = ib.equipment_instance_id
    LEFT JOIN materials m ON m.id = ib.material_id
    WHERE ib.is_key_component = 1
    ORDER BY ei.instance_code, ib.id LIMIT 10
  `).all();
  const rows = keyParts.map((part) => ({
    serial_no: "", material_code: part.material_code || "", lot_no: "",
    instance_code: part.instance_code, work_order_code: "", status: "in_stock", note: "关键件，请填序列号与批次",
  }));
  writeCsv("serials.csv", ["serial_no", "material_code", "lot_no", "instance_code", "work_order_code", "status", "note"], rows);
}

// 2.5) lots：批次批量登记（现网只有 3 个批次；没有物料清单的物料先列出来）
if (want("lots")) {
  const noLot = db.prepare(`
    SELECT m.material_code, m.material_name
    FROM materials m LEFT JOIN material_lots ml ON ml.material_id = m.id
    WHERE ml.id IS NULL ORDER BY m.material_code
  `).all();
  const example = noLot.slice(0, 10).map((material) => ({
    material_code: material.material_code, lot_no: "", supplier: "", heat_no: "", certificate_no: "",
    received_date: "", quantity: "", unit: "", quality_status: "pending", notes: `${material.material_name}（请填批次信息）`,
  }));
  writeCsv("lots.csv",
    ["material_code", "lot_no", "supplier", "heat_no", "certificate_no", "received_date", "quantity", "unit", "quality_status", "notes"],
    example);
  const withLot = db.prepare("SELECT COUNT(DISTINCT material_id) c FROM material_lots").get().c;
  console.log(`  （物料 ${noLot.length + withLot} 种，已有批次 ${withLot} 种，待登记 ${noLot.length} 种：上面模板列出前 10 个，其余照表头自行追加）`);
}

// 3) oee-shifts：legacy 班次（缺三层基线），预填"计划生产 − 运行 = 可用率损失合计"作为拆分基准
if (want("oee-shifts")) {
  const rows = db.prepare(`
    SELECT id AS shift_id, shift_date, shift_name, planned_minutes, operating_minutes,
           ideal_cycle_time, total_output, good_output, shift_minutes,
           planned_stop_minutes, fault_minutes, changeover_minutes, material_wait_minutes, idle_minutes
    FROM oee_shift_log
    WHERE COALESCE(shift_minutes, 0) = 0
       OR COALESCE(fault_minutes,0) + COALESCE(changeover_minutes,0) + COALESCE(material_wait_minutes,0) = 0
    ORDER BY shift_date DESC, id DESC LIMIT 500
  `).all();
  const filled = rows.map((row) => {
    const planned = Number(row.planned_minutes) || 0;
    const operating = Number(row.operating_minutes) || 0;
    const suggested = Math.round(Math.max(0, planned - operating) * 100) / 100;
    // 损失列留空：业务必须自己填（空 = 不修改），避免"模板预填 0 被当成真实值"
    return {
      shift_id: row.shift_id, shift_date: row.shift_date, shift_name: row.shift_name,
      planned_minutes: row.planned_minutes, operating_minutes: row.operating_minutes,
      shift_minutes: row.shift_minutes || planned,
      planned_stop_minutes: "",
      fault_minutes: "",
      changeover_minutes: "",
      material_wait_minutes: "",
      idle_minutes: "",
      ideal_cycle_time: row.ideal_cycle_time, total_output: row.total_output, good_output: row.good_output,
      suggested_availability_loss: suggested,
      note: "把 suggested_availability_loss 拆成 fault/changeover/material_wait 三列（合计应等于该值），再把性能损失填到 idle_minutes",
    };
  });
  writeCsv("oee-shifts.csv",
    ["shift_id", "shift_date", "shift_name", "planned_minutes", "operating_minutes", "shift_minutes",
      "planned_stop_minutes", "fault_minutes", "changeover_minutes", "material_wait_minutes", "idle_minutes",
      "ideal_cycle_time", "total_output", "good_output", "suggested_availability_loss", "note"],
    filled);
}

db.close();
console.log("\n下一步：把 CSV 发给业务填写 → node scripts/data-backfill.js --type=xxx --csv=data/backfill/templates/xxx.csv");
