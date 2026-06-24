-- ============================================================
-- 008_process_tree.sql
-- 工艺树 (BOP + BOM 合一)
-- Author: 三狗子 | Date: 2026-06-18
-- ============================================================

-- 工艺节点 (核心)
CREATE TABLE IF NOT EXISTS process_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_instance_id INTEGER NOT NULL,
  parent_id INTEGER,                                   -- 父工艺节点 (树)
  bom_node_id INTEGER,                                 -- 关联 BOM 节点
  operation_name TEXT NOT NULL,                        -- "下料" "焊接" "装配"
  operation_type TEXT NOT NULL DEFAULT 'make',          -- make/buy/assemble/qc/test
  sequence INTEGER NOT NULL DEFAULT 1,
  estimated_hours REAL DEFAULT 0,
  required_workstation_id INTEGER,
  required_skill TEXT,                                 -- welding/machining/qc/assembly
  required_materials TEXT,                             -- JSON 数组 (来自 BOM)
  is_milestone INTEGER DEFAULT 0,
  phase_code TEXT,                                     -- S1-S10
  status TEXT NOT NULL DEFAULT 'pending',              -- pending/ready/in_progress/completed/blocked/skipped
  planned_start TEXT,
  planned_end TEXT,
  actual_start TEXT,
  actual_end TEXT,
  planned_cost REAL DEFAULT 0,
  actual_cost REAL DEFAULT 0,
  auto_unblock INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,                        -- 同级排序
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (equipment_instance_id) REFERENCES equipment_instances(id),
  FOREIGN KEY (parent_id) REFERENCES process_nodes(id),
  FOREIGN KEY (bom_node_id) REFERENCES project_bom(id),
  FOREIGN KEY (required_workstation_id) REFERENCES workstations(id)
);

-- 工序依赖 (跨树关系)
CREATE TABLE IF NOT EXISTS process_dependencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_instance_id INTEGER NOT NULL,
  predecessor_id INTEGER NOT NULL,
  successor_id INTEGER NOT NULL,
  dep_type TEXT NOT NULL DEFAULT 'FS',                  -- FS/SS/FF/SF
  lag_hours REAL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (predecessor_id) REFERENCES process_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (successor_id) REFERENCES process_nodes(id) ON DELETE CASCADE
);

-- 工序执行记录
CREATE TABLE IF NOT EXISTS process_executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  process_node_id INTEGER NOT NULL,
  operator_id INTEGER,
  action TEXT NOT NULL,                                -- start/pause/resume/complete/qc/note
  result TEXT,                                          -- pass/fail/conditional
  hours_worked REAL DEFAULT 0,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  notes TEXT,
  photos TEXT,                                          -- JSON 数组
  FOREIGN KEY (process_node_id) REFERENCES process_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (operator_id) REFERENCES users(id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_pn_instance ON process_nodes(equipment_instance_id);
CREATE INDEX IF NOT EXISTS idx_pn_parent ON process_nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_pn_status ON process_nodes(status);
CREATE INDEX IF NOT EXISTS idx_pn_bom ON process_nodes(bom_node_id);
CREATE INDEX IF NOT EXISTS idx_pd_pred ON process_dependencies(predecessor_id);
CREATE INDEX IF NOT EXISTS idx_pd_succ ON process_dependencies(successor_id);
CREATE INDEX IF NOT EXISTS idx_pe_node ON process_executions(process_node_id);

SELECT '008_process_tree.sql done' as status;
