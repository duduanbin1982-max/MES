'use strict';

/**
 * roleGovernance.test.js
 * 2026-11-06 角色与权限模块审计验证：
 *   R-1 admin 必须保留 *；非 admin 禁止 *（防锁死/越权）
 *   R-2 权限码必须来自权限目录（未知码/未知资源拒绝）
 *   R-3 内置角色禁止删除
 *   R-4 角色组编码/默认角色/数据范围/home 校验 + 审计
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const express = require('express');
const http = require('node:http');

const { loadRolePermissions } = require('../middleware/auth');
const { errorHandler, notFoundHandler } = require('../app/errors');

let db;
let server;
let port;

function freshDb() {
  const database = new Database(':memory:');
  database.exec(`
    CREATE TABLE roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role_code TEXT NOT NULL UNIQUE,
      role_name TEXT NOT NULL,
      permissions TEXT,
      description TEXT
    );
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      full_name TEXT,
      role_id INTEGER,
      role_code TEXT,
      is_active INTEGER DEFAULT 1,
      role_group_id INTEGER,
      data_scope TEXT,
      data_scope_config TEXT,
      token_version INTEGER NOT NULL DEFAULT 0,
      phone TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_login TEXT
    );
    CREATE TABLE role_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_code TEXT NOT NULL UNIQUE,
      group_name TEXT NOT NULL,
      default_role_code TEXT,
      data_scope TEXT DEFAULT 'all',
      scope_config TEXT DEFAULT '{}',
      default_home TEXT,
      description TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER, username TEXT, role TEXT,
      action TEXT NOT NULL, resource_type TEXT, resource_id TEXT,
      before_json TEXT, after_json TEXT, diff_summary TEXT,
      ip TEXT, user_agent TEXT, request_id TEXT,
      status TEXT DEFAULT 'success', error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  database.prepare('INSERT INTO roles (role_code, role_name, permissions) VALUES (?,?,?)').run('admin', '管理员', JSON.stringify(['*']));
  database.prepare('INSERT INTO roles (role_code, role_name, permissions) VALUES (?,?,?)').run('foreman', '车间主任', JSON.stringify(['work_order:read']));
  database.prepare('INSERT INTO roles (role_code, role_name, permissions) VALUES (?,?,?)').run('worker', '工人', JSON.stringify(['work_order:read']));
  database.prepare('INSERT INTO users (username, full_name, role_id, role_code) VALUES (?,?,?,?)').run('admin', '管理员', 1, 'admin');
  return database;
}

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1', port, path, method,
      headers: { 'Content-Type': 'application/json', ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) },
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test.before(async () => {
  db = freshDb();
  loadRolePermissions(db);
  const app = express();
  app.use(express.json());
  // 测试用鉴权：注入 admin 用户（roles 路由内部 requirePermission 读 req.user.permissions）
  app.use((req, _res, next) => {
    req.user = { uid: 1, role: 'admin', permissions: ['*'], username: 'admin' };
    next();
  });
  require('../services/userManagement').register(app, db);
  require('../routes/roles').register(app, db);
  app.use(notFoundHandler);
  app.use(errorHandler);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (db) db.close();
});

test('R-2 创建角色：未知权限码 / 未知资源被拒，合法通配通过', async () => {
  let r = await request('POST', '/api/roles', { role_code: 'probe_role', role_name: '探针', permissions: ['evil:code'] });
  assert.equal(r.status, 400);
  assert.match(r.body.message, /未知权限码/);
  r = await request('POST', '/api/roles', { role_code: 'probe_role', role_name: '探针', permissions: ['unknown:*'] });
  assert.equal(r.status, 400);
  assert.match(r.body.message, /未知权限资源/);
  r = await request('POST', '/api/roles', { role_code: 'probe_role', role_name: '探针', permissions: ['work_order:*', 'work_order:read'] });
  assert.equal(r.status, 201);
  const created = db.prepare("SELECT permissions FROM roles WHERE role_code='probe_role'").get();
  assert.deepEqual(JSON.parse(created.permissions), ['work_order:*', 'work_order:read']);
});

test('R-1 非 admin 角色不能拥有 *；admin 必须保留 *', async () => {
  let r = await request('POST', '/api/roles', { role_code: 'fake_admin', role_name: '假管理员', permissions: ['*'] });
  assert.equal(r.status, 400);
  assert.match(r.body.message, /只有内置 admin 角色/);

  r = await request('PUT', '/api/roles/probe_role/permissions', { permissions: ['*'] });
  assert.equal(r.status, 400);

  r = await request('PUT', '/api/roles/admin/permissions', { permissions: ['work_order:read'] });
  assert.equal(r.status, 400);
  assert.match(r.body.message, /必须保留 \* 超级权限/);

  r = await request('PUT', '/api/roles/admin/permissions', { permissions: ['*'] });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(db.prepare("SELECT permissions FROM roles WHERE role_code='admin'").get().permissions), ['*']);
});

test('R-3 内置角色禁止删除，自定义角色可删除', async () => {
  let r = await request('DELETE', '/api/roles/foreman');
  assert.equal(r.status, 409, '被角色组引用的角色应先报引用冲突');
  r = await request('DELETE', '/api/roles/worker');
  assert.equal(r.status, 400);
  assert.match(r.body.message, /内置角色不能删除/);
  r = await request('DELETE', '/api/roles/admin');
  assert.equal(r.status, 400);

  r = await request('DELETE', '/api/roles/probe_role');
  assert.equal(r.status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM roles WHERE role_code='probe_role'").get().c, 0);
});

test('R-4 角色组：编码/默认角色/数据范围/home 校验', async () => {
  let r = await request('POST', '/api/role-groups', { group_code: 'Bad Code', group_name: '脏组', default_role_code: 'nope', data_scope: 'galaxy' });
  assert.equal(r.status, 400);
  const message = r.body.message;
  assert.match(message, /group_code/);
  assert.match(message, /default_role_code 不存在/);
  assert.match(message, /data_scope 非法/);

  r = await request('POST', '/api/role-groups', { group_code: 'audit_group', group_name: '审计组', default_role_code: 'not_exist', data_scope: 'workshop' });
  assert.equal(r.status, 400);

  r = await request('POST', '/api/role-groups', { group_code: 'audit_group', group_name: '审计组', default_role_code: 'foreman', data_scope: 'workshop', default_home: '/shopfloor?tab=pick' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const groupId = r.body.id;
  const auditRow = db.prepare("SELECT action FROM audit_logs WHERE action='role_group.create' AND resource_id=?").get(String(groupId));
  assert.ok(auditRow, '创建角色组应写审计');

  r = await request('PATCH', '/api/role-groups/' + groupId, { default_role_code: 'not_exist' });
  assert.equal(r.status, 400);
  r = await request('PATCH', '/api/role-groups/' + groupId, { default_role_code: 'worker', data_scope: 'all' });
  assert.equal(r.status, 200);
  assert.equal(db.prepare('SELECT default_role_code FROM role_groups WHERE id=?').get(groupId).default_role_code, 'worker');
  assert.ok(db.prepare("SELECT action FROM audit_logs WHERE action='role_group.update' AND resource_id=?").get(String(groupId)), '更新角色组应写审计');
});

test('R-5 权限目录包含新权限且以目录为准', async () => {
  const r = await request('GET', '/api/permissions/catalog');
  assert.equal(r.status, 200);
  const codes = (r.body.items || []).flatMap((group) => group.permissions.map((permission) => permission.code));
  assert.ok(codes.includes('shopfloor:qc'));
  assert.ok(codes.includes('user:admin'));
  assert.ok(codes.includes('*'));
});
