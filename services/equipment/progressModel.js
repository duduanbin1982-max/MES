"use strict";
// services/equipment/progressModel.js
// 2026-11-02：项目进度回写模型（修「项目进度不回写」断点）。
//
// 问题：equipment_instances.progress_pct 一直是 0（只有手工编辑才会变），
// 驾驶舱/交付看板看到的进度和车间实际完成情况脱节。
//
// 方案：进度由工序完成情况自动推导，并用触发器回写，避免每个写路径都要记得调一次。
//   · 公式只写一处：视图 v_instance_progress_calc
//   · 回写由 6 个触发器保证：process_nodes / work_orders 的 INSERT/UPDATE/DELETE
//   · JS 侧只提供 recalc 帮助函数（补数与接口用），不重复公式
//
// 口径：
//   weight_i = 工序 estimated_hours（缺失/<=0 时按 1）
//   score_i  = completed 100 / in_progress 50 / 其它 0
//   pct      = round(Σ(weight_i × score_i) / Σ weight_i)
//   若无工序 → 退化为工单完成率（completed / total × 100）
//   若两者都没有 → 0
//
// 变更流程：改公式 -> 提升 registry 里 equipment 的 schemaVersion -> npm run schema:write

const PROGRESS_VIEW = {
  name: "v_instance_progress_calc",
  sql: `
CREATE VIEW v_instance_progress_calc AS
WITH node_stats AS (
  SELECT p.equipment_instance_id AS instance_id,
         COUNT(*) AS nodes_total,
         SUM(CASE WHEN p.status = 'completed' THEN 1 ELSE 0 END)   AS nodes_completed,
         SUM(CASE WHEN p.status = 'in_progress' THEN 1 ELSE 0 END) AS nodes_in_progress,
         SUM(CASE WHEN COALESCE(p.estimated_hours, 0) > 0 THEN p.estimated_hours ELSE 1 END) AS weight_total,
         SUM((CASE WHEN COALESCE(p.estimated_hours, 0) > 0 THEN p.estimated_hours ELSE 1 END) *
             (CASE p.status WHEN 'completed' THEN 100 WHEN 'in_progress' THEN 50 ELSE 0 END)) AS weighted_done
  FROM process_nodes p
  GROUP BY p.equipment_instance_id
),
wo_stats AS (
  SELECT w.equipment_instance_id AS instance_id,
         COUNT(*) AS work_orders_total,
         SUM(CASE WHEN w.status = 'completed' THEN 1 ELSE 0 END) AS work_orders_completed
  FROM work_orders w
  GROUP BY w.equipment_instance_id
)
SELECT ei.id AS instance_id,
       CASE
         WHEN COALESCE(ns.nodes_total, 0) > 0 AND COALESCE(ns.weight_total, 0) > 0
           THEN CAST(ROUND(ns.weighted_done * 1.0 / ns.weight_total) AS INTEGER)
         WHEN COALESCE(ws.work_orders_total, 0) > 0
           THEN CAST(ROUND(ws.work_orders_completed * 100.0 / ws.work_orders_total) AS INTEGER)
         ELSE 0
       END AS pct,
       CASE
         WHEN COALESCE(ns.nodes_total, 0) > 0 AND COALESCE(ns.weight_total, 0) > 0 THEN 'process_nodes'
         WHEN COALESCE(ws.work_orders_total, 0) > 0 THEN 'work_orders'
         ELSE 'none'
       END AS source,
       COALESCE(ns.nodes_total, 0)        AS nodes_total,
       COALESCE(ns.nodes_completed, 0)    AS nodes_completed,
       COALESCE(ns.nodes_in_progress, 0)  AS nodes_in_progress,
       COALESCE(ns.weight_total, 0)       AS weight_total,
       COALESCE(ws.work_orders_total, 0)  AS work_orders_total,
       COALESCE(ws.work_orders_completed, 0) AS work_orders_completed
FROM equipment_instances ei
LEFT JOIN node_stats ns ON ns.instance_id = ei.id
LEFT JOIN wo_stats ws ON ws.instance_id = ei.id
`,
};

/** 触发器里统一用的回写语句：只在进度真的变了时才写（避免 updated_at 无意义抖动） */
function writeBackSql(instanceExpression) {
  return `
  UPDATE equipment_instances
     SET progress_pct = COALESCE((SELECT pct FROM v_instance_progress_calc WHERE instance_id = ${instanceExpression}), 0),
         updated_at = datetime('now')
   WHERE id = ${instanceExpression}
     AND progress_pct IS NOT COALESCE((SELECT pct FROM v_instance_progress_calc WHERE instance_id = ${instanceExpression}), 0)`;
}

/** 工单/工序换了归属实例时，旧实例也要重算 */
function syncPreviousInstanceSql(instanceExpression) {
  return `
  UPDATE equipment_instances
     SET progress_pct = COALESCE((SELECT pct FROM v_instance_progress_calc WHERE instance_id = ${instanceExpression}), 0),
         updated_at = datetime('now')
   WHERE id = ${instanceExpression}
     AND progress_pct IS NOT COALESCE((SELECT pct FROM v_instance_progress_calc WHERE instance_id = ${instanceExpression}), 0)`;
}

function trigger(name, table, event, body) {
  // body 内部语句之间用分号分隔；结尾分号交给外层统一加，避免出现 ";; END" 语法错误
  const normalized = String(body).replace(/;+\s*$/, "");
  return { name, table, sql: `CREATE TRIGGER ${name} AFTER ${event} ON ${table} BEGIN ${normalized}; END` };
}

const PROGRESS_TRIGGERS = [
  trigger("trg_progress_nodes_ai", "process_nodes", "INSERT", writeBackSql("NEW.equipment_instance_id")),
  trigger(
    "trg_progress_nodes_au",
    "process_nodes",
    "UPDATE",
    `${writeBackSql("NEW.equipment_instance_id")};` +
      `\n  UPDATE equipment_instances SET progress_pct = COALESCE((SELECT pct FROM v_instance_progress_calc WHERE instance_id = OLD.equipment_instance_id), 0)` +
      ` WHERE OLD.equipment_instance_id IS NOT NEW.equipment_instance_id AND id = OLD.equipment_instance_id` +
      ` AND progress_pct IS NOT COALESCE((SELECT pct FROM v_instance_progress_calc WHERE instance_id = OLD.equipment_instance_id), 0);`,
  ),
  trigger("trg_progress_nodes_ad", "process_nodes", "DELETE", writeBackSql("OLD.equipment_instance_id")),
  trigger("trg_progress_wo_ai", "work_orders", "INSERT", writeBackSql("NEW.equipment_instance_id")),
  trigger(
    "trg_progress_wo_au",
    "work_orders",
    "UPDATE",
    `${writeBackSql("NEW.equipment_instance_id")};` +
      `\n  UPDATE equipment_instances SET progress_pct = COALESCE((SELECT pct FROM v_instance_progress_calc WHERE instance_id = OLD.equipment_instance_id), 0)` +
      ` WHERE OLD.equipment_instance_id IS NOT NEW.equipment_instance_id AND id = OLD.equipment_instance_id` +
      ` AND progress_pct IS NOT COALESCE((SELECT pct FROM v_instance_progress_calc WHERE instance_id = OLD.equipment_instance_id), 0);`,
  ),
  trigger("trg_progress_wo_ad", "work_orders", "DELETE", writeBackSql("OLD.equipment_instance_id")),
];

function hasTable(db, name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

/**
 * 创建/更新进度视图与触发器（幂等）。
 * SQLite 不支持 CREATE OR REPLACE，所以先 DROP 再重建。
 * 三张依赖表缺一不可（精简测试库会跳过，避免注册期抛错）。
 */
function initInstanceProgressModel(db) {
  if (!hasTable(db, "equipment_instances") || !hasTable(db, "process_nodes") || !hasTable(db, "work_orders")) {
    return false;
  }
  db.exec(`DROP VIEW IF EXISTS ${PROGRESS_VIEW.name}`);
  db.exec(PROGRESS_VIEW.sql);
  for (const item of PROGRESS_TRIGGERS) {
    db.exec(`DROP TRIGGER IF EXISTS ${item.name}`);
    db.exec(item.sql);
  }
  return true;
}

module.exports = {
  initInstanceProgressModel,
  PROGRESS_VIEW,
  PROGRESS_TRIGGERS,
  writeBackSql,
  syncPreviousInstanceSql,
};
