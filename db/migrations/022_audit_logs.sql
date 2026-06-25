-- 022_audit_logs.sql
-- P1-4 审计日志: 关键写操作 (角色权限改、删批、调价、关闭工单等) 落库
-- Author: 三狗子 | Date: 2026-06-25

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 行为人
  user_id INTEGER,
  username TEXT,           -- 冗余: user 删除后仍可查
  role TEXT,               -- 当时的角色
  -- 行为
  action TEXT NOT NULL,    -- 'role.permission.update' / 'material.lot.delete' / 'material.price.update' / 'purchase.close' / 'workorder.close' ...
  resource_type TEXT,      -- 'role' / 'material_lot' / 'material' / 'purchase_order' / 'work_order'
  resource_id TEXT,        -- 资源 ID (字符串, 兼容 part_no 等)
  -- 变更
  before_json TEXT,        -- 变更前快照 (JSON)
  after_json TEXT,         -- 变更后快照 (JSON)
  diff_summary TEXT,       -- 人类可读差异 (如 "permissions: 3 -> 5 项, material:write 新增")
  -- 上下文
  ip TEXT,                 -- req.ip
  user_agent TEXT,
  request_id TEXT,         -- 关联 req_xxx
  status TEXT DEFAULT 'success',  -- 'success' / 'failed'
  error TEXT,              -- 失败原因
  -- 时间
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 索引: 按时间倒序/按用户/按资源
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user       ON audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_resource   ON audit_logs(resource_type, resource_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action     ON audit_logs(action, created_at DESC);

-- 保留 365 天 (老数据清理; 用 cron 触发, 不在这里做)
-- 注释: 因为审计日志体积会增长, 业务层不做 DELETE