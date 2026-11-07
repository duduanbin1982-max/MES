'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.DOCUMENT_UPLOAD_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-ent-'));
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
    CREATE TABLE instance_bom (id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_instance_id INTEGER, parent_id INTEGER, tier INTEGER, part_number TEXT, material_id INTEGER, quantity REAL);
    CREATE TABLE instance_eco (id INTEGER PRIMARY KEY, change_no TEXT, title TEXT);
    CREATE TABLE work_orders (id INTEGER PRIMARY KEY, order_no TEXT, status TEXT);
    CREATE TABLE process_nodes (id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_instance_id INTEGER, bom_node_id INTEGER, operation_name TEXT, status TEXT);
    CREATE TABLE workstations (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, name TEXT);
    CREATE TABLE suppliers (id INTEGER PRIMARY KEY, supplier_name TEXT, status TEXT);
    CREATE TABLE purchase_orders (id INTEGER PRIMARY KEY, order_no TEXT);
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
  db.prepare("INSERT INTO instance_bom (id, equipment_instance_id, tier, part_number) VALUES (10, 1, 2, 'P-10')").run();
  db.prepare("INSERT INTO instance_eco (id, change_no, title) VALUES (5, 'ECO-5', '设计变更')").run();
  db.prepare("INSERT INTO work_orders (id, order_no, status) VALUES (7, 'WO-7', 'in_progress')").run();
  db.prepare("INSERT INTO workstations (id, code, name) VALUES (3, 'WS-3', '焊接工位')").run();
  db.prepare("INSERT INTO suppliers (id, supplier_name, status) VALUES (9, '某外协厂', 'active')").run();
  db.prepare("INSERT INTO purchase_orders (id, order_no) VALUES (11, 'PO-11')").run();
  return db;
}
function createDoc(db, overrides = {}) {
  const storage = buildStoragePath(`ent-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`);
  fs.mkdirSync(path.dirname(storage.abs), { recursive: true });
  fs.writeFileSync(storage.abs, 'PDF');
  const doc = {
    equipment_instance_id: 1, doc_type: 'drawing', title: '总装图纸', doc_code: 'DWG-ENT', version: 'A0',
    file_name: 'dwg.pdf', file_path: storage.rel, file_size: 3, mime_type: 'application/pdf', file_hash: `H${Math.random()}`,
    uploaded_by: 1, status: 'issued', bom_node_id: 10, eco_id: 5, work_order_id: 7, tags: '总装,关键件',
    effective_from: '2026-01-01', effective_to: '2027-12-31', ...overrides,
  };
  const keys = Object.keys(doc);
  const result = db.prepare(`INSERT INTO documents (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((key) => doc[key]));
  return Number(result.lastInsertRowid);
}

test('ENT.1 现场扫码/借阅归还/离线同步', async () => {
  const db = freshDb();
  const { app, routes } = captureApp();
  documentService.register(app, db);
  const docId = createDoc(db);

  let res = await call(routes, 'GET', '/api/documents/scan/:code', { params: { code: 'EQ:1' } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.ok(res.body.groups.drawing.some((doc) => doc.id === docId));
  res = await call(routes, 'GET', '/api/documents/scan/:code', { params: { code: 'BOM:10' } });
  assert.equal(res.body.bom_node.id, 10);

  res = await call(routes, 'POST', '/api/documents/:id/borrow', { params: { id: docId }, body: { copy_no: 'C-01' } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  res = await call(routes, 'GET', '/api/documents/borrowings', { query: { status: 'open' } });
  assert.equal(res.body.total, 1);
  res = await call(routes, 'POST', '/api/documents/:id/return', { params: { id: docId } });
  assert.equal(res.statusCode, 200);

  res = await call(routes, 'POST', '/api/documents/offline-sync', { user: { uid: 2, role: 'worker', permissions: [] }, body: { actions: [
    { client_action_id: 'c1', doc_id: docId, action: 'ack' },
    { client_action_id: 'c2', doc_id: docId, action: 'annotation', payload: { content: '现场发现焊缝问题', photos: ['/uploads/a.jpg'] } },
  ] } });
  assert.equal(res.body.applied, 2);
  res = await call(routes, 'POST', '/api/documents/offline-sync', { user: { uid: 2, role: 'worker', permissions: [] }, body: { actions: [{ client_action_id: 'c1', doc_id: docId, action: 'ack' }] } });
  assert.equal(res.body.results[0].status, 'duplicate');
  db.close();
});

test('ENT.2 供应商文档关联/审批/签收/到期', async () => {
  const db = freshDb();
  const { app, routes } = captureApp();
  documentService.register(app, db);
  const docId = createDoc(db, { effective_to: '2026-12-01' });
  let res = await call(routes, 'PUT', '/api/documents/:id/supplier', { params: { id: docId }, body: { supplier_id: 9, purchase_order_id: 11 } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  res = await call(routes, 'POST', '/api/documents/:id/supplier/review', { params: { id: docId }, body: { approve: true, comment: '合格' } });
  assert.equal(res.body.supplier_status, 'approved');
  res = await call(routes, 'POST', '/api/documents/:id/supplier/ack', { params: { id: docId }, body: { note: '已收到' } });
  assert.equal(res.statusCode, 200);
  res = await call(routes, 'GET', '/api/documents/supplier', { query: { supplier_id: 9 } });
  assert.equal(res.body.total, 1);
  res = await call(routes, 'GET', '/api/documents/supplier-expiring', { query: { days: 60 } });
  assert.ok(res.body.total >= 1);
  db.close();
});

test('ENT.3 法律保留 + 归档包哈希 + 搜索/相关/批量', async () => {
  const db = freshDb();
  const { app, routes } = captureApp();
  documentService.register(app, db);
  const docId = createDoc(db);
  let res = await call(routes, 'POST', '/api/documents/:id/legal-hold', { params: { id: docId }, body: { reason: '质量追溯', scope: '合同' } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const holdId = res.body.id;
  res = await call(routes, 'GET', '/api/documents/:id/archive-package', { params: { id: docId } });
  assert.equal(res.statusCode, 200);
  const hash = res.body.package_hash;
  assert.ok(hash);
  res = await call(routes, 'GET', '/api/documents/:id/archive-package/verify', { params: { id: docId }, query: { hash } });
  assert.equal(res.body.valid, true, JSON.stringify(res.body));
  res = await call(routes, 'DELETE', '/api/document-legal-holds/:id', { params: { id: holdId } });
  assert.equal(res.body.status, 'released');

  res = await call(routes, 'GET', '/api/documents/facets');
  assert.ok(res.body.total >= 1);
  res = await call(routes, 'GET', '/api/documents/:id/related', { params: { id: docId } });
  assert.equal(res.statusCode, 200);
  res = await call(routes, 'POST', '/api/documents/batch/archive', { body: { ids: [docId] } });
  assert.equal(res.body.results[0].status, 'archived');
  db.close();
});
