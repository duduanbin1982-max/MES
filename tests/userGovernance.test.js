'use strict';

/**
 * userGovernance.test.js
 * 2026-11-06 用户管理审计验证：
 *   U-1 token 失效：禁用/删除/改角色/改密码/角色权限变更后，旧 token 立即 401
 *   U-2 保护：不能删除自己 / 最后一个启用管理员；有业务引用不能删除
 *   U-3 自助改密必须校验原密码
 *   U-4 用户 CRUD 写审计
 *   U-5 密码策略 / 用户名格式 / 大小写重复
 *   U-6 用户列表搜索 + 分页
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

// JWT 模块在加载时校验密钥长度；测试环境先注入固定密钥
process.env.JWT_SECRET = 'user-governance-test-secret-0123456789abcdef';
const jwt = require('../app/jwt');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE roles (id INTEGER PRIMARY KEY AUTOINCREMENT, role_code TEXT UNIQUE, role_name TEXT, description TEXT, permissions TEXT DEFAULT '[]')`);
  db.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password_hash TEXT, full_name TEXT,
    role_id INTEGER, role_code TEXT, role_name TEXT, phone TEXT, is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, last_login TEXT, role_group_id INTEGER,
    data_scope TEXT, data_scope_config TEXT, token_version INTEGER NOT NULL DEFAULT 0)`);
  db.exec(`CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT, role TEXT, action TEXT,
    resource_type TEXT, resource_id TEXT, before_json TEXT, after_json TEXT, diff_summary TEXT, ip TEXT, user_agent TEXT,
    request_id TEXT, status TEXT, error TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  db.exec(`CREATE TABLE work_orders (id INTEGER PRIMARY KEY, wo_code TEXT, assigned_to INTEGER)`);
  db.exec(`CREATE TABLE process_executions (id INTEGER PRIMARY KEY, process_node_id INTEGER, operator_id INTEGER)`);
  db.exec(`CREATE TABLE work_report_details (id INTEGER PRIMARY KEY, worker_id INTEGER, work_order_id INTEGER)`);
  return db;
}

function seed(db) {
  const insertRole = db.prepare('INSERT INTO roles (role_code, role_name, permissions) VALUES (?, ?, ?)');
  insertRole.run('admin', '管理员', JSON.stringify(['*']));
  insertRole.run('worker', '工人', JSON.stringify(['work_order:read']));
  const insertUser = db.prepare('INSERT INTO users (username, password_hash, full_name, role_id, role_code, role_name, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const hash = bcrypt.hashSync('Passw0rd!', 4);
  insertUser.run('admin', hash, '管理员', 1, 'admin', '管理员', 1);
  insertUser.run('worker1', hash, '工人一', 2, 'worker', '工人', 1);
  insertUser.run('worker2', hash, '工人二', 2, 'worker', '工人', 1);
}

function resStub() {
  const state = { status: 200, body: null };
  const res = {
    status(code) { state.status = code; return res; },
    json(payload) { state.body = payload; return res; },
  };
  return { res, state };
}

function callRoute(routes, method, path, body, user, params = {}) {
  const handler = routes[method + ' ' + path];
  assert.ok(handler, 'missing route ' + method + ' ' + path);
  const { res, state } = resStub();
  const req = { body: body || {}, query: body && body.__query || {}, params, user: user || { uid: 1, role: 'admin' } };
  let error = null;
  handler(req, res, (err) => { error = err; });
  if (error) return { status: error.status || 500, body: { error: error.message, code: error.code } };
  return { status: state.status, body: state.body };
}

let db;
let routes;
let service;
test.beforeEach(() => {
  db = freshDb();
  seed(db);
  routes = {};
  const app = {
    get: (p, h) => { routes['GET ' + p] = h; },
    post: (p, h) => { routes['POST ' + p] = h; },
    patch: (p, h) => { routes['PATCH ' + p] = h; },
    delete: (p, h) => { routes['DELETE ' + p] = h; },
    put: () => {},
  };
  delete require.cache[require.resolve('../services/userManagement')];
  service = require('../services/userManagement');
  service.register(app, db);
  // ensureSchema 会 seed role_groups / 补列
});

test('U-5 创建用户：密码策略/用户名格式/大小写重复', () => {
  assert.equal(callRoute(routes, 'POST', '/api/users', { username: 'newuser', password: '123', full_name: '新人', role_code: 'worker' }).status, 400);
  assert.equal(callRoute(routes, 'POST', '/api/users', { username: 'a', password: 'Passw0rd!', full_name: '新人', role_code: 'worker' }).status, 400);
  assert.equal(callRoute(routes, 'POST', '/api/users', { username: 'Admin', password: 'Passw0rd!', full_name: '新人', role_code: 'worker' }).status, 400, '大小写重复应拒绝');
  assert.equal(callRoute(routes, 'POST', '/api/users', { username: 'gooduser', password: 'Passw0rd!', full_name: '新人', role_code: 'worker' }).status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM users WHERE username = 'gooduser'").get().c, 1);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action = 'user.create'").get().c, 1);
});

test('U-3 自助改密必须校验原密码', () => {
  const user = { uid: 2, role: 'worker' };
  assert.equal(callRoute(routes, 'PATCH', '/api/users/:id', { password: 'NewPassw0rd!' }, user, { id: 2 }).status, 400, '缺 old_password');
  assert.equal(callRoute(routes, 'PATCH', '/api/users/:id', { password: 'NewPassw0rd!', old_password: 'wrong' }, user, { id: 2 }).status, 400);
  assert.equal(callRoute(routes, 'PATCH', '/api/users/:id', { password: 'NewPassw0rd!', old_password: 'Passw0rd!' }, user, { id: 2 }).status, 200);
  const row = db.prepare('SELECT password_hash, token_version FROM users WHERE id = 2').get();
  assert.equal(bcrypt.compareSync('NewPassw0rd!', row.password_hash), true);
  assert.equal(row.token_version, 1, '改密后 token_version +1');
});

test('U-1a 禁用用户后旧 token 立即失效（authMiddleware 401）', () => {
  const { authMiddleware } = require('../middleware/auth');
  const oldToken = jwt.signAccess({ sub: 2, role: 'worker', permissions: ['work_order:read'], tv: 0 }).token;
  const run = (token) => {
    let status = 200;
    let errorBody = null;
    const req = { headers: { authorization: 'Bearer ' + token }, path: '/users' };
    const res = { status(code) { status = code; return res; }, json(payload) { errorBody = payload; return res; } };
    let nexted = false;
    authMiddleware(req, res, () => { nexted = true; }, db);
    return { status, nexted, errorBody };
  };
  assert.equal(run(oldToken).nexted, true, '初始 token 有效');
  callRoute(routes, 'PATCH', '/api/users/:id', { is_active: false }, { uid: 1, role: 'admin' }, { id: 2 });
  const after = run(oldToken);
  assert.equal(after.status, 401, '禁用后旧 token 应 401');
  assert.match(after.errorBody.error, /禁用/);
});

test('U-1b 改角色/改密码后旧 token 失效；刷新接口同样拒绝', () => {
  const { authMiddleware, handleRefresh } = require('../middleware/auth');
  const token = jwt.signAccess({ sub: 3, role: 'worker', permissions: ['work_order:read'], tv: 0 }).token;
  const check = (method) => {
    if (method === 'refresh') {
      const { res, state } = resStub();
      handleRefresh({ body: { access_token: token } }, res, () => {}, db);
      return state.status;
    }
    const req = { headers: { authorization: 'Bearer ' + token }, path: '/users' };
    let status = 200;
    const res = { status(code) { status = code; return res; }, json() { return res; } };
    let nexted = false;
    authMiddleware(req, res, () => { nexted = true; }, db);
    return nexted ? 200 : status;
  };
  assert.equal(check('auth'), 200);
  callRoute(routes, 'PATCH', '/api/users/:id', { role_code: 'worker' }, { uid: 1, role: 'admin' }, { id: 3 });
  assert.equal(check('auth'), 200, '同角色设置不失效');
  callRoute(routes, 'PATCH', '/api/users/:id', { password: 'AnotherPass1!' }, { uid: 1, role: 'admin' }, { id: 3 });
  assert.equal(check('auth'), 401);
  assert.equal(check('refresh'), 401, 'refresh 也不能给旧 token 续签');
});

test('U-2 保护：不能删除自己 / 最后一个管理员 / 有引用用户', () => {
  assert.equal(callRoute(routes, 'DELETE', '/api/users/:id', {}, { uid: 1, role: 'admin' }, { id: 1 }).status, 400, '不能删除自己');
  // 第二个管理员可删，但删到只剩一个时禁止
  callRoute(routes, 'POST', '/api/users', { username: 'admin2', password: 'Passw0rd!', full_name: '管理员二', role_code: 'admin' });
  const admin2 = db.prepare("SELECT id FROM users WHERE username='admin2'").get().id;
  assert.equal(callRoute(routes, 'DELETE', '/api/users/:id', {}, { uid: 1, role: 'admin' }, { id: admin2 }).status, 200);
  assert.equal(callRoute(routes, 'DELETE', '/api/users/:id', {}, { uid: 2, role: 'admin' }, { id: 1 }).status, 400, '最后一个管理员不能删');
  // 被工单引用
  db.prepare('INSERT INTO work_orders (id, wo_code, assigned_to) VALUES (1, ?, 3)').run('WO-1');
  const result = callRoute(routes, 'DELETE', '/api/users/:id', {}, { uid: 1, role: 'admin' }, { id: 3 });
  assert.equal(result.status, 409);
  assert.match(result.body.error, /不能删除/);
});

test('U-2b 最后一个启用管理员不能被禁用或降级', () => {
  assert.equal(callRoute(routes, 'PATCH', '/api/users/:id', { is_active: false }, { uid: 1, role: 'admin' }, { id: 1 }).status, 400);
  assert.equal(callRoute(routes, 'PATCH', '/api/users/:id', { role_code: 'worker' }, { uid: 1, role: 'admin' }, { id: 1 }).status, 400);
});

test('U-4 用户更新/删除写审计；U-6 列表搜索与分页', () => {
  callRoute(routes, 'PATCH', '/api/users/:id', { full_name: '工人一改名' }, { uid: 1, role: 'admin' }, { id: 2 });
  assert.equal(db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action='user.update'").get().c, 1);
  db.prepare("DELETE FROM work_report_details").run();
  db.prepare("INSERT INTO work_report_details (id, worker_id, work_order_id) VALUES (1, 2, 1)").run();
  assert.equal(callRoute(routes, 'DELETE', '/api/users/:id', {}, { uid: 1, role: 'admin' }, { id: 2 }).status, 409);
  db.prepare('DELETE FROM work_report_details').run();
  callRoute(routes, 'DELETE', '/api/users/:id', {}, { uid: 1, role: 'admin' }, { id: 2 });
  assert.equal(db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action='user.delete'").get().c, 1);

  const list = callRoute(routes, 'GET', '/api/users', { __query: { q: 'worker', page: '1', page_size: '1' } }, { uid: 1, role: 'admin' });
  assert.equal(list.status, 200);
  assert.equal(list.body.total, 1, 'worker2 被删后只剩 worker1 匹配');
  assert.equal(list.body.items.length, 1);
  assert.equal(list.body.page_size, 1);
  assert.equal(list.body.items[0].password_hash, undefined, '列表不能泄露密码哈希');
});

test('U-1c 角色权限矩阵变更：该角色用户 token 全部失效', () => {
  const { authMiddleware } = require('../middleware/auth');
  const token = jwt.signAccess({ sub: 2, role: 'worker', permissions: ['work_order:read'], tv: 0 }).token;
  const verdict = () => {
    const req = { headers: { authorization: 'Bearer ' + token }, path: '/users' };
    let status = 200;
    const res = { status(code) { status = code; return res; }, json() { return res; } };
    let nexted = false;
    authMiddleware(req, res, () => { nexted = true; }, db);
    return nexted ? 200 : status;
  };
  assert.equal(verdict(), 200);
  service.setRolePermissions(2, ['work_order:read', 'work_report:read']);
  assert.equal(verdict(), 401);
  assert.ok(db.prepare('SELECT token_version FROM users WHERE id = 2').get().token_version >= 1);
});
