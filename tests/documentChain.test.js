'use strict';

/**
 * documentChain.test.js
 * 2026-11-05 文档链路深挖（上传 → 签发 → 签收 → 版本升级 → 收回 → 归档）整改验证：
 *   1) 签发：仅 draft → issued；重复签发 400；归档/收回不可签发
 *   2) 收回：仅 issued → revoked；草稿不可收回
 *   3) 签收：仅 issued 可签收；重复签收幂等
 *   4) 版本链：doc_code 带版本后缀（ZZ-001-A0/A1）时按 family 聚合
 *   5) 归档：draft → archived，幂等
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const UPLOAD_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-doc-chain-'));
process.env.DOCUMENT_UPLOAD_ROOT = UPLOAD_ROOT;
fs.mkdirSync(path.join(UPLOAD_ROOT, '2026', '01'), { recursive: true });
fs.writeFileSync(path.join(UPLOAD_ROOT, '2026', '01', 'doc.txt'), 'hello');

const { registerMutationRoutes } = require('../services/documentService/mutationRoutes');
const { registerAcknowledgementRoutes } = require('../services/documentService/acknowledgementRoutes');
const { registerCollectionRoutes, registerDetailRoutes } = require('../services/documentService/queryRoutes');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, full_name TEXT, role TEXT)`);

  db.exec(`CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT)`);  db.exec(`CREATE TABLE documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_instance_id INTEGER, doc_type TEXT, doc_name TEXT, doc_no TEXT,
    file_path TEXT, file_size INTEGER, uploaded_by INTEGER, uploaded_at TEXT, notes TEXT, bom_node_id INTEGER, eco_id INTEGER,
    doc_code TEXT, version TEXT, file_name TEXT, mime_type TEXT, file_hash TEXT, status TEXT DEFAULT 'draft',
    issued_to TEXT, issued_at TEXT, issued_by INTEGER, revoke_reason TEXT, revoked_at TEXT, description TEXT, tags TEXT,
    updated_at TEXT, title TEXT, work_order_id INTEGER)`);
  db.exec(`CREATE TABLE doc_acknowledgements (id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id INTEGER NOT NULL, ack_by INTEGER NOT NULL, ack_at TEXT DEFAULT CURRENT_TIMESTAMP, ack_method TEXT DEFAULT 'web')`);
  db.exec(`CREATE TABLE document_events (id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id INTEGER NOT NULL, action TEXT NOT NULL, from_status TEXT, to_status TEXT, version TEXT, issued_to TEXT, reason TEXT, operator_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  return db;
}

function makeRoutes(db) {
  const routes = {};
  const app = { get: (p, h) => { routes['GET ' + p] = h; }, post: (p, h) => { routes['POST ' + p] = h; }, put: (p, h) => { routes['PUT ' + p] = h; }, delete: (p, h) => { routes['DELETE ' + p] = h; } };
  registerCollectionRoutes(app, db);
  registerAcknowledgementRoutes(app, db);
  registerDetailRoutes(app, db);
  registerMutationRoutes(app, db);
  return routes;
}

function call(routes, method, path, body, user) {
  const handler = routes[method + ' ' + path];
  if (!handler) throw new Error('no route: ' + method + ' ' + path);
  const match = path.match(/:([a-zA-Z_]+)/g) || [];
  const params = {};
  if (match.length) params[match[0].slice(1)] = body && body.__id ? body.__id : 1;
  const req = { body: body || {}, query: {}, params, user: user || { uid: 1, role: 'admin' } };
  let status = 200;
  let json = null;
  const res = { status: (code) => { status = code; return res; }, json: (payload) => { json = payload; return res; } };
  handler(req, res, (error) => {
    if (!error) return;
    status = error.status || 500;
    json = { error: error.message, code: error.code || 'INTERNAL_ERROR' };
  });
  return { status, json };
}

let db;
let routes;
const FILE_PATH = 'uploads/2026/01/doc.txt';
function insertDoc(overrides = {}) {
  const row = Object.assign({
    equipment_instance_id: 1,
    doc_type: 'drawing',
    title: '测试文档',
    doc_code: 'ZZ-TEST-A0',
    version: 'A0',
    file_name: 'doc.txt',
    file_path: FILE_PATH,
    file_size: 5,
    mime_type: 'text/plain',
    file_hash: 'hash-' + Math.random(),
    status: 'draft',
  }, overrides);
  const result = db.prepare(`INSERT INTO documents (equipment_instance_id, doc_type, title, doc_code, version, file_name, file_path, file_size, mime_type, file_hash, status)
                             VALUES (@equipment_instance_id, @doc_type, @title, @doc_code, @version, @file_name, @file_path, @file_size, @mime_type, @file_hash, @status)`).run(row);
  return Number(result.lastInsertRowid);
}

test.beforeEach(() => {
  db = freshDb();
  db.prepare(`INSERT INTO users (id, username, full_name) VALUES (1, 'admin', '管理员')`).run();
  routes = makeRoutes(db);
});
test.after(() => { fs.rmSync(UPLOAD_ROOT, { recursive: true, force: true }); });

test('DC.1 签发：draft → issued；重复签发 400；archived 不可签发', () => {
  const id = insertDoc();
  let result = call(routes, 'PUT', '/api/documents/:id/issue', { __id: id, issued_to: 'welding' });
  assert.equal(result.status, 200, JSON.stringify(result.json));
  assert.equal(result.json.status, 'issued');
  assert.equal(result.json.issued_to, 'welding');
  result = call(routes, 'PUT', '/api/documents/:id/issue', { __id: id, issued_to: 'welding' });
  assert.equal(result.status, 400, '重复签发应 400');
  const archived = insertDoc({ status: 'archived' });
  result = call(routes, 'PUT', '/api/documents/:id/issue', { __id: archived, issued_to: 'welding' });
  assert.equal(result.status, 422);
});

test('DC.2 收回：仅 issued → revoked；草稿不可收回', () => {
  const id = insertDoc();
  let result = call(routes, 'PUT', '/api/documents/:id/revoke', { __id: id, reason: '作废' });
  assert.equal(result.status, 400, '草稿不能收回');
  call(routes, 'PUT', '/api/documents/:id/issue', { __id: id, issued_to: 'qc' });
  result = call(routes, 'PUT', '/api/documents/:id/revoke', { __id: id, reason: '作废' });
  assert.equal(result.status, 200);
  assert.equal(result.json.status, 'revoked');
  result = call(routes, 'PUT', '/api/documents/:id/revoke', { __id: id, reason: '再作废' });
  assert.equal(result.status, 400, '已收回不可再收回');
});

test('DC.3 签收：仅 issued 可签收；重复签收幂等（uid 生效）', () => {
  const draft = insertDoc();
  let result = call(routes, 'POST', '/api/documents/:id/acknowledge', { __id: draft });
  assert.equal(result.status, 400, '草稿不能签收');
  const issued = insertDoc();
  call(routes, 'PUT', '/api/documents/:id/issue', { __id: issued, issued_to: 'assembly' });
  result = call(routes, 'POST', '/api/documents/:id/acknowledge', { __id: issued });
  assert.equal(result.status, 200);
  assert.equal(result.json.ok, true);
  result = call(routes, 'POST', '/api/documents/:id/acknowledge', { __id: issued });
  assert.equal(result.json.already, true);
  const ack = call(routes, 'GET', '/api/documents/:id/acknowledgements', { __id: issued });
  assert.equal(ack.json.total, 1);
});

test('DC.4 版本链：同 family 的 A0/A1 互相可见', () => {
  const a0 = insertDoc({ doc_code: 'ZZ-TEST-A0', version: 'A0' });
  const a1 = insertDoc({ doc_code: 'ZZ-TEST-A1', version: 'A1', file_hash: 'hash-a1' });
  const result = call(routes, 'GET', '/api/documents/:id/versions', { __id: a0 });
  assert.equal(result.status, 200);
  const versions = result.json.items.map((row) => row.version).sort();
  assert.deepEqual(versions, ['A0', 'A1']);
  const history = call(routes, 'GET', '/api/documents/:id/history', { __id: a0 });
  assert.deepEqual(history.json.document_ids.sort((a, b) => a - b), [a0, a1]);
});

test('DC.5 归档：draft → archived 幂等', () => {
  const id = insertDoc();
  let result = call(routes, 'DELETE', '/api/documents/:id', { __id: id });
  assert.equal(result.status, 200);
  assert.equal(result.json.status, 'archived');
  result = call(routes, 'DELETE', '/api/documents/:id', { __id: id });
  assert.equal(result.status, 200);
  assert.equal(result.json.status, 'archived');
});

test('DC.6 待签收列表排除已签收文档', () => {
  const issued = insertDoc();
  call(routes, 'PUT', '/api/documents/:id/issue', { __id: issued, issued_to: 'qc' });
  let pending = call(routes, 'GET', '/api/documents/pending-ack', {});
  assert.equal(pending.status, 200);
  assert.ok(pending.json.pending.some((row) => row.id === issued), '应包含已签发未签收文档');
  call(routes, 'POST', '/api/documents/:id/acknowledge', { __id: issued });
  pending = call(routes, 'GET', '/api/documents/pending-ack', {});
  assert.ok(!pending.json.pending.some((row) => row.id === issued), '签收后应从待签收列表移除');
});
