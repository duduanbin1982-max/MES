"use strict";
const { ApiError } = require('../app/errors');
const { wrap } = require('../middleware/asyncHandler');
const { PERMISSIONS } = require('../app/permissions');
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

function listUsers() {
  return db.prepare(`
    SELECT u.id, u.username, u.full_name, u.role_id, u.role_code, u.role_group_id, u.is_active, u.phone,
           u.created_at, u.last_login, r.role_name, rg.group_name, rg.group_code, rg.data_scope, rg.default_home
    FROM users u
    LEFT JOIN roles r ON u.role_id = r.id
    LEFT JOIN role_groups rg ON u.role_group_id = rg.id
    ORDER BY u.id
  `).all();
}

function getUser(id) {
  return db.prepare(`
    SELECT u.id, u.username, u.full_name, u.role_id, u.role_code, u.role_group_id, u.is_active, u.phone,
           u.created_at, u.last_login, r.role_name, rg.group_name, rg.group_code, rg.data_scope, rg.default_home
    FROM users u
    LEFT JOIN roles r ON u.role_id = r.id
    LEFT JOIN role_groups rg ON u.role_group_id = rg.id
    WHERE u.id = ?
  `).get(id);
}

const bcrypt = require('bcryptjs');

function createUser({ username, password, full_name, role_code, role_group_id, phone, is_active }) {
  if (!username || !password || !full_name || !role_code) return { ok: false, error: 'username, password, full_name, role_code 必填' };
  const exist = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exist) return { ok: false, error: 'username 已存在' };
  const role = getRoleByCode(role_code);
  if (!role) return { ok: false, error: 'role_code 不存在: ' + role_code };
  if (role_group_id) {
    const group = db.prepare('SELECT id FROM role_groups WHERE id = ?').get(role_group_id);
    if (!group) return { ok: false, error: 'role_group_id 不存在: ' + role_group_id };
  }
  const hash = bcrypt.hashSync(password, 10);
  const r = db.prepare(`
    INSERT INTO users (username, password_hash, full_name, role_id, role_code, role_group_id, phone, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(username, hash, full_name, role.id, role_code, role_group_id || null, phone || null, is_active == null ? 1 : (is_active ? 1 : 0));
  return { ok: true, id: r.lastInsertRowid };
}

function updateUser(id, { password, full_name, role_code, role_group_id, phone, is_active }) {
  const u = getUser(id);
  if (!u) return { ok: false, error: 'user not found' };
  const fields = [];
  const params = [];
  if (password) { fields.push('password_hash = ?'); params.push(bcrypt.hashSync(password, 10)); }
  if (full_name !== undefined) { fields.push('full_name = ?'); params.push(full_name); }
  if (phone !== undefined) { fields.push('phone = ?'); params.push(phone); }
  if (is_active !== undefined) { fields.push('is_active = ?'); params.push(is_active ? 1 : 0); }
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
  }
  if (fields.length === 0) return { ok: true, changed: 0 };
  params.push(id);
  const r = db.prepare('UPDATE users SET ' + fields.join(', ') + ' WHERE id = ?').run(...params);
  return { ok: true, changed: r.changes };
}

function setRolePermissions(roleId, permissions) {
  const role = db.prepare('SELECT id FROM roles WHERE id = ?').get(roleId);
  if (!role) return { ok: false, error: 'role not found' };
  const arr = normalizePermissions(permissions);
  db.prepare('UPDATE roles SET permissions = ? WHERE id = ?').run(JSON.stringify(arr), roleId);
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
    const allowed = ['group_name', 'default_role_code', 'data_scope', 'default_home', 'description', 'is_active'];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) { sets.push(key + ' = ?'); params.push(req.body[key]); }
    }
    if (req.body.scope_config !== undefined) { sets.push('scope_config = ?'); params.push(JSON.stringify(req.body.scope_config || {})); }
    if (!sets.length) throw ApiError.validation('无可更新字段');
    sets.push("updated_at = datetime('now')");
    params.push(req.params.id);
    db.prepare('UPDATE role_groups SET ' + sets.join(', ') + ' WHERE id = ?').run(...params);
    res.json({ ok: true });
  }));

  // Role list/detail/permission routes are owned by routes/roles.js (audit + cache sync).
  app.get('/api/users', wrap((req, res) => {
    res.json({ items: listUsers() });
  }));

  app.get('/api/users/:id', wrap((req, res) => {
    const u = getUser(parseInt(req.params.id, 10));
    if (!u) throw ApiError.notFound('user not found');
    res.json(u);
  }));

  app.post('/api/users', wrap((req, res) => {
    const r = createUser(req.body || {});
    if (!r.ok) return res.status(400).json(r);
    res.json(r);
  }));

  app.patch('/api/users/:id', wrap((req, res) => {
    const id = parseInt(req.params.id, 10);
    const isSelf = req.user && (req.user.uid === id || req.user.sub === id);
    const body = req.body || {};
    if (req.user.role !== 'admin' && !isSelf) throw ApiError.forbidden("只能修改自己的资料");
    if (req.user.role !== 'admin') {
      const r = updateUser(id, { password: body.password });
      if (!r.ok) return res.status(400).json(r);
      return res.json(r);
    }
    const r = updateUser(id, body);
    if (!r.ok) return res.status(400).json(r);
    res.json(r);
  }));

  app.delete('/api/users/:id', wrap((req, res) => {
    const id = parseInt(req.params.id, 10);
    if (req.user && req.user.role !== 'admin') throw ApiError.forbidden('only admin');
    const r = db.prepare('DELETE FROM users WHERE id = ?').run(id);
    if (r.changes === 0) throw ApiError.notFound('user not found');
    res.json({ ok: true });
  }));
}

module.exports = { register, setDb, listRoles, getRoleByCode, hasPermission, listUsers, getUser, createUser, updateUser, setRolePermissions };
