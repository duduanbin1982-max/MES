'use strict';
// tests/documentService.test.js
// P0 第 1 件: 文档/图纸管理测试
// 8 用例: validateMeta/列表/详情/下载/版本/上传/签发/收回

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TEST_UPLOAD_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'mes-document-test-'));
process.env.DOCUMENT_UPLOAD_ROOT = TEST_UPLOAD_ROOT;
test.after(() => fs.rmSync(TEST_UPLOAD_ROOT, { recursive: true, force: true }));

// stub auth
const authPath = require.resolve('../middleware/auth');
require.cache[authPath] = { exports: { requirePermission: () => (req, res, next) => next() } };

const documentService = require('../services/documentService');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_instance_id INTEGER NOT NULL,
      doc_type TEXT NOT NULL,
      doc_name TEXT NOT NULL,
      doc_no TEXT,
      file_path TEXT NOT NULL,
      file_size INTEGER,
      uploaded_by INTEGER,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
      notes TEXT,
      bom_node_id INTEGER, eco_id INTEGER, doc_code TEXT, version TEXT DEFAULT 'A0',
      file_name TEXT, mime_type TEXT, file_hash TEXT,
      status TEXT NOT NULL DEFAULT 'draft', issued_to TEXT, issued_at TEXT, issued_by INTEGER,
      revoke_reason TEXT, revoked_at TEXT, description TEXT, tags TEXT,
      updated_at TEXT, title TEXT
    );
    CREATE TABLE users (id INTEGER PRIMARY KEY, full_name TEXT, username TEXT);
    CREATE TABLE instance_bom (id INTEGER PRIMARY KEY, part_number TEXT, tier INTEGER);
    CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY AUTOINCREMENT, instance_code TEXT, instance_name TEXT);
    CREATE TABLE instance_eco (id INTEGER PRIMARY KEY);
    INSERT INTO equipment_instances (id, instance_code, instance_name) VALUES (1, 'TBM-001', '测试盾构');
    INSERT INTO users (id, username) VALUES (1, 'admin');
  `);
  return db;
}

function mkApp(db) {
  const app = { get: () => {}, post: () => {}, put: () => {}, delete: () => {} };
  const routes = {};
  ['get', 'post', 'put', 'delete'].forEach(m => {
    app[m] = (p, h) => { routes[m.toUpperCase() + ' ' + p] = h; };
  });
  documentService.register(app, db);
  const find = (method, path) => routes[method + ' ' + path];
  return { app, routes, find };
}

function mkRes() {
  const j = { status: 200, json: null }
  const res = {
    _j: j,
    status: (s) => { j.status = s; return res },
    json: (x) => { j.json = x; return res },
    setHeader: () => {},
  }
  return res
}

test('P0.DOC.1 validateMeta 必填校验', () => {
  // 2026-10-19：documents.equipment_instance_id 是 NOT NULL → 校验里也要求必填
  const v1 = documentService.validateMeta({ title: '机架装配图', doc_type: 'drawing', equipment_instance_id: 1 })
  assert.equal(v1.ok, true)
  const v2 = documentService.validateMeta({ title: '', doc_type: 'drawing', equipment_instance_id: 1 })
  assert.equal(v2.ok, false)
  assert.ok(v2.errors.some(e => e.includes('title')))
  const v3 = documentService.validateMeta({ title: 'X', doc_type: 'wrong', equipment_instance_id: 1 })
  assert.ok(v3.errors.some(e => e.includes('doc_type')))
  const v4 = documentService.validateMeta({ title: 'X', doc_type: 'drawing', equipment_instance_id: 1, status: 'invalid' })
  assert.ok(v4.errors.some(e => e.includes('status')))
  const v5 = documentService.validateMeta({ title: 'X', doc_type: 'drawing' })
  assert.equal(v5.ok, false, '缺 equipment_instance_id 必须拒绝（否则入库 500）')
  assert.ok(v5.errors.some(e => e.includes('equipment_instance_id')))
})

test('P0.DOC.2 列出空列表', () => {
  const db = freshDb()
  const { find } = mkApp(db)
  const handler = find('GET', '/api/documents')
  const res = mkRes()
  handler({ query: {} }, res, () => {})
  assert.equal(res._j.status, 200)
  assert.equal(res._j.json.total, 0)
  assert.deepEqual(res._j.json.items, [])
})

test('P0.DOC.3 按 type/status 过滤', () => {
  const db = freshDb()
  const { find } = mkApp(db)
  const handler = find('GET', '/api/documents')
  // 插 2 条
  db.prepare(`INSERT INTO documents (equipment_instance_id, doc_type, doc_name, file_path, file_size, status, title, doc_code) VALUES (1, 'drawing', '机架图', '/p1', 1000, 'draft', '机架图', 'ZZ-001')`).run()
  db.prepare(`INSERT INTO documents (equipment_instance_id, doc_type, doc_name, file_path, file_size, status, title, doc_code) VALUES (1, 'sop', '装配SOP', '/p2', 2000, 'issued', '装配SOP', 'ZZ-002')`).run()
  const res1 = mkRes()
  handler({ query: { doc_type: 'drawing' } }, res1, () => {})
  assert.equal(res1._j.json.total, 1)
  assert.equal(res1._j.json.items[0].title, '机架图')
  const res2 = mkRes()
  handler({ query: { status: 'issued' } }, res2, () => {})
  assert.equal(res2._j.json.total, 1)
})

test('P0.DOC.4 上传文档 (raw body + X-Doc-Meta)', () => {
  const db = freshDb()
  const { find } = mkApp(db)
  const handler = find('POST', '/api/documents')
  const meta = { title: '机架总装图', doc_type: 'drawing', doc_code: 'ZZ-001-A0', equipment_instance_id: 1, version: 'A0' }
  const buf = Buffer.from('%PDF-1.4 fake pdf content')
  const req = {
    body: buf,
    headers: {
      'x-doc-meta': JSON.stringify(meta),
      'x-file-name': 'jijia-A0.pdf',
      'x-file-mime': 'application/pdf',
    },
    user: { uid: 1 },
  }
  const res = mkRes()
  handler(req, res, () => {})
  assert.equal(res._j.status, 200)
  assert.ok(res._j.json.id > 0)
  assert.equal(res._j.json.title, '机架总装图')
  assert.equal(res._j.json.doc_type, 'drawing')
  assert.equal(res._j.json.file_size, buf.length)
  assert.equal(res._j.json.file_hash.length, 64)  // sha256 hex
  const events = db.prepare('SELECT action, to_status, version FROM document_events WHERE doc_id = ?').all(res._j.json.id)
  assert.deepEqual(events, [{ action: 'upload', to_status: 'draft', version: 'A0' }])
  // 文件应该写到了 data/uploads/2026/06/...
  const abs = path.join(TEST_UPLOAD_ROOT, res._j.json.file_path.replace(/^uploads[\\/]/, ''))
  assert.ok(fs.existsSync(abs), '文件应已落盘: ' + abs)
})

test('P0.DOC.5 同一 hash + version 重复上传被拒', () => {
  const db = freshDb()
  const { find } = mkApp(db)
  const handler = find('POST', '/api/documents')
  const meta = { title: 'X', doc_type: 'drawing', equipment_instance_id: 1, version: 'A0' }
  const buf = Buffer.from('same content')
  const req = (b) => ({ body: b, headers: { 'x-doc-meta': JSON.stringify(meta), 'x-file-name': 'a.pdf' }, user: { uid: 1 } })
  // 第 1 次: 200
  const r1 = mkRes(); handler(req(buf), r1, () => {})
  assert.equal(r1._j.status, 200)
  // 第 2 次: 409 (其实没拿到 next, 看 res 状态)
  // 我们的 handler 在重复时 next(conflict) - 哑 next 不会写 res, 测文件数就行
  const r2 = mkRes(); handler(req(buf), r2, () => {})
  // 应只有 1 行
  const cnt = db.prepare('SELECT count(*) AS c FROM documents').get().c
  assert.equal(cnt, 1, '重复 hash+version 应被拒, 只有 1 行')
})

test('P0.DOC.6 签发 (issue)', () => {
  const db = freshDb()
  const { find } = mkApp(db)
  const issueFile = path.join(TEST_UPLOAD_ROOT, 'issue.pdf'); fs.writeFileSync(issueFile, 'pdf')
  db.prepare(`INSERT INTO documents (equipment_instance_id, doc_type, doc_name, file_path, file_size, status, title, file_name) VALUES (1, 'drawing', 'X', 'uploads/issue.pdf', 3, 'draft', '机架图', 'issue.pdf')`).run()
  const issueHandler = find('PUT', '/api/documents/:id/issue')
  const req = { params: { id: 1 }, body: { issued_to: 'assembly' }, user: { uid: 1 } }
  const res = mkRes()
  issueHandler(req, res, () => {})
  assert.equal(res._j.status, 200)
  assert.equal(res._j.json.status, 'issued')
  assert.equal(res._j.json.issued_to, 'assembly')
})

test('P0.DOC.7 收回 (revoke)', () => {
  const db = freshDb()
  const { find } = mkApp(db)
  db.prepare(`INSERT INTO documents (equipment_instance_id, doc_type, doc_name, file_path, file_size, status, title) VALUES (1, 'drawing', 'X', '/p', 100, 'issued', 'X')`).run()
  const revokeHandler = find('PUT', '/api/documents/:id/revoke')
  const req = { params: { id: 1 }, body: { reason: 'ECO-2026-001 替换' }, user: { uid: 1 } }
  const res = mkRes()
  revokeHandler(req, res, () => {})
  assert.equal(res._j.status, 200)
  assert.equal(res._j.json.status, 'revoked')
  assert.ok(res._j.json.revoke_reason.includes('ECO'))
})

test('P0.DOC.8 版本历史 (按 doc_code 聚合)', () => {
  const db = freshDb()
  const { find } = mkApp(db)
  db.prepare(`INSERT INTO documents (equipment_instance_id, doc_type, doc_name, file_path, file_size, status, title, doc_code, version) VALUES (1, 'drawing', 'X', '/p1', 100, 'issued', 'X', 'ZZ-001', 'A0')`).run()
  db.prepare(`INSERT INTO documents (equipment_instance_id, doc_type, doc_name, file_path, file_size, status, title, doc_code, version) VALUES (1, 'drawing', 'X', '/p2', 110, 'issued', 'X', 'ZZ-001', 'A1')`).run()
  const handler = find('GET', '/api/documents/:id/versions')
  const res = mkRes()
  handler({ params: { id: 1 } }, res, () => {})
  assert.equal(res._j.json.items.length, 2)
  const versions = res._j.json.items.map(x => x.version).sort()
  assert.deepEqual(versions, ['A0', 'A1'])
})

test('P0.DOC.9 签发/签收/收回历史可追溯', () => {
  const db = freshDb()
  const { find } = mkApp(db)
  const historyFile = path.join(TEST_UPLOAD_ROOT, 'history.pdf'); fs.writeFileSync(historyFile, 'pdf')
  db.prepare(`INSERT INTO documents (equipment_instance_id, doc_type, doc_name, file_path, file_size, status, title, file_name, doc_code, version) VALUES (1, 'drawing', 'X', 'uploads/history.pdf', 3, 'draft', '机架图', 'history.pdf', 'ZZ-HIS', 'A0')`).run()

  find('PUT', '/api/documents/:id/issue')({ params: { id: 1 }, body: { issued_to: 'assembly' }, user: { uid: 1 } }, mkRes(), () => {})
  find('POST', '/api/documents/:id/acknowledge')({ params: { id: 1 }, user: { id: 1 } }, mkRes(), () => {})
  find('PUT', '/api/documents/:id/revoke')({ params: { id: 1 }, body: { reason: 'ECO 替换' }, user: { uid: 1 } }, mkRes(), () => {})

  const versionsRes = mkRes()
  find('GET', '/api/documents/:id/versions')({ params: { id: 1 } }, versionsRes, () => {})
  assert.deepEqual(versionsRes._j.json.events.map(e => e.action).sort(), ['acknowledge', 'issue', 'revoke'])

  const historyRes = mkRes()
  find('GET', '/api/documents/:id/history')({ params: { id: 1 } }, historyRes, () => {})
  assert.equal(historyRes._j.json.doc_id, 1)
  assert.ok(historyRes._j.json.events.some(e => e.action === 'revoke' && e.reason.includes('ECO')))
})
