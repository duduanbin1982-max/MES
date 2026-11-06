require('dotenv').config();
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const express = require('express');
const http = require('node:http');

const { loadRolePermissions, getRolePermissions } = require('../middleware/auth');
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
      role_code TEXT
    );
    CREATE TABLE role_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_code TEXT,
      group_name TEXT,
      default_role_code TEXT
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
  database.prepare('INSERT INTO roles (role_code, role_name, permissions, description) VALUES (?, ?, ?, ?)').run('admin', '系统管理员', JSON.stringify(['*']), '内置');
  database.prepare('INSERT INTO roles (role_code, role_name, permissions, description) VALUES (?, ?, ?, ?)').run('worker', '工人', JSON.stringify(['work_order:read', 'work_report:read']), '内置');
  database.prepare('INSERT INTO users (username, role_code) VALUES (?, ?)').run('admin', 'admin');
  database.prepare('INSERT INTO role_groups (group_code, group_name, default_role_code) VALUES (?, ?, ?)').run('prod', '生产部', 'worker');
  loadRolePermissions(database);
  return database;
}

function createServer(database) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { uid: 1, username: 'admin', role: 'admin', permissions: ['*'] };
    req.id = 'req_roles_test';
    next();
  });
  require('../routes/roles').register(app, database);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return http.createServer(app);
}

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test.before(async () => {
  db = freshDb();
  server = createServer(db);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (db) db.close();
});

test('ROLES.1 POST 新建角色成功并刷新权限缓存', async () => {
  const r = await request('POST', '/api/roles', {
    role_code: 'planner',
    role_name: '计划员',
    permissions: ['work_order:read', 'work_report:read'],
    description: '负责排程',
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.role_code, 'planner');
  assert.deepEqual(getRolePermissions('planner'), ['work_order:read', 'work_report:read']);
  const audit = db.prepare('SELECT action, resource_id FROM audit_logs WHERE action = ?').get('role.create');
  assert.equal(audit.resource_id, 'planner');
});

test('ROLES.2 重复 role_code 返回 409', async () => {
  const r = await request('POST', '/api/roles', { role_code: 'planner', role_name: '重复计划员' });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'CONFLICT');
});

test('ROLES.3 非法 role_code 返回 400', async () => {
  const r = await request('POST', '/api/roles', { role_code: 'Bad Role', role_name: '坏编码' });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'VALIDATION_ERROR');
});

test('ROLES.4 copy_from 复制已有角色权限', async () => {
  const r = await request('POST', '/api/roles', { role_code: 'worker_copy', role_name: '工人副本', copy_from: 'worker' });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.permissions, ['work_order:read', 'work_report:read']);
  assert.deepEqual(getRolePermissions('worker_copy'), ['work_order:read', 'work_report:read']);
});

test('ROLES.5 PATCH 修改名称和说明', async () => {
  const r = await request('PATCH', '/api/roles/planner', { role_name: '高级计划员', description: '计划排程与跟催' });
  assert.equal(r.status, 200);
  assert.equal(r.body.role_name, '高级计划员');
  assert.equal(r.body.description, '计划排程与跟催');
});

test('ROLES.6 PATCH role_name 为空返回 400', async () => {
  const r = await request('PATCH', '/api/roles/planner', { role_name: '' });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'VALIDATION_ERROR');
});

test('ROLES.7 删除被用户使用的角色返回 409', async () => {
  const r = await request('DELETE', '/api/roles/admin');
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'VALIDATION_ERROR');
});

test('ROLES.8 删除被角色组使用的角色返回 409', async () => {
  const r = await request('DELETE', '/api/roles/worker');
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'CONFLICT');
});

test('ROLES.9 删除未使用角色成功并清空缓存', async () => {
  const r = await request('DELETE', '/api/roles/worker_copy');
  assert.equal(r.status, 200);
  assert.equal(r.body.deleted, true);
  assert.deepEqual(getRolePermissions('worker_copy'), []);
  const row = db.prepare('SELECT id FROM roles WHERE role_code = ?').get('worker_copy');
  assert.equal(row, undefined);
});

test('ROLES.10 PUT permissions 排序去重并写审计', async () => {
  const r = await request('PUT', '/api/roles/planner/permissions', {
    permissions: ['material:read', 'work_order:read', 'material:read'],
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.permissions, ['material:read', 'work_order:read']);
  assert.deepEqual(getRolePermissions('planner'), ['material:read', 'work_order:read']);
  const audit = db.prepare('SELECT diff_summary FROM audit_logs WHERE action = ? AND resource_id = ? ORDER BY id DESC').get('role.permission.update', 'planner');
  assert.match(audit.diff_summary, /permissions/);
});
