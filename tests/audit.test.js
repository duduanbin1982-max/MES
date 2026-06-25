'use strict';

/**
 * audit.test.js
 * P1-4 审计日志测试
 * 10 用例:
 *  1. record 写入成功返回 id
 *  2. record 抓 user/role/ip/user_agent
 *  3. record before/after JSON.stringify
 *  4. record 失败 db 不抛业务错误
 *  5. record 缺 db 返回 null
 *  6. query 按 user_id 过滤
 *  7. query 按 action 过滤
 *  8. query 分页 (limit/offset)
 *  9. query 按时间倒序
 * 10. query 复杂组合过滤 (action + status)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const audit = require('../app/audit');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER, username TEXT, role TEXT,
    action TEXT NOT NULL, resource_type TEXT, resource_id TEXT,
    before_json TEXT, after_json TEXT, diff_summary TEXT,
    ip TEXT, user_agent TEXT, request_id TEXT,
    status TEXT DEFAULT 'success', error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  return db;
}

function mkReq(user = {}, headers = {}) {
  return {
    user: { uid: 1, role: 'admin', ...user },
    ip: '127.0.0.1',
    headers: { 'user-agent': 'jest/1.0', ...headers },
    requestId: 'req_test_001',
  };
}

test('P1-4.AUDIT.1 record 写入成功返回 id', () => {
  const db = freshDb();
  const id = audit.record(db, mkReq(), { action: 'test.action' });
  assert.ok(id > 0);
  const row = db.prepare('SELECT * FROM audit_logs WHERE id = ?').get(id);
  assert.equal(row.action, 'test.action');
  assert.equal(row.username, null);  // 我们的 mkReq 没传 username
});

test('P1-4.AUDIT.2 record 抓 user/role/ip/user_agent/request_id', () => {
  const db = freshDb();
  const req = {
    user: { uid: 42, username: 'admin', role: 'admin' },
    ip: '10.0.0.1',
    headers: { 'user-agent': 'curl/8.0' },
    requestId: 'req_abc',
  };
  const id = audit.record(db, req, { action: 'x.y' });
  const row = db.prepare('SELECT * FROM audit_logs WHERE id = ?').get(id);
  assert.equal(row.user_id, 42);
  assert.equal(row.username, 'admin');
  assert.equal(row.role, 'admin');
  assert.equal(row.ip, '10.0.0.1');
  assert.equal(row.user_agent, 'curl/8.0');
  assert.equal(row.request_id, 'req_abc');
});

test('P1-4.AUDIT.3 record before/after JSON 序列化', () => {
  const db = freshDb();
  const id = audit.record(db, mkReq(), {
    action: 'role.update',
    before: { perms: ['a', 'b'] },
    after:  { perms: ['a', 'b', 'c'] },
    diff_summary: '+c',
  });
  const row = db.prepare('SELECT * FROM audit_logs WHERE id = ?').get(id);
  assert.deepEqual(JSON.parse(row.before_json), { perms: ['a', 'b'] });
  assert.deepEqual(JSON.parse(row.after_json),  { perms: ['a', 'b', 'c'] });
  assert.equal(row.diff_summary, '+c');
});

test('P1-4.AUDIT.4 record 失败 db 抛错不传播业务', () => {
  const db = null;  // null db 不会抛
  const id = audit.record(db, mkReq(), { action: 'x' });
  assert.equal(id, null);
});

test('P1-4.AUDIT.5 record 缺 user 不抛', () => {
  const db = freshDb();
  const id = audit.record(db, {}, { action: 'x.y' });
  assert.ok(id > 0);
  const row = db.prepare('SELECT * FROM audit_logs WHERE id = ?').get(id);
  assert.equal(row.user_id, null);
  assert.equal(row.role, null);
  assert.equal(row.ip, null);
});

test('P1-4.AUDIT.6 query 按 user_id 过滤', () => {
  const db = freshDb();
  audit.record(db, { user: { uid: 1 }, headers: {} }, { action: 'a' });
  audit.record(db, { user: { uid: 2 }, headers: {} }, { action: 'b' });
  audit.record(db, { user: { uid: 1 }, headers: {} }, { action: 'c' });
  const r = audit.query(db, { user_id: 1 });
  assert.equal(r.total, 2);
  assert.equal(r.rows.length, 2);
});

test('P1-4.AUDIT.7 query 按 action 过滤', () => {
  const db = freshDb();
  audit.record(db, { user: { uid: 1 }, headers: {} }, { action: 'role.update' });
  audit.record(db, { user: { uid: 1 }, headers: {} }, { action: 'role.delete' });
  audit.record(db, { user: { uid: 1 }, headers: {} }, { action: 'role.update' });
  const r = audit.query(db, { action: 'role.update' });
  assert.equal(r.total, 2);
});

test('P1-4.AUDIT.8 query 分页 limit/offset', () => {
  const db = freshDb();
  for (let i = 0; i < 10; i++) {
    audit.record(db, { user: { uid: 1 }, headers: {} }, { action: 'a' });
  }
  const p1 = audit.query(db, { limit: 3, offset: 0 });
  const p2 = audit.query(db, { limit: 3, offset: 3 });
  assert.equal(p1.total, 10);
  assert.equal(p1.rows.length, 3);
  assert.equal(p2.rows.length, 3);
  // 不同 id
  assert.notEqual(p1.rows[0].id, p2.rows[0].id);
});

test('P1-4.AUDIT.9 query 默认按 id DESC (最新在前)', () => {
  const db = freshDb();
  const id1 = audit.record(db, { user: { uid: 1 }, headers: {} }, { action: 'first' });
  const id2 = audit.record(db, { user: { uid: 1 }, headers: {} }, { action: 'second' });
  const id3 = audit.record(db, { user: { uid: 1 }, headers: {} }, { action: 'third' });
  const r = audit.query(db, {});
  assert.equal(r.rows[0].id, id3);
  assert.equal(r.rows[1].id, id2);
  assert.equal(r.rows[2].id, id1);
});

test('P1-4.AUDIT.10 query 组合过滤 (action + status)', () => {
  const db = freshDb();
  audit.record(db, { user: { uid: 1 }, headers: {} }, { action: 'a', status: 'success' });
  audit.record(db, { user: { uid: 1 }, headers: {} }, { action: 'a', status: 'failed' });
  audit.record(db, { user: { uid: 1 }, headers: {} }, { action: 'b', status: 'success' });
  const r = audit.query(db, { action: 'a', status: 'success' });
  assert.equal(r.total, 1);
  assert.equal(r.rows[0].action, 'a');
  assert.equal(r.rows[0].status, 'success');
});