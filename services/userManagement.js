"use strict";
const { ApiError } = require('../app/errors');
const { wrap } = require('../middleware/asyncHandler');
const { PERMISSIONS } = require('../app/permissions');
const { loadRolePermissions } = require('../app/rolePermissions');
const audit = require('../app/audit');
// services/userManagement.js
// 用户/角色/角色组管理 service

let db = null;
function setDb(d) { db = d; }

function ensureSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS role_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_code TEXT UNIQUE NOT NULL,
      group_name TEXT NOT NULL,
      default_role_code TEXT,
      data_scope TEXT DEFAULT 'all',
      scope_config TEXT DEFAULT '{}',
      default_home TEXT,
      description TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
  const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!cols.includes("role_group_id")) db.exec("ALTER TABLE users ADD COLUMN role_group_id INTEGER");
  // P1-1（2026-10-18）：用户级数据范围覆盖（为空则继承角色组）
  if (!cols.includes("data_scope")) db.exec("ALTER TABLE users ADD COLUMN data_scope TEXT");
  if (!cols.includes("data_scope_config")) db.exec("ALTER TABLE users ADD COLUMN data_scope_config TEXT");
  // 2026-11-06（用户管理审计）：token 版本号，禁用/改角色/改密码/权限变更后 +1 使旧 token 失效
  if (!cols.includes("token_version")) db.exec("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0");
  const seed = [
    ['production', '生产部', 'foreman', 'workshop', '{}', '/delivery', '生产计划、排程、派工与现场执行'],
    ['warehouse', '仓储部', 'warehouse', 'warehouse', '{}', '/shopfloor?tab=pick', '库存、齐套、领料、退料'],
    ['quality', '质量部', 'qc', 'all', '{}', '/quality', '来料、过程、终检、NCR/CAPA'],
    ['engineering', '工艺工程部', 'engineer', 'all', '{}', '/process-tree', 'BOM、图纸、工艺路线、ECO'],
    ['purchase', '采购部', 'planner', 'all', '{}', '/purchase', '供应商、采购跟催、外协协同'],
  ];
  const insert = db.prepare(`
    INSERT INTO role_groups (group_code, group_name, default_role_code, data_scope, scope_config, default_home, description)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(group_code) DO NOTHING
  `);
  for (const row of seed) insert.run(row);
}

function parseJson(text, fallback) {
  try { return JSON.parse(text || ''); } catch (_e) { return fallback; }
}

function normalizePermissions(permissions) {
  if (!Array.isArray(permissions)) return [];
  return [...new Set(permissions.map(String))].sort();
}

function listRoles() {
  return db.prepare('SELECT id, role_code, role_name, description, permissions FROM roles ORDER BY id').all().map(r => ({
    id: r.id,
    code: r.role_code,
    name: r.role_name,
    description: r.description,
    permissions: parseJson(r.permissions, []),
  }));
}

function getRoleByCode(code) {
  const r = db.prepare('SELECT id, role_code, role_name, description, permissions FROM roles WHERE role_code = ?').get(code);
  if (!r) return null;
  return { id: r.id, code: r.role_code, name: r.role_name, description: r.description, permissions: parseJson(r.permissions, []) };
}

function hasPermission(roleCode, permCode) {
  const r = getRoleByCode(roleCode);
  if (!r) return false;
  return r.permissions.some(p => p === '*' || p === permCode || (p.endsWith(':*') && permCode.startsWith(p.slice(0, -1))));
}

function listRoleGroups() {
  return db.prepare(`
    SELECT rg.*,
           r.role_name AS default_role_name,
           COUNT(u.id) AS user_count
    FROM role_groups rg
    LEFT JOIN roles r ON r.role_code = rg.default_role_code
    LEFT JOIN users u ON u.role_group_id = rg.id
    GROUP BY rg.id
    ORDER BY rg.id
  `).all().map(row => ({ ...row, scope_config: parseJson(row.scope_config, {}) }));
}

// P1-1 修复（2026-10-18）：角色组 PATCH 的参数规范化。
//   坑：el-switch 传的是布尔 true/false，better-sqlite3 只接受 number/string/bigint/buffer/null，
//   直接把 boolean 绑进 SQL 会抛 TypeError → 前端只看到"服务内部错误"。
//   同时把 scope_config 统一成 JSON 字符串（对象/字符串都接受）。
function normalizeRoleGroupPatch(body) {
  const allowed = ["group_name", "default_role_code", "data_scope", "default_home", "description", "is_active"];
  const sets = [];
  const params = [];
  for (const key of allowed) {
    if (body[key] === undefined) continue;
    if (key === "is_active") { sets.push("is_active = ?"); params.push(body[key] ? 1 : 0); continue; }
    if (key === "data_scope") {
      const scope = body[key] ? String(body[key]) : "all";
      if (!require("../app/dataScope").SCOPES.includes(scope)) {
        const error = new Error("data_scope 非法: " + scope);
        error.status = 400;
        throw error;
      }
      sets.push("data_scope = ?"); params.push(scope);
      continue;
    }
    sets.push(key + " = ?"); params.push(body[key]);
  }
  if (body.scope_config !== undefined) {
    const raw = body.scope_config;
    let serialized = "{}";
    if (raw && typeof raw === "object") serialized = JSON.stringify(raw);
    else if (typeof raw === "string" && raw.trim()) {
      try { JSON.parse(raw); } catch (_e) {
        const error = new Error("scope_config 不是合法 JSON");
        error.status = 400;
        throw error;
      }
      serialized = raw.trim();
    }
    sets.push("scope_config = ?"); params.push(serialized);
  }
  return { sets, params };
}

function listUsers() {
  return db.prepare(`
    SELECT u.id, u.username, u.full_name, u.role_id, u.role_code, u.role_group_id, u.is_active, u.phone,
           u.created_at, u.last_login, r.role_name, rg.group_name, rg.group_code, rg.data_scope, rg.default_home,
           u.data_scope AS data_scope_override, u.data_scope_config AS data_scope_config_override,
           COALESCE(u.data_scope, rg.data_scope, 'all') AS effective_data_scope
    FROM users u
    LEFT JOIN roles r ON u.role_id = r.id
    LEFT JOIN role_groups rg ON u.role_group_id = rg.id
    ORDER BY u.id
  `).all();
}

function getUser(id) {
  return db.prepare(`
    SELECT u.id, u.username, u.full_name, u.role_id, u.role_code, u.role_group_id, u.is_active, u.phone,
           u.created_at, u.last_login, r.role_name, rg.group_name, rg.group_code, rg.data_scope, rg.default_home,
           u.data_scope AS data_scope_override, u.data_scope_config AS data_scope_config_override,
           COALESCE(u.data_scope, rg.data_scope, 'all') AS effective_data_scope
    FROM users u
    LEFT JOIN roles r ON u.role_id = r.id
    LEFT JOIN role_groups rg ON u.role_group_id = rg.id
    WHERE u.id = ?
  `).get(id);
}

const bcrypt = require('bcryptjs');

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash: _hash, ...rest } = user;
  return rest;
}

function searchUsers(options = {}) {
  const where = [];
  const params = [];
  const keyword = options.q != null ? String(options.q).trim() : '';
  if (keyword) {
    where.push("(u.username LIKE ? OR u.full_name LIKE ? OR IFNULL(u.phone, '') LIKE ?)");
    const like = '%' + keyword + '%';
    params.push(like, like, like);
  }
  if (options.role_code) { where.push('u.role_code = ?'); params.push(String(options.role_code)); }
  if (options.is_active !== undefined && options.is_active !== '' && options.is_active !== null) {
    where.push('u.is_active = ?');
    params.push(options.is_active === true || options.is_active === 'true' || options.is_active === '1' || options.is_active === 1 ? 1 : 0);
  }
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const total = db.prepare('SELECT COUNT(*) AS c FROM users u' + whereSql).get(...params).c;
  const page = Math.max(1, parseInt(options.page, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(options.page_size, 10) || 50));
  const items = db.prepare(`
    SELECT u.id, u.username, u.full_name, u.role_id, u.role_code, u.role_group_id, u.is_active, u.phone,
           u.created_at, u.last_login, r.role_name, rg.group_name, rg.group_code, rg.data_scope, rg.default_home,
           u.data_scope AS data_scope_override, u.data_scope_config AS data_scope_config_override,
           COALESCE(u.data_scope, rg.data_scope, 'all') AS effective_data_scope
    FROM users u
    LEFT JOIN roles r ON u.role_id = r.id
    LEFT JOIN role_groups rg ON u.role_group_id = rg.id
    ${whereSql}
    ORDER BY u.id
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, (page - 1) * pageSize);
  return { items, total, page, page_size: pageSize };
}

function countActiveAdmins(excludeId = null) {
  return db.prepare("SELECT COUNT(*) AS c FROM users WHERE role_code = 'admin' AND is_active = 1" + (excludeId ? ' AND id <> ?' : '')).get(...(excludeId ? [excludeId] : [])).c;
}

function countUserReferences(userId) {
  const checks = [
    ['work_orders', 'assigned_to'],
    ['process_executions', 'operator_id'],
    ['work_report_details', 'worker_id'],
  ];
  const result = {};
  for (const [table, column] of checks) {
    try {
      result[table] = db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE ${column} = ?`).get(userId).c;
    } catch (_error) { result[table] = 0; }
  }
  return result;
}

function createUser({ username, password, full_name, role_code, role_group_id, phone, is_active, data_scope, data_scope_config }) {
  const name = String(username == null ? '' : username).trim();
  const displayName = String(full_name == null ? '' : full_name).trim();
  if (!name || !password || !displayName || !role_code) return { ok: false, error: 'username, password, full_name, role_code 必填' };
  if (!USERNAME_RE.test(name)) return { ok: false, error: 'username 只允许 3-32 位字母/数字/下划线/点/中划线' };
  if (String(password).length < 8) return { ok: false, error: '密码长度至少 8 位' };
  if (String(password).length > 128) return { ok: false, error: '密码长度不能超过 128 位' };
  if (displayName.length > 64) return { ok: false, error: 'full_name 不能超过 64 字' };
  if (phone && String(phone).length > 32) return { ok: false, error: 'phone 不能超过 32 字' };
  const exist = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(name);
  if (exist) return { ok: false, error: 'username 已存在' };
  const role = getRoleByCode(role_code);
  if (!role) return { ok: false, error: 'role_code 不存在: ' + role_code };
  if (role_group_id) {
    const group = db.prepare('SELECT id FROM role_groups WHERE id = ?').get(role_group_id);
    if (!group) return { ok: false, error: 'role_group_id 不存在: ' + role_group_id };
  }
  const hash = bcrypt.hashSync(password, 10);
  const scope = data_scope ? String(data_scope) : null;
  if (scope && !require('../app/dataScope').SCOPES.includes(scope)) return { ok: false, error: 'data_scope 非法: ' + scope };
  const r = db.prepare(`
    INSERT INTO users (username, password_hash, full_name, role_id, role_code, role_group_id, phone, is_active, data_scope, data_scope_config)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(username, hash, full_name, role.id, role_code, role_group_id || null, phone || null,
    is_active == null ? 1 : (is_active ? 1 : 0), scope,
    data_scope_config ? JSON.stringify(data_scope_config) : null);
  return { ok: true, id: r.lastInsertRowid };
}

function updateUser(id, { password, full_name, role_code, role_group_id, phone, is_active, data_scope, data_scope_config }) {
  const u = getUser(id);
  if (!u) return { ok: false, error: 'user not found' };
  if (password !== undefined && password !== null && password !== '') {
    if (String(password).length < 8) return { ok: false, error: '密码长度至少 8 位' };
    if (String(password).length > 128) return { ok: false, error: '密码长度不能超过 128 位' };
  }
  if (full_name !== undefined && String(full_name).trim().length > 64) return { ok: false, error: 'full_name 不能超过 64 字' };
  const fields = [];
  const params = [];
  let tokenSensitive = false;
  if (password) { fields.push('password_hash = ?'); params.push(bcrypt.hashSync(password, 10)); tokenSensitive = true; }
  if (full_name !== undefined) { fields.push('full_name = ?'); params.push(String(full_name).trim()); }
  if (phone !== undefined) { fields.push('phone = ?'); params.push(phone); }
  if (is_active !== undefined) {
    fields.push('is_active = ?'); params.push(is_active ? 1 : 0);
    if (Boolean(is_active) !== Boolean(u.is_active)) tokenSensitive = true;
  }
  if (role_group_id !== undefined) {
    if (role_group_id) {
      const group = db.prepare('SELECT id FROM role_groups WHERE id = ?').get(role_group_id);
      if (!group) return { ok: false, error: 'role_group_id 不存在: ' + role_group_id };
    }
    fields.push('role_group_id = ?'); params.push(role_group_id || null);
  }
  if (role_code !== undefined) {
    const role = getRoleByCode(role_code);
    if (!role) return { ok: false, error: 'role_code 不存在: ' + role_code };
    fields.push('role_id = ?'); params.push(role.id);
    fields.push('role_code = ?'); params.push(role_code);
    if (role_code !== u.role_code) tokenSensitive = true;
  }
  // P1-1：用户级数据范围覆盖（传 null 表示恢复"继承角色组"）
  if (data_scope !== undefined) {
    const scope = data_scope ? String(data_scope) : null;
    if (scope && !require('../app/dataScope').SCOPES.includes(scope)) return { ok: false, error: 'data_scope 非法: ' + scope };
    fields.push('data_scope = ?'); params.push(scope);
  }
  if (data_scope_config !== undefined) {
    fields.push('data_scope_config = ?');
    params.push(data_scope_config ? JSON.stringify(data_scope_config) : null);
  }
  if (fields.length === 0) return { ok: true, changed: 0 };
  params.push(id);
  const r = db.prepare('UPDATE users SET ' + fields.join(', ') + ' WHERE id = ?').run(...params);
  if (tokenSensitive) {
    db.prepare('UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE id = ?').run(id);
  }
  return { ok: true, changed: r.changes, token_bumped: tokenSensitive };
}

function setRolePermissions(roleId, permissions) {
  const role = db.prepare('SELECT id FROM roles WHERE id = ?').get(roleId);
  if (!role) return { ok: false, error: 'role not found' };
  const arr = normalizePermissions(permissions);
  db.prepare('UPDATE roles SET permissions = ? WHERE id = ?').run(JSON.stringify(arr), roleId);
  // 2026-11-06（用户管理审计）：权限矩阵变化后强制该角色用户重新登录
  try {
    db.prepare('UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE role_id = ?').run(roleId);
  } catch (_error) { /* 测试库/旧库没有 users.token_version 时跳过 */ }
  // 2026-10-10 (静态分析 v1 #5): 写完必须刷新内存权限缓存，
  // 否则新签发的 token 会一直带着旧权限，直到服务重启。
  loadRolePermissions(db);
  return { ok: true, count: arr.length };
}

function permissionCatalog() {
  const modules = {};
  for (const [code, description] of Object.entries(PERMISSIONS)) {
    const [resource, action = 'custom'] = code.split(':');
    if (!modules[resource]) modules[resource] = { resource, label: resource, permissions: [] };
    modules[resource].permissions.push({ code, action, description });
  }
  modules.admin = modules.admin || { resource: 'admin', label: '超级权限', permissions: [] };
  modules.admin.permissions.push({ code: '*', action: 'all', description: '超级管理员所有权限' });
  return Object.values(modules);
}

function register(app, _db) {
  setDb(_db);
  ensureSchema();

  app.get('/api/permissions/catalog', wrap((req, res) => {
    res.json({ items: permissionCatalog() });
  }));

  app.get('/api/role-groups', wrap((req, res) => {
    res.json({ items: listRoleGroups() });
  }));

  app.post('/api/role-groups', wrap((req, res) => {
    const body = req.body || {};
    if (!body.group_code || !body.group_name) throw ApiError.validation('group_code / group_name 必填');
    const r = db.prepare(`
      INSERT INTO role_groups (group_code, group_name, default_role_code, data_scope, scope_config, default_home, description, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      body.group_code, body.group_name, body.default_role_code || null, body.data_scope || 'all',
      JSON.stringify(body.scope_config || {}), body.default_home || null, body.description || null,
      body.is_active == null ? 1 : (body.is_active ? 1 : 0),
    );
    res.json({ id: r.lastInsertRowid });
  }));

  app.patch('/api/role-groups/:id', wrap((req, res) => {
    const exists = db.prepare('SELECT id FROM role_groups WHERE id = ?').get(req.params.id);
    if (!exists) throw ApiError.notFound('role group not found');
    const { sets, params } = normalizeRoleGroupPatch(req.body || {});
    if (!sets.length) throw ApiError.validation('无可更新字段');
    sets.push("updated_at = datetime('now')");
    params.push(req.params.id);
    db.prepare('UPDATE role_groups SET ' + sets.join(', ') + ' WHERE id = ?').run(...params);
    res.json({ ok: true });
  }));

  // Role list/detail/permission routes are owned by routes/roles.js (audit + cache sync).
  // P1-1（2026-10-18）：当前登录用户的生效数据范围（前端提示 / 排障用）
  app.get('/api/me/scope', wrap((req, res) => {
    const { loadScope, describe } = require('../app/dataScope');
    const ctx = (typeof req.scope === 'function') ? req.scope() : loadScope(db, req.user && (req.user.sub || req.user.uid));
    res.json(describe(ctx));
  }));

  app.get('/api/users', wrap((req, res) => {
    res.json(searchUsers(req.query || {}));
  }));

  app.get('/api/users/:id', wrap((req, res) => {
    const u = getUser(parseInt(req.params.id, 10));
    if (!u) throw ApiError.notFound('user not found');
    res.json(u);
  }));

  app.post('/api/users', wrap((req, res) => {
    const r = createUser(req.body || {});
    if (!r.ok) throw ApiError.validation(r.error);
    const created = getUser(r.id);
    audit.record(db, req, {
      action: 'user.create',
      resource_type: 'user',
      resource_id: r.id,
      after: sanitizeUser(created),
      diff_summary: `创建用户 ${created.username}（角色 ${created.role_code}）`,
    });
    res.json({ ok: true, id: r.id });
  }));

  app.patch('/api/users/:id', wrap((req, res) => {
    const id = parseInt(req.params.id, 10);
    const isSelf = req.user && (req.user.uid === id || req.user.sub === id);
    const body = req.body || {};
    if (req.user.role !== 'admin' && !isSelf) throw ApiError.forbidden('只能修改自己的资料');
    if (req.user.role !== 'admin') {
      // 自助改密：必须校验原密码（否则 token 泄露即可直接改密接管账号）
      if (!body.password) throw ApiError.validation('只能修改密码');
      if (!body.old_password) throw ApiError.validation('修改密码需要提供原密码 old_password');
      const current = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(id);
      if (!current || !current.password_hash || !bcrypt.compareSync(String(body.old_password), current.password_hash)) {
        throw ApiError.validation('原密码不正确');
      }
      const r = updateUser(id, { password: body.password });
      if (!r.ok) throw ApiError.validation(r.error);
      audit.record(db, req, {
        action: 'user.password.change',
        resource_type: 'user',
        resource_id: id,
        diff_summary: '用户自助修改密码（已校验原密码）',
      });
      return res.json({ ok: true, changed: r.changed });
    }
    const before = getUser(id);
    if (!before) throw ApiError.notFound('user not found');
    if (isSelf && (body.is_active === false || body.is_active === 0)) throw ApiError.validation('不能禁用当前登录账号');
    if (body.role_code !== undefined && body.role_code !== before.role_code && before.role_code === 'admin' && countActiveAdmins(id) === 0) {
      throw ApiError.validation('不能移除最后一个启用状态的管理员');
    }
    if ((body.is_active === false || body.is_active === 0) && before.role_code === 'admin' && countActiveAdmins(id) === 0) {
      throw ApiError.validation('不能禁用最后一个启用状态的管理员');
    }
    const r = updateUser(id, body);
    if (!r.ok) throw ApiError.validation(r.error);
    const after = getUser(id);
    audit.record(db, req, {
      action: 'user.update',
      resource_type: 'user',
      resource_id: id,
      before: sanitizeUser(before),
      after: sanitizeUser(after),
      diff_summary: `更新用户 ${after.username}${r.token_bumped ? '（已强制重新登录）' : ''}`,
    });
    res.json({ ok: true, changed: r.changed, token_bumped: Boolean(r.token_bumped) });
  }));

  app.delete('/api/users/:id', wrap((req, res) => {
    const id = parseInt(req.params.id, 10);
    if (req.user && req.user.role !== 'admin') throw ApiError.forbidden('only admin');
    if (req.user && (req.user.uid === id || req.user.sub === id)) throw ApiError.validation('不能删除当前登录账号');
    const target = getUser(id);
    if (!target) throw ApiError.notFound('user not found');
    if (target.role_code === 'admin' && countActiveAdmins(id) === 0) throw ApiError.validation('不能删除最后一个启用状态的管理员');
    const refs = countUserReferences(id);
    const refTotal = Object.values(refs).reduce((sum, value) => sum + value, 0);
    if (refTotal > 0) {
      throw ApiError.conflict(`该用户存在关联业务记录（工单 ${refs.work_orders} / 工序执行 ${refs.process_executions} / 报工 ${refs.work_report_details}），不能删除；请改为禁用`);
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    audit.record(db, req, {
      action: 'user.delete',
      resource_type: 'user',
      resource_id: id,
      before: sanitizeUser(target),
      diff_summary: `删除用户 ${target.username}`,
    });
    res.json({ ok: true });
  }));
}

module.exports = { register, setDb, listRoles, getRoleByCode, hasPermission, listUsers, searchUsers, sanitizeUser, getUser, createUser, updateUser, setRolePermissions, countActiveAdmins, countUserReferences, normalizeRoleGroupPatch };
