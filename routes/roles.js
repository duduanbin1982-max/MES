"use strict";
// routes/roles.js
// 角色管理 (admin only) + 审计
//   GET    /api/roles               - 列出所有角色 + permissions
//   GET    /api/roles/:code         - 单角色详情
//   PUT    /api/roles/:code/permissions  - 改角色 permissions (同步 ROLE_PERMS_CACHE, 写 audit)
// Author: 三狗子 | Date: 2026-06-25

const { requirePermission, getRolePermissions, loadRolePermissions } = require('../middleware/auth');
const { ApiError } = require('../app/errors');
const audit = require('../app/audit');

function register(app, db) {
  const { get, all, run } = require('./_helpers')(db);

  // 列出所有角色
  app.get('/api/roles', requirePermission('user:read'), (req, res) => {
    const rows = all('SELECT id, role_code, role_name, permissions, description FROM roles ORDER BY id');
    const list = rows.map(r => ({
      ...r,
      permissions: getRolePermissions(r.role_code),
    }));
    res.json(list);
  });

  // 单角色详情
  app.get('/api/roles/:code', requirePermission('user:read'), (req, res, next) => {
    const row = get('SELECT id, role_code, role_name, permissions, description FROM roles WHERE role_code = ?', req.params.code);
    if (!row) return next(ApiError.notFound('角色不存在: ' + req.params.code));
    row.permissions = getRolePermissions(row.role_code);
    res.json(row);
  });

  // 改 permissions (P1-4 写 audit: before/after 权限对比)
  app.put('/api/roles/:code/permissions', requirePermission('user:admin'), (req, res, next) => {
    try {
      const { permissions } = req.body || {};
      if (!Array.isArray(permissions)) return next(ApiError.validation('permissions 必须是数组'));
      if (!permissions.every(p => typeof p === 'string')) return next(ApiError.validation('permissions 项必须为字符串'));
      const before = get('SELECT id, permissions FROM roles WHERE role_code = ?', req.params.code);
      if (!before) return next(ApiError.notFound('角色不存在: ' + req.params.code));
      let beforePerms = [];
      try { beforePerms = JSON.parse(before.permissions || '[]'); } catch (_) { beforePerms = []; }

      run('UPDATE roles SET permissions = ? WHERE id = ?', [JSON.stringify(permissions), before.id]);
      loadRolePermissions(db);

      // P1-4 写审计
      const added = permissions.filter(p => !beforePerms.includes(p));
      const removed = beforePerms.filter(p => !permissions.includes(p));
      const diff = `permissions ${beforePerms.length} -> ${permissions.length} 项` +
        (added.length ? `, +${added.join(',+')}` : '') +
        (removed.length ? `, -${removed.join(',-')}` : '');
      audit.record(db, req, {
        action: 'role.permission.update',
        resource_type: 'role',
        resource_id: req.params.code,
        before: { permissions: beforePerms },
        after: { permissions },
        diff_summary: diff,
      });

      res.json({ role_code: req.params.code, permissions, updated: true });
    } catch (e) { next(e); }
  });
}

module.exports = { register };