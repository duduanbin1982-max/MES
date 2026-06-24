'use strict';
// services/userManagement.js
// 用户/角色管理 service
// 适配已有 schema: roles(id, role_code, role_name, permissions, description)
// permissions 字段是 JSON 数组（兼容 'project:*' / '*' / 'project:read'）

let db = null;
function setDb(d) { db = d; }

function listRoles() {
  return db.prepare('SELECT id, role_code, role_name, description, permissions FROM roles ORDER BY id').all().map(r => {
    let perms = [];
    try { perms = JSON.parse(r.permissions || '[]'); } catch (_e) { perms = []; }
    return { id: r.id, code: r.role_code, name: r.role_name, description: r.description, permissions: perms };
  });
}

function getRoleByCode(code) {
  const r = db.prepare('SELECT id, role_code, role_name, description, permissions FROM roles WHERE role_code = ?').get(code);
  if (!r) return null;
  let perms = [];
  try { perms = JSON.parse(r.permissions || '[]'); } catch (_e) { perms = []; }
  return { id: r.id, code: r.role_code, name: r.role_name, description: r.description, permissions: perms };
}

// 权限检查: 用户的 permissions 数组里有匹配码即通过
// 支持: 'project:read' / 'project:*' / '*' (admin)
function hasPermission(roleCode, permCode) {
  const r = getRoleByCode(roleCode);
  if (!r) return false;
  return r.permissions.some(p => p === '*' || p === permCode || (p.endsWith(':*') && permCode.startsWith(p.slice(0, -1))));
}

function listUsers() {
  return db.prepare('SELECT u.id, u.username, u.full_name, u.role_id, u.role_code, u.is_active, u.phone, u.created_at, u.last_login, r.role_name FROM users u LEFT JOIN roles r ON u.role_id = r.id ORDER BY u.id').all();
}

function getUser(id) {
  return db.prepare('SELECT u.id, u.username, u.full_name, u.role_id, u.role_code, u.is_active, u.phone, u.created_at, u.last_login, r.role_name FROM users u LEFT JOIN roles r ON u.role_id = r.id WHERE u.id = ?').get(id);
}

const bcrypt = require('bcryptjs');

function createUser({ username, password, full_name, role_code, phone, is_active }) {
  if (!username || !password || !full_name || !role_code) {
    return { ok: false, error: 'username, password, full_name, role_code 必填' };
  }
  const exist = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exist) return { ok: false, error: 'username 已存在' };
  const role = getRoleByCode(role_code);
  if (!role) return { ok: false, error: 'role_code 不存在: ' + role_code };
  const hash = bcrypt.hashSync(password, 10);
  const r = db.prepare('INSERT INTO users (username, password_hash, full_name, role_id, role_code, phone, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    username, hash, full_name, role.id, role_code, phone || null, is_active == null ? 1 : (is_active ? 1 : 0)
  );
  return { ok: true, id: r.lastInsertRowid };
}

function updateUser(id, { password, full_name, role_code, phone, is_active }) {
  const u = getUser(id);
  if (!u) return { ok: false, error: 'user not found' };
  const fields = [];
  const params = [];
  if (password) { fields.push('password_hash = ?'); params.push(bcrypt.hashSync(password, 10)); }
  if (full_name !== undefined) { fields.push('full_name = ?'); params.push(full_name); }
  if (phone !== undefined) { fields.push('phone = ?'); params.push(phone); }
  if (is_active !== undefined) { fields.push('is_active = ?'); params.push(is_active ? 1 : 0); }
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
  const role = db.prepare('SELECT id, is_system FROM roles WHERE id = ?').get(roleId);
  if (!role) return { ok: false, error: 'role not found' };
  if (!Array.isArray(permissions)) return { ok: false, error: 'permissions 必须是数组' };
  // 唯一性 + 排序
  const arr = [...new Set(permissions.map(String))].sort();
  const json = JSON.stringify(arr);
  db.prepare('UPDATE roles SET permissions = ? WHERE id = ?').run(json, roleId);
  return { ok: true, count: arr.length };
}

function register(app, _db) {
  setDb(_db);
  const wrap = (h) => (req, res) => { try { h(req, res); } catch (e) { console.error(e); res.status(500).json({ error: e.message }); } };

  app.get('/api/roles', wrap((req, res) => {
    res.json({ items: listRoles() });
  }));

  app.get('/api/roles/:code', wrap((req, res) => {
    const r = getRoleByCode(req.params.code);
    if (!r) return res.status(404).json({ error: 'role not found' });
    res.json(r);
  }));

  // 改角色权限 (admin only)
  app.put('/api/roles/:id/permissions', wrap((req, res) => {
    const perms = req.body && req.body.permissions;
    const r = setRolePermissions(parseInt(req.params.id, 10), perms);
    if (!r.ok) return res.status(400).json(r);
    res.json(r);
  }));

  // 列出用户 (admin)
  app.get('/api/users', wrap((req, res) => {
    res.json({ items: listUsers() });
  }));

  // 查单个用户
  app.get('/api/users/:id', wrap((req, res) => {
    const u = getUser(parseInt(req.params.id, 10));
    if (!u) return res.status(404).json({ error: 'user not found' });
    res.json(u);
  }));

  // 新建用户 (admin)
  app.post('/api/users', wrap((req, res) => {
    const r = createUser(req.body || {});
    if (!r.ok) return res.status(400).json(r);
    res.json(r);
  }));

  // 改用户 (admin, 可改自己的密码)
  app.patch('/api/users/:id', wrap((req, res) => {
    const id = parseInt(req.params.id, 10);
    const isSelf = req.user && req.user.uid === id;
    const body = req.body || {};
    // 非 admin 只能改自己密码
    if (req.user.role !== 'admin' && !isSelf) {
      return res.status(403).json({ error: '只能修改自己的资料' });
    }
    if (req.user.role !== 'admin') {
      // 非 admin 限制：只能改 password
      const allowed = { password: body.password };
      const r = updateUser(id, allowed);
      if (!r.ok) return res.status(400).json(r);
      return res.json(r);
    }
    const r = updateUser(id, body);
    if (!r.ok) return res.status(400).json(r);
    res.json(r);
  }));
}

module.exports = { register, setDb, listRoles, getRoleByCode, hasPermission, listUsers, getUser, createUser, updateUser, setRolePermissions };
