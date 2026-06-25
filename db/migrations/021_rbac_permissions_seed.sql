-- 021_rbac_permissions_seed.sql
-- P0-1 RBAC 权限种子
--   业务里 DEFAULT_ROLE_PERMISSIONS 已有定义 (app/permissions.js)
--   启动时如果 roles.permissions 为 NULL, 用默认种子填充
--   这里只做"占位"提示, 真实填充由 server.js loadRolePermissions 兜底
--   本迁移: 给所有 NULL permissions 角色加 [] + 注释, 避免 NULL JSON parse 报错
-- Author: 三狗子 | Date: 2026-06-25

UPDATE roles SET permissions = '[]' WHERE permissions IS NULL OR permissions = '';

-- 记录 8 个核心 permission 体系 (说明, 实际值在 app/permissions.js)
-- 资源: action 规则
-- material:read / write / admin
-- purchase:read / write / admin
-- equipment:read / write / admin
-- work_order:read / write / admin
-- process:read / write / admin
-- quality:read / write
-- report:read
-- user:read / admin
-- settings:read / write
-- audit:read
