'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.DOCUMENT_UPLOAD_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-p1-'));
const documentService = require('../services/documentService');
const { buildStoragePath } = require('../services/documentService/storage');

function mkRes() {
  const res = { statusCode: 200 };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  res.sendStatus = (code) => { res.statusCode = code; return res; };
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
  db.prepare("INSERT INTO process_nodes (equipment_instance_id, bom_node_id, operation_name, status) VALUES (1, 10, '焊接', 'pending')").run();
  return db;
}
function createDoc(db, overrides = {}) {
  const storage = buildStoragePath(`doc-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`);
  fs.mkdirSync(path.dirname(storage.abs), { recursive: true });
  fs.writeFileSync(storage.abs, 'PDF');
  const doc = {
    equipment_instance_id: 1, doc_type: 'drawing', title: '刀盘图纸', doc_code: 'DWG-100', version: 'A0',
    file_name: 'dwg.pdf', file_path: storage.rel, file_size: 3, mime_type: 'application/pdf', file_hash: `H${Math.random()}`,
    uploaded_by: 1, status: 'draft', bom_node_id: 10, eco_id: 5, work_order_id: 7,
    ...overrides,
  };
  const keys = Object.keys(doc);
  const result = db.prepare(`INSERT INTO documents (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((key) => doc[key]));
  return Number(result.lastInsertRowid);
}

test('DOCP1.1 批注 + 两版对比', async () => {
  const db = freshDb();
  const { app, routes } = captureApp();
  try { documentService.register(app, db); } catch (error) { console.error('REG ERR', error.stack); throw error; }
  let a;
  try { a = createDoc(db); } catch (error) { console.error('CREATE ERR', error.stack); throw error; }
  const b = createDoc(db, { version: 'A1', title: '刀盘图纸修订', file_hash: 'H2', status: 'issued' });

  let res = await call(routes, 'POST', '/api/documents/:id/annotations', { params: { id: a }, body: { content: '开口尺寸需确认', annotation_type: 'issue', page_no: 1, x_pct: 30, y_pct: 40 } });
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  const annotationId = res.body.id;
  res = await call(routes, 'GET', '/api/documents/:id/annotations', { params: { id: a } });
  assert.equal(res.body.total, 1);
  res = await call(routes, 'PATCH', '/api/document-annotations/:id', { params: { id: annotationId }, body: { status: 'resolved', content: '已确认，按图施工' } });
  assert.equal(res.body.status, 'resolved');

  res = await call(routes, 'GET', '/api/documents/:id/compare', { params: { id: a }, query: { with_document_id: b } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.file_changed, true);
  assert.ok(res.body.changes.some((item) => item.field === 'version'));
  assert.equal(res.body.annotations.left, 1);
  db.close();
});

test('DOCP1.2 关联 BOM/ECO/工艺/工单 + 按 BOM 反查', async () => {
  const db = freshDb();
  const { app, routes } = captureApp();
  documentService.register(app, db);
  const docId = createDoc(db);
  const links = await call(routes, 'GET', '/api/documents/:id/links', { params: { id: docId } });
  assert.equal(links.body.bom.part_number, 'P-10');
  assert.equal(links.body.eco.change_no, 'ECO-5');
  assert.equal(links.body.work_order.order_no, 'WO-7');
  assert.equal(links.body.process_nodes[0].operation_name, '焊接');

  const byBom = await call(routes, 'GET', '/api/documents/by-bom/:bomNodeId', { params: { bomNodeId: 10 } });
  assert.equal(byBom.body.total, 1);
  db.close();
});

test('DOCP1.3 密级 secret 拦截普通用户；预览策略禁止下载', async () => {
  const db = freshDb();
  const { app, routes } = captureApp();
  documentService.register(app, db);
  const docId = createDoc(db);
  let res = await call(routes, 'PUT', '/api/documents/:id/classification', { params: { id: docId }, body: { classification: 'secret', download_policy: 'preview_only' } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));

  await assert.rejects(() => call(routes, 'GET', '/api/documents/:id', { params: { id: docId }, user: { uid: 2, role: 'worker', permissions: [] } }), /无权查看/);
  await assert.rejects(() => call(routes, 'GET', '/api/documents/:id/download', { params: { id: docId }, user: { uid: 2, role: 'worker', permissions: [] } }), /无权下载/);

  res = await call(routes, 'GET', '/api/documents/:id/classification', { params: { id: docId } });
  assert.equal(res.body.classification, 'secret');
  db.close();
});
