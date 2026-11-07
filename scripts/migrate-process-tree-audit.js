"use strict";
// scripts/migrate-process-tree-audit.js
// 2026-11-07 工艺树审计数据修复（幂等）：
//   1) 清理跨实例 BOM 引用（process_nodes.bom_node_id 指向别的装备实例）
//   2) 按工序名称回填模板配置（模板 id、QC/SOP/图纸要求、定员、岗位、技能）
//   3) 为已有估算工时但缺 standard_hours 的节点补 process_standard_hours
// 用法：node scripts/migrate-process-tree-audit.js [--apply]
const path = require("node:path");
const Database = require("better-sqlite3");

const DB_PATH = path.resolve(__dirname, "..", "data", "mes.db");
const apply = process.argv.includes("--apply");

function tableExists(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function main() {
  const db = new Database(DB_PATH);
  try {
    const report = { cross_bom_cleared: 0, nodes_backfilled: 0, standard_hours_created: 0 };
    const cross = db.prepare(`
      SELECT n.id FROM process_nodes n JOIN instance_bom b ON b.id = n.bom_node_id
       WHERE n.bom_node_id IS NOT NULL AND n.equipment_instance_id <> b.equipment_instance_id
    `).all();
    if (apply && cross.length) {
      const clear = db.prepare("UPDATE process_nodes SET bom_node_id = NULL, updated_at = datetime('now') WHERE id = ?");
      const tx = db.transaction((rows) => rows.forEach((row) => clear.run(row.id)));
      tx(cross);
    }
    report.cross_bom_cleared = cross.length;

    if (tableExists(db, "process_operation_templates")) {
      const templates = db.prepare("SELECT * FROM process_operation_templates WHERE is_active = 1").all();
      const byName = new Map(templates.map((tpl) => [tpl.operation_name, tpl]));
      const candidates = db.prepare(`
        SELECT id, operation_name, operation_template_id, qc_required, sop_required, drawing_required,
               worker_count, required_position_code, required_skill
          FROM process_nodes
      `).all();
      const update = db.prepare(`
        UPDATE process_nodes SET operation_template_id = ?, qc_required = ?, sop_required = ?, drawing_required = ?,
          worker_count = ?, required_position_code = COALESCE(NULLIF(required_position_code, ''), ?),
          required_skill = COALESCE(NULLIF(required_skill, ''), ?), updated_at = datetime('now')
        WHERE id = ?
      `);
      const rows = candidates.filter((node) => {
        const tpl = byName.get(node.operation_name);
        if (!tpl) return false;
        return !node.operation_template_id
          || Number(node.qc_required) !== Number(tpl.qc_required)
          || Number(node.sop_required) !== Number(tpl.sop_required)
          || Number(node.drawing_required || 0) !== Number(tpl.drawing_required || 0);
      });
      if (apply && rows.length) {
        const tx = db.transaction(() => {
          for (const node of rows) {
            const tpl = byName.get(node.operation_name);
            update.run(
              tpl.id,
              Number(tpl.qc_required) ? 1 : 0,
              Number(tpl.sop_required) ? 1 : 0,
              Number(tpl.drawing_required) ? 1 : 0,
              Number(tpl.worker_count) || Number(node.worker_count) || 1,
              tpl.required_position_code || null,
              tpl.required_skill || null,
              node.id,
            );
          }
        });
        tx();
      }
      report.nodes_backfilled = rows.length;
    }

    if (tableExists(db, "process_standard_hours")) {
      const missing = db.prepare(`
        SELECT n.id, n.operation_type, n.estimated_hours, n.worker_count
          FROM process_nodes n
          LEFT JOIN process_standard_hours h ON h.process_node_id = n.id
         WHERE h.id IS NULL AND n.estimated_hours > 0
      `).all();
      if (apply && missing.length) {
        const insert = db.prepare(`
          INSERT INTO process_standard_hours (process_node_id, work_type, standard_hours, worker_count, unit, description)
          VALUES (?, ?, ?, ?, 'h', ?)
        `);
        const tx = db.transaction(() => {
          for (const node of missing) {
            insert.run(node.id, node.operation_type || "make", node.estimated_hours, node.worker_count || 1, "历史数据回填");
          }
        });
        tx();
      }
      report.standard_hours_created = missing.length;
    }

    console.log(JSON.stringify({ apply, ...report }, null, 2));
    if (!apply) console.log("（未执行，加 --apply 生效）");
  } finally {
    db.close();
  }
}

if (require.main === module) main();
module.exports = { main };
