'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.DOCUMENT_UPLOAD_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-control-'));
const documentService = require('../services/documentService');
const { buildStoragePath } = require('../services/documentService/storage');

function mkRes() {
  const res = { statusCode: 200 };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}
function captureApp() {
  const routes = new Map();
  const app = {};
  for (const method of ['get', 'post', 'put', 'patch', 'delete', 'use']) app[method] = (path, handler) => {
    if (path && typeof handler === 'function') routes.set(`${method.toUpperCase()} ${path}`, handler);
  };
  return { app, routes };
}
async function call(routes, method, path, { params = {}, body = {}, query = {}, user = { uid: 1, role: 'admin', permissions: ['*'] } } = {}) {
  const handler = routes.get(`${method} ${path}`);
  assert.ok(handler, `missing route ${method} ${path}`);
  const res = mkRes();
  await handler({ params, body, query, user, headers: {}, app: { locals: { db: global.__docDb } } }, res, (error) => { if (error) throw error; });
  return res;
}

function freshDb() {
  const db = new Database(':memory:');
  global.__docDb = db;
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, full_name TEXT, role TEXT, role_code TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT);
    CREATE TABLE instance_bom (id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_instance_id INTEGER, parent_id INTEGER, tier INTEGER);
    CREATE TABLE instance_eco (id INTEGER PRIMARY KEY);
    CREATE TABLE documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_instance_id INTEGER NOT NULL, doc_type TEXT, doc_name TEXT, doc_no TEXT,
      file_path TEXT, file_size INTEGER, uploaded_by INTEGER, uploaded_at TEXT, notes TEXT, bom_node_id INTEGER, eco_id INTEGER,
      doc_code TEXT, version TEXT, file_name TEXT, mime_type TEXT, file_hash TEXT, status TEXT DEFAULT 'draft', issued_to TEXT,
      issued_at TEXT, issued_by INTEGER, revoke_reason TEXT, revoked_at TEXT, description TEXT, tags TEXT, updated_at TEXT,
      title TEXT, work_order_id INTEGER
    );
    CREATE TABLE doc_acknowledgements (id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id INTEGER, ack_by INTEGER, ack_at TEXT, ack_method TEXT);
    CREATE TABLE document_events (id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id INTEGER NOT NULL, action TEXT NOT NULL, from_status TEXT, to_status TEXT, version TEXT, issued_to TEXT, reason TEXT, operator_id INTEGER, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT, role TEXT, action TEXT NOT NULL, resource_type TEXT, resource_id TEXT, before_json TEXT, after_json TEXT, diff_summary TEXT, ip TEXT, user_agent TEXT, request_id TEXT, status TEXT DEFAULT 'success', error TEXT, created_at TEXT DEFAULT (datetime('now')));
  `);
  db.prepare("INSERT INTO equipment_instances (id, instance_code, instance_name) VALUES (1, 'TBM-1', '一号机')").run();
  db.prepare("INSERT INTO users (id, username, full_name, role, role_code, is_active) VALUES (1, 'admin', '管理员', 'admin', 'admin', 1), (2, 'foreman', '班长', 'foreman', 'foreman', 1)").run();
  db.prepare("INSERT INTO instance_bom (id, equipment_instance_id, parent_id, tier) VALUES (10, 1, NULL, 0)").run();
  return db;
}

async function setupDoc(routes, db) {
  // schema already ensured by register in caller
  const storage = buildStoragePath('dwg.pdf');
  fs.mkdirSync(path.dirname(storage.abs), { recursive: true });
  fs.writeFileSync(storage.abs, 'PDF');
  const result = db.prepare(`INSERT INTO documents (equipment_instance_id, doc_type, title, doc_code, version, file_name, file_path, file_size, mime_type, uploaded_by, status)
    VALUES (1, 'drawing', '刀盘总图', 'DWG-001', 'A1', 'dwg.pdf', ?, 10, 'application/pdf', 1, 'draft')`).run(storage.rel);
  return Number(result.lastInsertRowid);
}

test('DOC.1 审批/电子签署：提交→审批中禁止签发→三级审批→签发', async () => {
  const db = freshDb();
  const { app, routes } = captureApp();
  documentService.register(app, db);
  const docId = await setupDoc(routes, db);

  let res = await call(routes, 'POST', '/api/documents/:id/submit', { params: { id: docId } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.steps.length, 3);
  await assert.rejects(
    () => call(routes, 'PUT', '/api/documents/:id/issue', { params: { id: docId }, body: { issued_to: 'assembly' } }),
    /审批中的文档不能签发/,
  );

  for (let step = 1; step <= 3; step += 1) {
    res = await call(routes, 'POST', '/api/documents/:id/approve', { params: { id: docId }, body: { step_no: step, action: 'approve', comment: '同意' } });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  }
  const approval = await call(routes, 'GET', '/api/documents/:id/approvals', { params: { id: docId } });
  assert.equal(approval.body.approval_status, 'approved');
  assert.ok(approval.body.steps.every((step) => step.status === 'approved' && step.signature));

  res = await call(routes, 'PUT', '/api/documents/:id/issue', { params: { id: docId }, body: { issued_to: 'assembly' } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const targets = await call(routes, 'GET', '/api/documents/:id/distribution', { params: { id: docId } });
  assert.ok(targets.body.targets.length >= 1, JSON.stringify(targets.body));
  const target = targets.body.targets[0];
  res = await call(routes, 'POST', '/api/documents/distribution-targets/:id/ack', { params: { id: target.id }, user: { uid: 2, role: 'foreman' } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  db.close();
});

test('DOC.2 修订块 + 机号/日期有效性 + 生效文件查询', async () => {
  const db = freshDb();
  const { app, routes } = captureApp();
  documentService.register(app, db);
  const docId = await setupDoc(routes, db);

  let res;
  try { res = await call(routes, 'PATCH', '/api/documents/:id/revision', { params: { id: docId }, body: { revision_note: '修改刀盘开口尺寸', revision_reason: '设计优化' } });
  } catch (error) { console.error('REV ERR', error.message, JSON.stringify(error.details || {})); throw error; }
  assert.equal(res.statusCode, 200);
  res = await call(routes, 'GET', '/api/documents/:id/revisions', { params: { id: docId } });
  assert.equal(res.body.revisions[0].revision_note, '修改刀盘开口尺寸');

  res = await call(routes, 'PUT', '/api/documents/:id/effectivity', { params: { id: docId }, body: { effectivity_type: 'date_range', effective_from: '2026-01-01', effective_to: '2026-12-31' } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  db.prepare("UPDATE documents SET status='issued', issued_at=datetime('now') WHERE id=?").run(docId);
  res = await call(routes, 'GET', '/api/documents/effective', { query: { instance_id: 1, as_of: '2026-06-01' } });
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.items.some((doc) => doc.id === docId));
  res = await call(routes, 'GET', '/api/documents/effective', { query: { instance_id: 1, as_of: '2025-06-01' } });
  assert.ok(!res.body.items.some((doc) => doc.id === docId));
  db.close();
});
