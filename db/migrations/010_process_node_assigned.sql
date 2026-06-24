-- ============================================================
-- 010_process_node_assigned.sql
-- 加 assigned_to (工人) + planned_start/end (计划时间)
-- Author: 三狗子 | Date: 2026-06-19
-- ============================================================

ALTER TABLE process_nodes ADD COLUMN assigned_to INTEGER REFERENCES users(id);

SELECT '010 done' as status;
