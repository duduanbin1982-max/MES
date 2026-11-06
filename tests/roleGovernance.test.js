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
    CREATE TABLE permission_change_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role_code TEXT NOT NULL,
      before_json TEXT NOT NULL,
      after_json TEXT NOT NULL,
      requested_by INTEGER,
      requested_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'pending',
      reviewed_by INTEGER,
      reviewed_at TEXT,
      review_note TEXT
    );
  `);
  database.prepare('INSERT INTO roles (role_code, role_name, permissions) VALUES (?,?,?)').run('admin', '管理员', JSON.stringify(['*']));
  database.prepare('INSERT INTO roles (role_code, role_name, permissions) VALUES (?,?,?)').run('foreman', '车间主任', JSON.stringify(['work_order:read']));
  database.prepare('INSERT INTO roles (role_code, role_name, permissions) VALUES (?,?,?)').run('worker', '工人', JSON.stringify(['work_order:read']));
  database.prepare('INSERT INTO users (username, full_name, role_id, role_code) VALUES (?,?,?,?)').run('admin', '管理员', 1, 'admin');
  return database;
}

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1', port, path, method,
      headers: { 'Content-Type': 'application/json', ...headers, ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) },
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
    req.user = { uid: Number(req.headers['x-test-uid'] || 1), role: 'admin', permissions: ['*'], username: 'admin' };
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

test('R-5 权限目录包含新权限且以目录为准，分组使用中文标签', async () => {
  const r = await request('GET', '/api/permissions/catalog');
  assert.equal(r.status, 200);
  const codes = (r.body.items || []).flatMap((group) => group.permissions.map((permission) => permission.code));
  assert.ok(codes.includes('shopfloor:qc'));
  assert.ok(codes.includes('user:admin'));
  assert.ok(codes.includes('*'));
  const workOrderGroup = (r.body.items || []).find((group) => group.resource === 'work_order');
  assert.equal(workOrderGroup.label, '工单管理', '权限目录分组应为中文标签');
});

test('R-6 角色组删除：无引用可删，有用户归属拒绝（409）', async () => {
  let r = await request('POST', '/api/role-groups', { group_code: 'temp_group', group_name: '临时组', data_scope: 'all' });
  assert.equal(r.status, 200);
  const groupId = r.body.id;
  assert.equal(db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action='role_group.create'").get().c >= 1, true);

  r = await request('DELETE', '/api/role-groups/' + groupId);
  assert.equal(r.status, 200);
  const softDeleted = db.prepare('SELECT deleted_at FROM role_groups WHERE id=?').get(groupId);
  assert.ok(softDeleted && softDeleted.deleted_at, '软删除应记录 deleted_at');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action='role_group.delete'").get().c, 1);
  r = await request('DELETE', '/api/role-groups/' + groupId);
  assert.equal(r.status, 404);

  // 有用户归属的角色组不能删除
  const production = db.prepare("SELECT id FROM role_groups WHERE group_code='production'").get();
  db.prepare('UPDATE users SET role_group_id = ? WHERE id = 1').run(production.id);
  r = await request('DELETE', '/api/role-groups/' + production.id);
  assert.equal(r.status, 409);
  assert.match(r.body.message, /不能删除/);
});

test('R-7 权限矩阵变更双人复核：申请→另一管理员通过/驳回，申请人不能自审', async () => {
  // 增加第二个启用管理员
  db.prepare("INSERT INTO users (username, full_name, role_id, role_code, is_active) VALUES ('admin2', '管理员二', 1, 'admin', 1)").run();
  const admin2 = db.prepare("SELECT id FROM users WHERE username='admin2'").get().id;
  const beforePerms = db.prepare("SELECT permissions FROM roles WHERE role_code='worker'").get().permissions;

  // 1) 申请（uid=1）
  let r = await request('PUT', '/api/roles/worker/permissions', { permissions: ['work_order:read', 'work_report:read'] }, { 'x-test-uid': '1' });
  assert.equal(r.status, 202);
  assert.equal(r.body.pending, true);
  const requestId = r.body.request_id;
  assert.deepEqual(JSON.parse(db.prepare("SELECT permissions FROM roles WHERE role_code='worker'").get().permissions), JSON.parse(beforePerms), '审批前权限不应变化');

  // 2) 待审批列表（uid=2）
  r = await request('GET', '/api/permission-change-requests?status=pending', undefined, { 'x-test-uid': String(admin2) });
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 1);
  assert.equal(r.body.items[0].role_code, 'worker');

  // 3) 申请人自审拒绝
  r = await request('POST', '/api/permission-change-requests/' + requestId + '/approve', {}, { 'x-test-uid': '1' });
  assert.equal(r.status, 400);
  assert.match(r.body.message, /不能审批自己/);

  // 4) 另一管理员通过 → 生效
  r = await request('POST', '/api/permission-change-requests/' + requestId + '/approve', {}, { 'x-test-uid': String(admin2) });
  assert.equal(r.status, 200);
  const after = JSON.parse(db.prepare("SELECT permissions FROM roles WHERE role_code='worker'").get().permissions);
  assert.deepEqual(after, ['work_order:read', 'work_report:read']);
  assert.ok(db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action='role.permission.approve'").get().c >= 1);

  // 5) 驳回流程：再申请→另一管理员驳回→权限不变
  r = await request('PUT', '/api/roles/worker/permissions', { permissions: ['quality:read'] }, { 'x-test-uid': '1' });
  assert.equal(r.status, 202);
  const requestId2 = r.body.request_id;
  r = await request('POST', '/api/permission-change-requests/' + requestId2 + '/reject', {}, { 'x-test-uid': String(admin2) });
  assert.equal(r.status, 400, '驳回必须填 note');
  r = await request('POST', '/api/permission-change-requests/' + requestId2 + '/reject', { note: '权限过大' }, { 'x-test-uid': String(admin2) });
  assert.equal(r.status, 200);
  const unchanged = JSON.parse(db.prepare("SELECT permissions FROM roles WHERE role_code='worker'").get().permissions);
  assert.deepEqual(unchanged, ['work_order:read', 'work_report:read'], '驳回后权限不变');
  assert.ok(db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action='role.permission.reject'").get().c >= 1);
});

// ---------------- 角色组模块（RG-*） ----------------

test('RG-1 重复 group_code 返回 409（原 500）', async () => {
  const r = await request('POST', '/api/role-groups', { group_code: 'production', group_name: '重复生产部' });
  assert.equal(r.status, 409);
  assert.match(r.body.message, /group_code 已存在/);
});

test('RG-2 scope_config 结构校验：未知键/字符串 ID 拒绝，合法配置通过', async () => {
  let r = await request('POST', '/api/role-groups', { group_code: 'scope_bad1', group_name: '坏配置1', scope_config: { foo: [1] } });
  assert.equal(r.status, 400);
  assert.match(r.body.message, /不支持的键/);
  r = await request('POST', '/api/role-groups', { group_code: 'scope_bad2', group_name: '坏配置2', scope_config: { project_ids: ['x'] } });
  assert.equal(r.status, 400);
  assert.match(r.body.message, /正整数数组/);
  r = await request('POST', '/api/role-groups', { group_code: 'scope_ok', group_name: '好配置', data_scope: 'instance', scope_config: { project_ids: [1], locations: ['主仓库-A'] } });
  assert.equal(r.status, 200);
  const groupId = r.body.id;
  assert.equal(db.prepare('SELECT data_scope FROM role_groups WHERE id=?').get(groupId).data_scope, 'instance');
  await request('DELETE', '/api/role-groups/' + groupId);
});

test('RG-3/4 停用组约束 + 批量归属用户 + 审计', async () => {
  const r = await request('POST', '/api/role-groups', { group_code: 'batch_group', group_name: '批量组', default_role_code: 'worker', data_scope: 'all' });
  assert.equal(r.status, 200);
  const groupId = r.body.id;
  db.prepare("INSERT INTO users (username, full_name, role_id, role_code, is_active) VALUES ('u_batch1','批量一',3,'worker',1)").run();
  db.prepare("INSERT INTO users (username, full_name, role_id, role_code, is_active) VALUES ('u_batch2','批量二',3,'worker',1)").run();
  const ids = db.prepare("SELECT id FROM users WHERE username IN ('u_batch1','u_batch2') ORDER BY id").all().map((row) => row.id);

  let res = await request('POST', '/api/role-groups/' + groupId + '/assign-users', { user_ids: ids });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.assigned, 2);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM users WHERE role_group_id=?").get(groupId).c, 2);
  assert.ok(db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action='role_group.assign_users'").get().c >= 1);

  const groups = (await request('GET', '/api/role-groups')).body.items;
  const target = groups.find((group) => group.id === groupId);
  assert.equal(target.user_count, 2);
  assert.equal(target.active_user_count, 2);

  // 有用户时不能停用
  res = await request('PATCH', '/api/role-groups/' + groupId, { is_active: false });
  assert.equal(res.status, 409);
  assert.match(res.body.message, /不能停用/);

  // 停用组不能分配
  db.prepare('UPDATE users SET role_group_id = NULL WHERE role_group_id = ?').run(groupId);
  res = await request('PATCH', '/api/role-groups/' + groupId, { is_active: false });
  assert.equal(res.status, 200);
  res = await request('POST', '/api/role-groups/' + groupId + '/assign-users', { user_ids: ids });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /已停用，不能分配用户/);

  // 用户不能挂到停用组
  res = await request('POST', '/api/users', { username: 'u_batch3', password: 'BatchPass123!', full_name: '批量三', role_code: 'worker', role_group_id: groupId });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /已停用，不能分配用户/);

  // 清理
  db.prepare("DELETE FROM users WHERE username IN ('u_batch1','u_batch2','u_batch3')").run();
  await request('DELETE', '/api/role-groups/' + groupId);
});

test('RG-5 停用角色组不参与数据范围继承（loadScope 兜底）', async () => {
  const { loadScope } = require('../app/dataScope');
  const r = await request('POST', '/api/role-groups', { group_code: 'scope_legacy', group_name: '遗留组', data_scope: 'workshop', scope_config: { subsystem_ids: [1] } });
  const groupId = r.body.id;
  db.prepare("INSERT INTO users (username, full_name, role_id, role_code, is_active) VALUES ('u_scope','范围用户',3,'worker',1)").run();
  const userId = db.prepare("SELECT id FROM users WHERE username='u_scope'").get().id;
  db.prepare('UPDATE users SET role_group_id = ? WHERE id = ?').run(groupId, userId);
  // 模拟历史脏数据：组已停用但仍挂用户（绕过 PATCH 的停用保护）
  db.prepare('UPDATE role_groups SET is_active = 0 WHERE id = ?').run(groupId);
  const ctx = loadScope(db, userId);
  assert.equal(ctx.scope, 'all', '停用组不授予范围（回退默认）');
  assert.equal(ctx.source, 'default');
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  await request('DELETE', '/api/role-groups/' + groupId);
});

// ---------------- 角色组 P3（RG-7）----------------

test('RG-6 组级成员查询接口', async () => {
  const r = await request('POST', '/api/role-groups', { group_code: 'member_group', group_name: '成员组', default_role_code: 'worker', data_scope: 'all' });
  assert.equal(r.status, 200);
  const groupId = r.body.id;
  db.prepare("INSERT INTO users (username, full_name, role_id, role_code, is_active) VALUES ('m_u1','成员一',3,'worker',1)").run();
  db.prepare("INSERT INTO users (username, full_name, role_id, role_code, is_active) VALUES ('m_u2','成员二',3,'worker',1)").run();
  const ids = db.prepare("SELECT id FROM users WHERE username IN ('m_u1','m_u2') ORDER BY id").all().map((row) => row.id);
  let res = await request('POST', '/api/role-groups/' + groupId + '/assign-users', { user_ids: ids });
  assert.equal(res.status, 200);
  res = await request('GET', '/api/role-groups/' + groupId + '/members');
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 2);
  assert.deepEqual(res.body.items.map((user) => user.username).sort(), ['m_u1', 'm_u2']);
  assert.equal(res.body.items[0].role_name, '工人');
  db.prepare("DELETE FROM users WHERE username IN ('m_u1','m_u2')").run();
  await request('DELETE', '/api/role-groups/' + groupId);
});

test('RG-7 default_home 必须是真实页面路由', async () => {
  let r = await request('POST', '/api/role-groups', { group_code: 'bad_home', group_name: '坏首页', default_home: '/not-a-real-page' });
  assert.equal(r.status, 400);
  assert.match(r.body.message, /default_home 不是有效页面路由/);
  r = await request('POST', '/api/role-groups', { group_code: 'good_home', group_name: '好首页', default_home: '/delivery' });
  assert.equal(r.status, 200);
  assert.equal(db.prepare('SELECT default_home FROM role_groups WHERE id=?').get(r.body.id).default_home, '/delivery');
  r = await request('POST', '/api/role-groups', { group_code: 'good_home2', group_name: '好首页2', default_home: '/shopfloor?tab=pick' });
  assert.equal(r.status, 200);
  await request('DELETE', '/api/role-groups/' + r.body.id);
});

test('RG-8 软删除/恢复/彻底删除', async () => {
  const r = await request('POST', '/api/role-groups', { group_code: 'soft_group', group_name: '软删组', data_scope: 'all' });
  const groupId = r.body.id;
  let res = await request('DELETE', '/api/role-groups/' + groupId);
  assert.equal(res.status, 200);
  assert.equal(res.body.soft, true);
  let list = (await request('GET', '/api/role-groups')).body.items;
  assert.ok(!list.some((group) => group.id === groupId), '默认列表不显示已删除');
  list = (await request('GET', '/api/role-groups?include_deleted=1')).body.items;
  assert.ok(list.some((group) => group.id === groupId && group.deleted_at), 'include_deleted 可看到已删除');
  res = await request('POST', '/api/role-groups/' + groupId + '/restore');
  assert.equal(res.status, 200);
  list = (await request('GET', '/api/role-groups')).body.items;
  assert.ok(list.some((group) => group.id === groupId && !group.deleted_at), '恢复后重新出现在列表');
  // 再次软删后彻底删除
  await request('DELETE', '/api/role-groups/' + groupId);
  res = await request('DELETE', '/api/role-groups/' + groupId + '?hard=1');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(db.prepare('SELECT COUNT(*) c FROM role_groups WHERE id=?').get(groupId).c, 0);
  assert.ok(db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action='role_group.delete_hard'").get().c >= 1);
});

test('RG-9 默认角色变更可批量调整已归属用户角色', async () => {
  const r = await request('POST', '/api/role-groups', { group_code: 'role_apply', group_name: '角色调整组', default_role_code: 'worker', data_scope: 'all' });
  const groupId = r.body.id;
  db.prepare("INSERT INTO users (username, full_name, role_id, role_code, is_active) VALUES ('ra_u1','调整一',3,'worker',1)").run();
  db.prepare("INSERT INTO users (username, full_name, role_id, role_code, is_active) VALUES ('ra_u2','调整二',3,'worker',1)").run();
  const ids = db.prepare("SELECT id FROM users WHERE username IN ('ra_u1','ra_u2') ORDER BY id").all().map((row) => row.id);
  await request('POST', '/api/role-groups/' + groupId + '/assign-users', { user_ids: ids });
  const res = await request('PATCH', '/api/role-groups/' + groupId, { default_role_code: 'foreman', apply_default_role_to_users: true });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.applied_users, 2);
  const users = db.prepare("SELECT role_code, token_version FROM users WHERE username IN ('ra_u1','ra_u2')").all();
  assert.deepEqual(users.map((user) => user.role_code), ['foreman', 'foreman']);
  assert.ok(users.every((user) => user.token_version >= 1), '批量调整角色应强制用户重新登录');
  assert.ok(db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action='role_group.apply_default_role'").get().c >= 1);
  db.prepare("DELETE FROM users WHERE username IN ('ra_u1','ra_u2')").run();
  await request('DELETE', '/api/role-groups/' + groupId);
});
