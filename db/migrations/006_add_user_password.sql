-- ============================================================
-- 006_add_user_password.sql
-- 已有 password_hash 列, 加 last_login + 填默认密码 (演示)
-- Author: 三狗子 | Date: 2026-06-18
-- ============================================================

-- last_login 列（如果不存在）
ALTER TABLE users ADD COLUMN last_login TEXT;

-- 给所有现有用户设默认密码 = 用户名（演示用）
UPDATE users SET password_hash = username WHERE password_hash IS NULL OR password_hash = '';

SELECT '006 done' as status;
