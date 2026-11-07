'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.DOCUMENT_UPLOAD_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-ver-'));
const documentService = require('../services/documentService');
const { buildStoragePath, resolveStoredFile } = require('../services/documentService/storage');

function mkRes() {
  const res = { statusCode: 200 };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}
function captureApp() {
  const routes = new Map();
  const app = {};
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) app[method] = (pathname, handler) => routes.set(`${method.toUpperCase()} ${pathname}`, handler);
  return { app, routes };
}
async function call(routes, method, pathname, { params = {}, body = {}, query = {}, user = { uid: 1, role: 'admin', permissions: ['*'] } } = {}) {
  const handler = routes.get(`${method} ${pathname}`);
  assert.ok(handler, `missing route ${method} ${pathname}`);
  const res = mkRes();
  await handler({ params, body, query, user, headers: {}, app: { locals: { db: global.__db } } }, res, (error) => { if (error) throw error; });
  return res;
}
function freshDb() {
  const db = new Database(':memory:');
  global.__db = db;
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, full_name TEXT, role TEXT, role_code TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT);
    CREATE TABLE instance_bom (id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_instance_id INTEGER, parent_id INTEGER, tier INTEGER);
    CREATE TABLE instance_eco (id INTEGER PRIMARY KEY);
    CREATE TABLE documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_instance_id INTEGER, doc_type TEXT, doc_name TEXT, doc_no TEXT,
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
  db.prepare("INSERT INTO users (id, username, full_name, role, role_code, is_active) VALUES (1, 'admin', '管理员', 'admin', 'admin', 1), (2, 'worker', '工人', 'worker', 'worker', 1)").run();
  return db;
}
function createDoc(db, { version = 'A0', familyId = null, status = 'draft', title = '版本管理图纸' } = {}) {
  const storage = buildStoragePath(`ver-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`);
  fs.mkdirSync(path.dirname(storage.abs), { recursive: true });
  fs.writeFileSync(storage.abs, 'PDF');
  const result = db.prepare(`INSERT INTO documents (equipment_instance_id, doc_type, title, doc_code, version, file_name, file_path, file_size, mime_type, file_hash, uploaded_by, status, approval_status)
    VALUES (1, 'drawing', ?, 'DWG-VER', ?, 'ver.pdf', ?, 3, 'application/pdf', ?, 1, ?, 'draft')`)
    .run(title, version, storage.rel, `H-${version}-${Math.random()}`, status);
  const id = Number(result.lastInsertRowid);
  if (familyId) db.prepare("UPDATE documents SET document_family_id = ? WHERE id = ?").run(familyId, id);
  else db.prepare("UPDATE documents SET document_family_id = ? WHERE id = ?").run(id, id);
  return id;
}

test('VER.1 签发新版本自动作废旧版：current/obsolete/superseded_by', async () => {
  const db = freshDb();
  const { app, routes } = captureApp();
  documentService.register(app, db);
  const a0 = createDoc(db, { version: 'A0' });
  let res = await call(routes, 'PUT', '/api/documents/:id/issue', { params: { id: a0 }, body: { issued_to: 'assembly' } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  let row = db.prepare("SELECT status,is_current,version_locked FROM documents WHERE id=?").get(a0);
  assert.equal(row.status, 'issued');
  assert.equal(row.is_current, 1);
  assert.equal(row.version_locked, 1);

  const a1 = createDoc(db, { version: 'A1', familyId: a0 });
  res = await call(routes, 'PUT', '/api/documents/:id/issue', { params: { id: a1 }, body: { issued_to: 'assembly' } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const old = db.prepare("SELECT status,is_current,superseded_by FROM documents WHERE id=?").get(a0);
  assert.equal(old.status, 'obsolete');
  assert.equal(old.is_current, 0);
  assert.equal(old.superseded_by, a1);
  row = db.prepare("SELECT status,is_current FROM documents WHERE id=?").get(a1);
  assert.equal(row.status, 'issued');
  assert.equal(row.is_current, 1);

  res = await call(routes, 'GET', '/api/documents/:id/next-version', { params: { id: a1 } });
  assert.equal(res.body.suggested_version, 'A2');

  res = await call(routes, 'GET', '/api/documents/:id/version-ledger', { params: { id: a1 } });
  assert.equal(res.body.current.id, a1);
  assert.equal(res.body.versions.length, 2);
  db.close();
});

test('VER.2 历史版本下载限制 + 版本锁定/解锁 + 回滚', async () => {
  const db = freshDb();
  const { app, routes } = captureApp();
  documentService.register(app, db);
  const a0 = createDoc(db, { version: 'A0' });
  await call(routes, 'PUT', '/api/documents/:id/issue', { params: { id: a0 }, body: { issued_to: 'assembly' } });
  const a1 = createDoc(db, { version: 'A1', familyId: a0 });
  await call(routes, 'PUT', '/api/documents/:id/issue', { params: { id: a1 }, body: { issued_to: 'assembly' } });

  await assert.rejects(
    () => call(routes, 'GET', '/api/documents/:id/download', { params: { id: a0 }, user: { uid: 2, role: 'worker', permissions: [] } }),
    /历史版本仅质量/,
  );

  let res = await call(routes, 'POST', '/api/documents/:id/unlock', { params: { id: a1 } });
  assert.equal(res.body.version_locked, 0);
  res = await call(routes, 'POST', '/api/documents/:id/lock', { params: { id: a1 } });
  assert.equal(res.body.version_locked, 1);

  res = await call(routes, 'POST', '/api/documents/:id/rollback', { params: { id: a1 }, body: { source_document_id: a0, reason: '客户要求回退' } });
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assert.equal(res.body.version, 'A2');
  assert.equal(res.body.status, 'draft');
  const rolled = db.prepare("SELECT parent_document_id,revision_note,file_path FROM documents WHERE id=?").get(res.body.id);
  assert.equal(rolled.parent_document_id, a1);
  assert.match(rolled.revision_note, /回滚自 vA0/);
  assert.ok(resolveStoredFile(rolled.file_path));
  db.close();
});

test('VER.3 版本号递增规则：A9→B0、版本必须大于当前版', async () => {
  const db = freshDb();
  const { app, routes } = captureApp();
  documentService.register(app, db);
  const a9 = createDoc(db, { version: 'A9' });
  await call(routes, 'PUT', '/api/documents/:id/issue', { params: { id: a9 }, body: { issued_to: 'assembly' } });
  const same = createDoc(db, { version: 'A9', familyId: a9 });
  await assert.rejects(
    () => call(routes, 'PUT', '/api/documents/:id/issue', { params: { id: same }, body: { issued_to: 'assembly' } }),
    /必须大于当前版本/,
  );
  let res = await call(routes, 'GET', '/api/documents/:id/next-version', { params: { id: a9 } });
  assert.equal(res.body.suggested_version, 'B0');
  const b0 = createDoc(db, { version: 'B0', familyId: a9 });
  res = await call(routes, 'PUT', '/api/documents/:id/issue', { params: { id: b0 }, body: { issued_to: 'assembly' } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  db.close();
});
