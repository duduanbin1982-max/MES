"use strict";
// scripts/migrate-bom-integrity.js
// 2026-11-07（BOM 审计）：
//   · 一个项目装备只允许一个 0 级根节点：多余根节点挂到保留根节点下（作为 1 级部件）
//   · 悬空/跨实例 parent_id 重新挂到本实例根节点
//   · 重算 tier/level_code/sort_order
// 用法：
//   node scripts/migrate-bom-integrity.js --verify
//   node scripts/migrate-bom-integrity.js --apply
const Database = require("better-sqlite3");
const path = require("node:path");

const FLAG_DB = process.argv.indexOf("--db");
const DB_PATH = FLAG_DB > -1 && process.argv[FLAG_DB + 1] ? path.resolve(process.argv[FLAG_DB + 1]) : path.resolve(__dirname, "..", "data", "mes.db");

function plan(db) {
  const rows = db.prepare("SELECT id, equipment_instance_id, parent_id, tier FROM instance_bom ORDER BY id").all();
  const instances = new Set(db.prepare("SELECT id FROM equipment_instances").all().map((row) => Number(row.id)));
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  const byInstance = new Map();
  for (const row of rows) {
    const key = Number(row.equipment_instance_id);
    if (!byInstance.has(key)) byInstance.set(key, []);
    byInstance.get(key).push(row);
  }
  const orphanRows = rows.filter((row) => !instances.has(Number(row.equipment_instance_id)));
  const actions = [];
  const reports = [];
  for (const [instanceId, list] of byInstance) {
    if (!instances.has(instanceId)) continue;
    const roots = list.filter((row) => row.parent_id === null || row.parent_id === undefined || Number(row.parent_id) === 0);
    const keepRoot = roots.length ? roots.slice().sort((a, b) => Number(a.id) - Number(b.id))[0] : null;
    if (roots.length > 1) {
      reports.push({ instance_id: instanceId, issue: "multiple_roots", roots: roots.map((row) => row.id), keep: keepRoot.id });
      for (const root of roots) {
        if (root.id === keepRoot.id) continue;
        actions.push({ id: root.id, from_parent: null, to_parent: keepRoot.id, reason: "extra_root" });
      }
    }
    for (const row of list) {
      if (row.parent_id === null || row.parent_id === undefined) continue;
      const parent = byId.get(Number(row.parent_id));
      const sameInstance = parent && Number(parent.equipment_instance_id) === instanceId;
      if (!sameInstance) {
        reports.push({ instance_id: instanceId, issue: "dangling_parent", node: row.id, parent_id: row.parent_id });
        if (keepRoot) actions.push({ id: row.id, from_parent: row.parent_id, to_parent: keepRoot.id, reason: "dangling_parent" });
      }
    }
  }
  return { rows: rows.length, orphanRows, actions, reports };
}

function apply(db, planData) {
  const update = db.prepare("UPDATE instance_bom SET parent_id = ?, updated_at = datetime('now') WHERE id = ?");
  const tx = db.transaction(() => {
    for (const action of planData.actions) update.run(action.to_parent, action.id);
  });
  tx();
  const { recomputeStructureMetadata } = require("../services/bom/service/mutations");
  const instanceIds = [...new Set(planData.actions.map((action) => {
    const row = db.prepare("SELECT equipment_instance_id FROM instance_bom WHERE id = ?").get(action.id);
    return row ? Number(row.equipment_instance_id) : null;
  }).filter(Boolean))];
  for (const instanceId of instanceIds) recomputeStructureMetadata(db, instanceId);
  return planData.actions.length;
}

function main() {
  const applyMode = process.argv.includes("--apply");
  const db = new Database(DB_PATH);
  try {
    const planData = plan(db);
    console.log(`[bom-integrity] 数据库: ${DB_PATH}`);
    console.log(`BOM 行数: ${planData.rows}，悬浮实例 BOM: ${planData.orphanRows.length} 行`);
    console.log(`需修复: ${planData.actions.length} 项`);
    for (const report of planData.reports.slice(0, 20)) console.log("  -", JSON.stringify(report));
    if (applyMode) {
      const changed = apply(db, planData);
      console.log(`✅ 已修复 ${changed} 项并重算层级`);
    } else {
      console.log("（未执行，加 --apply 生效）");
    }
  } finally { db.close(); }
}

module.exports = { plan, apply };
if (require.main === module) main();
