"use strict";
// 2026-11-11 工单现场计时：从 work_order_operations 的 start/pause/block/complete 事件汇总有效用时。
// 注意：不改写 work_orders.actual_hours（该字段由 /process-hours 报工审批后计算人工成本）。

function parseDbTime(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const iso = raw.includes("T") ? raw : raw.replace(" ", "T");
  const ms = Date.parse(iso.endsWith("Z") ? iso : iso + "Z");
  return Number.isFinite(ms) ? ms : null;
}

function dbTime(ms) {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

function recalcWorkOrderTimer(db, workOrderId, options = {}) {
  const persist = options.persist !== false;
  const discardStaleOpen = options.discardStaleOpen === true;
  const MAX_OPEN_MS = 72 * 60 * 60 * 1000;
  const workOrder = db.prepare("SELECT id, status, actual_start, actual_end FROM work_orders WHERE id = ?").get(workOrderId);
  if (!workOrder) return null;
  const operations = db.prepare(`
    SELECT action, timestamp
      FROM work_order_operations
     WHERE work_order_id = ?
       AND action IN ('start', 'resume', 'pause', 'block', 'complete')
     ORDER BY timestamp, id
  `).all(workOrderId);

  let openAt = null;
  let totalMs = 0;
  for (const operation of operations) {
    const at = parseDbTime(operation.timestamp);
    if (at == null) continue;
    if (operation.action === "start" || operation.action === "resume") {
      if (openAt == null) openAt = at;
    } else if (operation.action === "pause" || operation.action === "block" || operation.action === "complete") {
      if (openAt != null) {
        if (at >= openAt) {
          const segment = at - openAt;
          // 历史未结束的计时超过 72h：视为异常 stale，不在补暂停/完成时把几个月全算进去。
          if (!(discardStaleOpen && segment > MAX_OPEN_MS)) totalMs += segment;
        }
        openAt = null;
      }
    }
  }

  // 兼容老数据：有 actual_start、但没有任何 start 事件时按 actual_start 起算。
  if (openAt == null && operations.length === 0 && workOrder.actual_start && workOrder.status === "in_progress") {
    openAt = parseDbTime(workOrder.actual_start);
  }

  const terminal = ["completed", "closed", "cancelled"].includes(workOrder.status);
  const openAge = openAt != null ? Math.max(0, Date.now() - openAt) : 0;
  const stale = !terminal && openAt != null && openAge > MAX_OPEN_MS;
  const running = openAt != null && !terminal && !stale && workOrder.status !== "paused" && workOrder.status !== "blocked";
  const currentMs = running ? openAge : 0;
  const seconds = Math.max(0, Math.round((totalMs + currentMs) / 1000));
  const timerStatus = terminal ? "stopped" : (stale ? "stale" : (running ? "running" : (openAt != null ? "paused" : (workOrder.status === "paused" || workOrder.status === "blocked" ? "paused" : "stopped"))));

  if (persist) {
    db.prepare(`UPDATE work_orders
                   SET actual_duration_seconds = ?, actual_duration_hours = ?, timer_status = ?, updated_at = datetime('now')
                 WHERE id = ?`).run(seconds, Math.round((seconds / 3600) * 100) / 100, timerStatus, workOrderId);
  }
  return {
    actual_duration_seconds: seconds,
    actual_duration_hours: Math.round((seconds / 3600) * 100) / 100,
    timer_status: timerStatus,
    timer_started_at: openAt != null && !stale ? dbTime(openAt) : null,
  };
}

function ensureTimerColumns(db) {
  for (const definition of [
    "actual_duration_seconds INTEGER DEFAULT 0",
    "actual_duration_hours REAL DEFAULT 0",
    "timer_status TEXT DEFAULT 'stopped'",
  ]) {
    try { db.prepare("ALTER TABLE work_orders ADD COLUMN " + definition).run(); } catch (_error) { /* exists */ }
  }
}

module.exports = { recalcWorkOrderTimer, ensureTimerColumns, parseDbTime };
