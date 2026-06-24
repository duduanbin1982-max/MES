-- 013_settings_and_rbac.sql (修订 v2 — 适配已有 roles/system_settings 表)
-- 现状:
--   - system_settings 已被 013 初版创建好（10 条预填齐了）
--   - roles 表已存在（用 role_code/role_name/permissions JSON 旧设计）
--   - role_permissions 表已存在（旧版用，未启用）
--   - users.role_code 列缺失
-- 本次只补 users.role_code 并同步

ALTER TABLE users ADD COLUMN role_code TEXT DEFAULT NULL;
UPDATE users SET role_code = CASE role_id
  WHEN 1 THEN 'admin' WHEN 2 THEN 'foreman' WHEN 3 THEN 'engineer'
  WHEN 4 THEN 'worker' WHEN 5 THEN 'qc'      WHEN 6 THEN 'welder'
  WHEN 7 THEN 'sales'
  ELSE NULL END;
CREATE INDEX IF NOT EXISTS idx_users_role_code ON users(role_code);

SELECT '013 v2 done' as status;
