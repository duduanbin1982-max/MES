"use strict";
// routes/roles.js
// 角色管理 (admin only) + 审计
//   GET    /api/roles
//   GET    /api/roles/:code
//   POST   /api/roles
//   PATCH  /api/roles/:code
//   DELETE /api/roles/:code
//   PUT    /api/roles/:code/permissions

const { requirePermission, getRolePermissions, loadRolePermissions } = require('../middleware/auth');
const { ApiError } = require('../app/errors');
const audit = require('../app/audit');


// 中文名称 snake_case 编码映射
const NAME_CODE_MAP = {
  "管理员": "admin", "车间主任": "foreman", "工程师": "engineer", "工人": "worker",
  "质检员": "qc", "焊工": "welder", "销售": "sales", "仓库员": "warehouse",
  "计划员": "planner", "仓库主管": "warehouse_supervisor", "生产主管": "production_supervisor",
  "采购员": "purchaser", "项目经理": "project_manager", "调试工程师": "commissioning_engineer",
  "设备管理员": "equipment_admin", "安全员": "safety_officer", "无损检测员": "ndt_inspector",
  "装配工": "assembly_worker", "机加工": "machinist", "财务": "finance",
  "生产部": "production", "仓储部": "warehouse", "质量部": "quality",
  "工艺工程部": "engineering", "采购部": "purchase", "财务部": "finance",
  "综合管理部": "admin", "项目管理部": "project", "技术部": "technology",
  "调试部": "commissioning", "焊接车间": "welding", "机加车间": "machining",
  "生产调度": "production_scheduler", "维修工": "maintenance", "电工": "electrician",
  "检验员": "inspector", "工艺员": "process_engineer", "车间调度": "shop_scheduler",
  "库管": "storekeeper", "采购主管": "purchase_supervisor", "质量主管": "quality_supervisor",
};

function suggestCode(name) {
  const trimmed = String(name).trim();
  if (!trimmed) return "";
  if (NAME_CODE_MAP[trimmed]) return NAME_CODE_MAP[trimmed];
  return trimmed.replace(/[^a-zA-Z0-9_\u4e00-\u9fff]/g, "_").replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase().replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 32) || "role";
}

const ROLE_CODE_RE = /^[a-z][a-z0-9_:-]{1,31}$/;
const BUILTIN_ROLES = new Set(['admin', 'foreman', 'engineer', 'worker', 'qc', 'welder', 'sales', 'warehouse']);

function parsePermissions(text) {
  try {
    const value = JSON.parse(text || '[]');
    return Array.isArray(value) ? value.map(String) : [];
  } catch (_e) {
    return [];
  }
}

function normalizePermissions(permissions) {
  if (!Array.isArray(permissions)) return [];
  return [...new Set(permissions.map(String).filter(Boolean))].sort();
}


function rowToRole(row, includeCached = true) {
  const permissions = includeCached ? getRolePermissions(row.role_code) : parsePermissions(row.permissions);
  return {
    id: row.id,
    role_code: row.role_code,
    role_name: row.role_name,
    code: row.role_code,
    name: row.role_name,
    permissions,
    description: row.description,
    user_count: row.user_count || 0,
    is_builtin: BUILTIN_ROLES.has(row.role_code) ? 1 : 0,
  };
}

function validateRoleInput(body, { partial = false } = {}) {
  const errors = [];
  const hasRoleCode = Object.prototype.hasOwnProperty.call(body, 'role_code');
  const hasRoleName = Object.prototype.hasOwnProperty.call(body, 'role_name');
  const roleCode = body.role_code != null ? String(body.role_code).trim() : '';
  const roleName = body.role_name != null ? String(body.role_name).trim() : '';
  if (!partial || hasRoleCode) {
    if (!roleCode) errors.push('role_code 必填');
    else if (!ROLE_CODE_RE.test(roleCode)) errors.push('role_code 必须以小写字母开头，只能包含小写字母/数字/_/-/:，长度 2-32');
  }
  if (!partial || hasRoleName) {
    if (!roleName) errors.push('role_name 必填');
    else if (roleName.length > 50) errors.push('role_name 最多 50 字');
  }
  if (body.description != null && String(body.description).length > 200) errors.push('description 最多 200 字');
  if (body.permissions != null && (!Array.isArray(body.permissions) || !body.permissions.every((p) => typeof p === 'string'))) {
    errors.push('permissions 必须是字符串数组');
  }
  if (errors.length) throw ApiError.validation(errors.join('; '), { errors });
  return { roleCode, roleName };
}

function register(app, db) {
  const { get, all, run } = require('./_helpers')(db);
  // 角色/角色组编码自动建议
  app.get("/api/roles/suggest-code", requirePermission("user:admin"), (req, res) => {
    const name = (req.query.name || "").trim();
    if (!name) return res.json({ code: "" });
    const code = suggestCode(name);
    let finalCode = code;
    let suffix = 1;
    while (get("SELECT id FROM roles WHERE role_code = ?", finalCode)) {
      finalCode = code + "_" + (++suffix);
    }
    res.json({ code: finalCode, original: code, conflict: finalCode !== code });
  });

  app.get("/api/role-groups/suggest-code", requirePermission("user:admin"), (req, res) => {
    const name = (req.query.name || "").trim();
    if (!name) return res.json({ code: "" });
    const code = suggestCode(name);
    let finalCode = code;
    let suffix = 1;
    while (get("SELECT id FROM role_groups WHERE group_code = ?", finalCode)) {
      finalCode = code + "_" + (++suffix);
    }
    res.json({ code: finalCode, original: code, conflict: finalCode !== code });
  });


  // 列出所有角色
  app.get('/api/roles', requirePermission('user:read'), (req, res) => {
    const rows = all(`
      SELECT r.id, r.role_code, r.role_name, r.permissions, r.description, COUNT(u.id) AS user_count
      FROM roles r
      LEFT JOIN users u ON u.role_code = r.role_code
      GROUP BY r.id
      ORDER BY r.id
    `);
    res.json(rows.map((row) => rowToRole(row)));
  });

  // 单角色详情
  app.get('/api/roles/:code', requirePermission('user:read'), (req, res, next) => {
    const row = get(`
      SELECT r.id, r.role_code, r.role_name, r.permissions, r.description, COUNT(u.id) AS user_count
      FROM roles r
      LEFT JOIN users u ON u.role_code = r.role_code
      WHERE r.role_code = ?
      GROUP BY r.id
    `, req.params.code);
    if (!row) return next(ApiError.notFound('角色不存在: ' + req.params.code));
    res.json(rowToRole(row));
  });

  // 新增角色: 可直接给 permissions，也可 copy_from 复制已有角色权限
  app.post('/api/roles', requirePermission('user:admin'), (req, res, next) => {
    try {
      const body = req.body || {};
      const { roleCode, roleName } = validateRoleInput(body);
      const exists = get('SELECT id FROM roles WHERE role_code = ?', roleCode);
      if (exists) return next(ApiError.conflict('role_code 已存在: ' + roleCode));

      let permissions = normalizePermissions(body.permissions || []);
      if (body.copy_from) {
        const source = get('SELECT permissions FROM roles WHERE role_code = ?', String(body.copy_from));
        if (!source) return next(ApiError.validation('copy_from 角色不存在: ' + body.copy_from));
        permissions = normalizePermissions(parsePermissions(source.permissions));
      }

      const result = run(
        'INSERT INTO roles (role_code, role_name, permissions, description) VALUES (?, ?, ?, ?)',
        [roleCode, roleName, JSON.stringify(permissions), body.description || null],
      );
      loadRolePermissions(db);

      audit.record(db, req, {
        action: 'role.create',
        resource_type: 'role',
        resource_id: roleCode,
        after: { id: result.lastInsertRowid, role_code: roleCode, role_name: roleName, permissions, description: body.description || null },
        diff_summary: `创建角色 ${roleCode} (${permissions.length} 项权限)`,
      });

      res.status(201).json({ id: result.lastInsertRowid, role_code: roleCode, role_name: roleName, code: roleCode, name: roleName, permissions, created: true });
    } catch (e) { next(e); }
  });

  // 编辑角色基础信息。角色编码不允许改，避免历史用户/审计断链。
  app.patch('/api/roles/:code', requirePermission('user:admin'), (req, res, next) => {
    try {
      const before = get('SELECT id, role_code, role_name, permissions, description FROM roles WHERE role_code = ?', req.params.code);
      if (!before) return next(ApiError.notFound('角色不存在: ' + req.params.code));
      const body = req.body || {};
      validateRoleInput({ role_name: body.role_name, description: body.description }, { partial: true });

      const sets = [];
      const params = [];
      if (body.role_name !== undefined) { sets.push('role_name = ?'); params.push(String(body.role_name).trim()); }
      if (body.description !== undefined) { sets.push('description = ?'); params.push(body.description ? String(body.description) : null); }
      if (!sets.length) return next(ApiError.validation('无可更新字段'));
      params.push(req.params.code);
      run('UPDATE roles SET ' + sets.join(', ') + ' WHERE role_code = ?', params);
      loadRolePermissions(db);

      const after = get('SELECT id, role_code, role_name, permissions, description FROM roles WHERE role_code = ?', req.params.code);
      audit.record(db, req, {
        action: 'role.update',
        resource_type: 'role',
        resource_id: req.params.code,
        before,
        after,
        diff_summary: `更新角色 ${req.params.code}`,
      });
      res.json(rowToRole({ ...after, user_count: 0 }));
    } catch (e) { next(e); }
  });

  // 删除角色: 禁止删除 admin 和已被用户/角色组使用的角色。
  app.delete('/api/roles/:code', requirePermission('user:admin'), (req, res, next) => {
    try {
      const role = get('SELECT id, role_code, role_name, permissions, description FROM roles WHERE role_code = ?', req.params.code);
      if (!role) return next(ApiError.notFound('角色不存在: ' + req.params.code));
      if (role.role_code === 'admin') return next(ApiError.validation('admin 角色不能删除'));
      const userCount = get('SELECT COUNT(*) AS c FROM users WHERE role_code = ?', role.role_code).c;
      if (userCount > 0) return next(ApiError.conflict(`角色正在被 ${userCount} 个用户使用，不能删除`));
      const groupCount = get('SELECT COUNT(*) AS c FROM role_groups WHERE default_role_code = ?', role.role_code).c;
      if (groupCount > 0) return next(ApiError.conflict(`角色正在被 ${groupCount} 个角色组作为默认角色，不能删除`));
      run('DELETE FROM roles WHERE role_code = ?', role.role_code);
      loadRolePermissions(db);
      audit.record(db, req, {
        action: 'role.delete',
        resource_type: 'role',
        resource_id: role.role_code,
        before: role,
        diff_summary: `删除角色 ${role.role_code}`,
      });
      res.json({ ok: true, deleted: true, role_code: role.role_code });
    } catch (e) { next(e); }
  });

  // 改 permissions (P1-4 写 audit: before/after 权限对比)
  app.put('/api/roles/:code/permissions', requirePermission('user:admin'), (req, res, next) => {
    try {
      const { permissions } = req.body || {};
      if (!Array.isArray(permissions)) return next(ApiError.validation('permissions 必须是数组'));
      if (!permissions.every(p => typeof p === 'string')) return next(ApiError.validation('permissions 项必须为字符串'));
      const before = get('SELECT id, role_code, role_name, permissions, description FROM roles WHERE role_code = ?', req.params.code);
      if (!before) return next(ApiError.notFound('角色不存在: ' + req.params.code));
      const beforePerms = parsePermissions(before.permissions);
      const normalized = normalizePermissions(permissions);

      run('UPDATE roles SET permissions = ? WHERE id = ?', [JSON.stringify(normalized), before.id]);
      loadRolePermissions(db);

      // P1-4 写审计
      const added = normalized.filter(p => !beforePerms.includes(p));
      const removed = beforePerms.filter(p => !normalized.includes(p));
      const diff = `permissions ${beforePerms.length} -> ${normalized.length} 项` +
        (added.length ? `, +${added.join(',+')}` : '') +
        (removed.length ? `, -${removed.join(',-')}` : '');
      audit.record(db, req, {
        action: 'role.permission.update',
        resource_type: 'role',
        resource_id: req.params.code,
        before: { permissions: beforePerms },
        after: { permissions: normalized },
        diff_summary: diff,
      });

      res.json({ role_code: req.params.code, code: req.params.code, permissions: normalized, updated: true });
    } catch (e) { next(e); }
  });
}

module.exports = { register };
