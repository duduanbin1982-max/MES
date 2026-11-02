"use strict";
// services/equipment/progress.js
// 2026-11-02：项目进度读取与补数（公式在 progressModel.js 的视图里，这里不重复实现）

const { initInstanceProgressModel } = require("./progressModel");

function ensureModel(db) {
  // 老库/精简库里模型可能还没建（例如只跑了部分迁移），补数前先确保存在
  return initInstanceProgressModel(db);
}

function instanceProgress(db, instanceId) {
  try {
    return db.prepare("SELECT * FROM v_instance_progress_calc WHERE instance_id = ?").get(instanceId) || null;
  } catch (_error) {
    return null;
  }
}

function formatDetail(calc) {
  if (!calc) return null;
  return {
    source: calc.source,
    nodes_total: Number(calc.nodes_total || 0),
    nodes_completed: Number(calc.nodes_completed || 0),
    nodes_in_progress: Number(calc.nodes_in_progress || 0),
    weight_total: Number(calc.weight_total || 0),
    work_orders_total: Number(calc.work_orders_total || 0),
    work_orders_completed: Number(calc.work_orders_completed || 0),
  };
}

/**
 * 重算单个实例进度并回写。
 * 返回 { found, id, pct, previous, changed, source, detail }
 */
function recalcInstanceProgress(db, instanceId) {
  const id = Number(instanceId);
  const instance = db.prepare("SELECT id, progress_pct FROM equipment_instances WHERE id = ?").get(id);
  if (!instance) return { found: false, id };
  const calc = instanceProgress(db, id);
  if (!calc) return { found: true, id, pct: null, previous: instance.progress_pct, changed: false, source: "unavailable", detail: null };
  const pct = Number(calc.pct) || 0;
  const previous = instance.progress_pct == null ? null : Number(instance.progress_pct);
  const changed = previous !== pct;
  if (changed) {
    db.prepare("UPDATE equipment_instances SET progress_pct = ?, updated_at = datetime('now') WHERE id = ?").run(pct, id);
  }
  return { found: true, id, pct, previous, changed, source: calc.source, detail: formatDetail(calc) };
}

/** 全量重算（上线补数 / 巡检用），只写有变化的实例 */
function recalcAllInstances(db) {
  ensureModel(db);
  const rows = db.prepare("SELECT id FROM equipment_instances ORDER BY id").all();
  const items = [];
  let changed = 0;
  for (const row of rows) {
    const result = recalcInstanceProgress(db, row.id);
    if (result.changed) changed += 1;
    items.push(result);
  }
  return {
    total: items.length,
    changed,
    as_of: new Date().toISOString(),
    items,
  };
}

module.exports = { recalcInstanceProgress, recalcAllInstances, instanceProgress, ensureModel };
