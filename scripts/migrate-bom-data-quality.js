"use strict";
// scripts/migrate-bom-data-quality.js
// 2026-11-07（BOM 审计 B-8 数据质量）：
//   · 历史 BOM 补齐 category/node_type/material_grade/surface_treatment/brand/单价/图号/工时费
//   · 单价优先取物料主数据 estimated_unit_price / actual_unit_price，其次 0
//   · 补齐行追加 notes 标记，便于追溯
// 用法：
//   node scripts/migrate-bom-data-quality.js --verify
//   node scripts/migrate-bom-data-quality.js --apply [--instance=1]
const Database = require("better-sqlite3");
const path = require("node:path");
const { inferNodeType } = require("../services/bom/service/mutations/_tree");

const FLAG_DB = process.argv.indexOf("--db");
const DB_PATH = FLAG_DB > -1 && process.argv[FLAG_DB + 1] ? path.resolve(process.argv[FLAG_DB + 1]) : path.resolve(__dirname, "..", "data", "mes.db");
const INSTANCE_ARG = process.argv.find((arg) => arg.startsWith("--instance="));
const ONLY_INSTANCE = INSTANCE_ARG ? Number(INSTANCE_ARG.split("=")[1]) : null;
const MARK = "[数据补齐 2026-11-07]";

const SELF_MADE = new Set(["自制部件", "自制机加件", "自制钣金件", "自制焊接件", "自制装配件", "成品"]);
const PURCHASED = new Set(["外购成品", "外购件", "标准紧固件", "气动元件", "电气元件", "外协件", "原材料", "辅助材料"]);

function inferCategory(row, material) {
  if (row.category) return row.category;
  if (Number(row.tier) === 0) return "成品";
  if (material) {
    if (Number(material.is_self_made) === 1) return Number(row.tier) === 1 ? "自制部件" : "自制机加件";
    return "外购成品";
  }
  const nodeType = row.node_type || inferNodeType({ ...row, tier: row.tier, category: row.category });
  const map = {
    equipment: "成品", system: "自制部件", assembly: "自制部件", self_made: "自制机加件",
    purchased: "外购成品", standard: "标准紧固件", raw_material: "原材料", consumable: "辅助材料",
    virtual: "虚拟件", component: "外购成品",
  };
  return map[nodeType] || (Number(row.tier) <= 1 ? "自制部件" : "外购成品");
}

function ensureColumns(db) {
  const cols = new Set(db.prepare("PRAGMA table_info(instance_bom)").all().map((column) => column.name));
  if (!cols.has("labor_cost")) db.exec("ALTER TABLE instance_bom ADD COLUMN labor_cost REAL DEFAULT 0");
  if (!cols.has("manufacturing_cost")) db.exec("ALTER TABLE instance_bom ADD COLUMN manufacturing_cost REAL DEFAULT 0");
}

function plan(db) {
  ensureColumns(db);
  const rows = db.prepare("SELECT * FROM instance_bom").all();
  const materials = new Map(db.prepare("SELECT id, material_code, is_self_made, estimated_unit_price, actual_unit_price FROM materials").all().map((row) => [Number(row.id), row]));
  const actions = [];
  const fields = { category: 0, node_type: 0, material_grade: 0, surface_treatment: 0, brand_recommend: 0, unit_price: 0, part_number: 0, labor_cost: 0, manufacturing_cost: 0 };
  for (const row of rows) {
    if (ONLY_INSTANCE && Number(row.equipment_instance_id) !== ONLY_INSTANCE) continue;
    const material = row.material_id ? materials.get(Number(row.material_id)) : null;
    const category = inferCategory(row, material);
    const selfMade = SELF_MADE.has(category);
    const purchased = PURCHASED.has(category);
    const updates = {};
    if (!row.category) updates.category = category;
    if (!row.node_type) updates.node_type = inferNodeType({ ...row, tier: row.tier, category });
    if (selfMade && !row.material_grade) updates.material_grade = "Q235B";
    if (selfMade && !row.surface_treatment) updates.surface_treatment = "无";
    if (purchased && !row.brand_recommend) updates.brand_recommend = "待定";
    if (purchased && !row.brand_grade) updates.brand_grade = "B";
    if (row.unit_price === null || row.unit_price === undefined) {
      updates.unit_price = material ? Number(material.estimated_unit_price || material.actual_unit_price || 0) : 0;
    }
    if (!row.material_id && !row.part_number) updates.part_number = material ? material.material_code : `LEGACY-${row.id}`;
    if (row.labor_cost === null || row.labor_cost === undefined) updates.labor_cost = 0;
    if (row.manufacturing_cost === null || row.manufacturing_cost === undefined) updates.manufacturing_cost = 0;
    if (!Object.keys(updates).length) continue;
    for (const key of Object.keys(updates)) fields[key] = (fields[key] || 0) + 1;
    const notes = row.notes && String(row.notes).includes(MARK) ? row.notes : `${row.notes ? row.notes + " " : ""}${MARK}`;
    actions.push({ id: row.id, equipment_instance_id: row.equipment_instance_id, updates: { ...updates, notes } });
  }
  return { checked: rows.length, actions, fields };
}

function apply(db, planData) {
  const tx = db.transaction(() => {
    for (const action of planData.actions) {
      const keys = Object.keys(action.updates);
      db.prepare(`UPDATE instance_bom SET ${keys.map((key) => key + " = ?").join(", ")}, updated_at = datetime('now') WHERE id = ?`)
        .run(...keys.map((key) => action.updates[key]), action.id);
    }
  });
  tx();
  const { recomputeStructureMetadata } = require("../services/bom/service/mutations");
  const instances = [...new Set(planData.actions.map((action) => Number(action.equipment_instance_id)))];
  for (const instanceId of instances) recomputeStructureMetadata(db, instanceId);
  return planData.actions.length;
}

function main() {
  const applyMode = process.argv.includes("--apply");
  const db = new Database(DB_PATH);
  try {
    const planData = plan(db);
    console.log(`[bom-data-quality] 检查 ${planData.checked} 行，需补齐 ${planData.actions.length} 行`);
    console.log("字段补齐统计:", planData.fields);
    if (applyMode) {
      const changed = apply(db, planData);
      const { validateTree } = require("../services/bomService");
      console.log(`✅ 已补齐 ${changed} 行`);
      for (const instanceId of [1, 2, 3, 4, 5]) {
        const rows = db.prepare("SELECT * FROM instance_bom WHERE equipment_instance_id = ?").all(instanceId);
        if (!rows.length) continue;
        const validation = validateTree(db, instanceId, rows);
        console.log(`  实例 ${instanceId}: errors=${validation.errors.length}, warnings=${validation.warnings.length}`);
      }
    } else {
      console.log("（未执行，加 --apply 生效）");
    }
  } finally { db.close(); }
}

module.exports = { plan, apply };
if (require.main === module) main();
