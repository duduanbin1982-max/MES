-- 2026-11-11 工单现场计时：start/pause/block/complete 事件自动汇总有效用时
-- @ensure-column work_orders actual_duration_seconds INTEGER DEFAULT 0
-- @ensure-column work_orders actual_duration_hours REAL DEFAULT 0
-- @ensure-column work_orders timer_status TEXT DEFAULT 'stopped'
CREATE INDEX IF NOT EXISTS idx_wo_ops_timer ON work_order_operations(work_order_id, action, timestamp);
