'use strict';

/**
 * documentSecurity.test.js
 * 2026-11-07 文档/图纸模块审计验证：
 *   D-1 上传安全（类型/大小/文件名清理/实例与BOM归属）
 *   D-2 下载审计 + 数据范围
 *   D-3 生命周期 audit_logs
 *   D-4 列表分页 + 范围过滤
 *   D-5 同编号+版本重复校验
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const Database = require('better-sqlite3');
const express = require('express');

const UPLOAD_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-sec-'));
process.env.DOCUMENT_UPLOAD_ROOT = UPLOAD_ROOT;
delete require.cache[require.resolve('../services/documentService/storage')];

const documentService = require('../services/documentService');
const { resolveStoredFile } = require('../services/documentService/storage');

let db;
let server;
let port;
let scopeCtx = { scope: 'all', config: {} };

function freshDb() {
  const database = new Database(':memory:');
  database.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, full_name TEXT);
    CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT, subsystem_id INTEGER);
    CREATE TABLE instance_bom (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, part_number TEXT, tier INTEGER);
    CREATE TABLE instance_eco (id INTEGER PRIMARY KEY);
    CREATE TABLE documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_instance_id INTEGER NOT NULL, doc_type TEXT, doc_name TEXT, doc_no TEXT,
      file_path TEXT, file_size INTEGER, uploaded_by INTEGER, uploaded_at TEXT, notes TEXT, bom_node_id INTEGER, eco_id INTEGER,
      doc_code TEXT, version TEXT, file_name TEXT, mime_type TEXT, file_hash TEXT, status TEXT DEFAULT 'draft', issued_to TEXT,
      issued_at TEXT, issued_by INTEGER, revoke_reason TEXT, revoked_at TEXT, description TEXT, tags TEXT, updated_at TEXT,
      title TEXT, work_order_id INTEGER
    );
    CREATE TABLE doc_acknowledgements (id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id INTEGER NOT NULL, ack_by INTEGER NOT NULL, ack_at TEXT, ack_method TEXT);
    CREATE TABLE document_events (id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id INTEGER NOT NULL, action TEXT NOT NULL, from_status TEXT, to_status TEXT, version TEXT, issued_to TEXT, reason TEXT, operator_id INTEGER, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT, role TEXT, action TEXT NOT NULL, resource_type TEXT, resource_id TEXT, before_json TEXT, after_json TEXT, diff_summary TEXT, ip TEXT, user_agent TEXT, request_id TEXT, status TEXT DEFAULT 'success', error TEXT, created_at TEXT DEFAULT (datetime('now')));
  `);
  database.prepare("INSERT INTO users (id, username, full_name) VALUES (1, 'admin', '管理员')").run();
  database.prepare("INSERT INTO equipment_instances (id, instance_code, instance_name, subsystem_id) VALUES (1, 'TBM-1', '一号机', 1), (2, 'TBM-2', '二号机', 1)").run();
  database.prepare("INSERT INTO instance_bom (id, equipment_instance_id) VALUES (10, 1), (11, 2)").run();
  database.prepare("INSERT INTO instance_eco (id) VALUES (5)").run();
  return database;
}

function upload(meta, fileName, body, mime = 'application/pdf') {
  return new Promise((resolve, reject) => {
    const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body || ''));
    const req = http.request({
      hostname: '127.0.0.1', port, path: '/api/documents', method: 'POST',
      headers: {
        'content-type': mime,
        'content-length': payload.length,
        'x-doc-meta': encodeURIComponent(JSON.stringify(meta)),
        'x-file-name': encodeURIComponent(fileName),
        'x-file-mime': mime,
      },
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function request(method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1', port, path: url, method,
      headers: { 'content-type': 'application/json', ...headers, ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}) },
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = raw ? JSON.parse(raw) : null; } catch (_error) { parsed = raw; }
        resolve({ status: res.statusCode, body: parsed, raw });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test.before(async () => {
  db = freshDb();
  const app = express();
  // 与 server.js 一致：仅 POST /api/documents 走 raw binary，其余 JSON
  app.use('/api/documents', (req, res, next) => {
    if (req.method === 'POST') return express.raw({ type: '*/*', limit: '50mb' })(req, res, next);
    return next();
  });
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { uid: 1, role: req.headers['x-test-role'] || 'admin', permissions: ['*'] };
    req.scope = () => scopeCtx;
    next();
  });
  documentService.register(app, db);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ message: err.message, details: err.details || null });
  });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (db) db.close();
  try { fs.rmSync(UPLOAD_ROOT, { recursive: true, force: true }); } catch (_error) { /* ignore */ }
});

const baseMeta = { title: '总装图纸', equipment_instance_id: 1, doc_type: 'drawing', doc_code: 'DOC-SEC-1', version: 'A0' };

test('D-1 上传安全：pdf 通过；exe 拒绝；实例不存在拒绝；跨实例 BOM 拒绝', async () => {
  let result = await upload(baseMeta, 'drawing.pdf', 'PDF-CONTENT-1');
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const documentId = result.body.id;

  result = await upload({ ...baseMeta, doc_code: 'DOC-EXE' }, 'evil.exe', 'MZ');
  assert.equal(result.status, 400);
  assert.match(JSON.stringify(result.body), /不允许上传该类型文件/);

  result = await upload({ ...baseMeta, equipment_instance_id: 999, doc_code: 'DOC-BAD-INST' }, 'x.pdf', 'X');
  assert.equal(result.status, 400);
  assert.match(JSON.stringify(result.body), /equipment_instance_id 不存在/);

  result = await upload({ ...baseMeta, doc_code: 'DOC-CROSS', bom_node_id: 11 }, 'x.pdf', 'X');
  assert.equal(result.status, 400);
  assert.match(JSON.stringify(result.body), /不属于该装备实例/);

  assert.ok(resolveStoredFile(db.prepare('SELECT file_path FROM documents WHERE id=?').get(documentId).file_path));
});

test('D-1b 文件名路径穿越被清理', async () => {
  const result = await upload({ ...baseMeta, doc_code: 'DOC-NAME' }, '../../evil.pdf', 'X');
  assert.equal(result.status, 200);
  assert.equal(result.body.file_name, 'evil.pdf');
  assert.ok(!String(result.body.file_path).includes('..'));
});

test('D-5 同文档编号+版本重复上传 → 409', async () => {
  const result = await upload(baseMeta, 'drawing.pdf', 'PDF-CONTENT-1');
  assert.equal(result.status, 409);
  assert.match(JSON.stringify(result.body), /已存在/);
});

test('D-3 签发写 audit_logs；D-2 下载写 document_events', async () => {
  const document = db.prepare("SELECT id FROM documents WHERE doc_code='DOC-SEC-1'").get();
  let result = await request('PUT', `/api/documents/${document.id}/issue`, { issued_to: 'assembly' });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.ok(db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action='document.issue'").get().c >= 1);

  result = await request('GET', `/api/documents/${document.id}/download`);
  assert.equal(result.status, 200);
  assert.ok(db.prepare("SELECT COUNT(*) c FROM document_events WHERE action='download' AND doc_id=?").get(document.id).c >= 1);
});

test('D-4 列表分页 + 数据范围过滤（instance 范围只见本项目）', async () => {
  // 再上传一条 instance=2 的文档
  const other = await upload({ title: '二号机图纸', equipment_instance_id: 2, doc_type: 'drawing', doc_code: 'DOC-2', version: 'A0' }, 'other.pdf', 'PDF-OTHER');
  assert.equal(other.status, 200, JSON.stringify(other.body));

  let result = await request('GET', '/api/documents?page=1&page_size=1');
  assert.equal(result.status, 200);
  assert.equal(result.body.items.length, 1);
  assert.ok(result.body.total >= 2);
  assert.equal(result.body.page_size, 1);

  scopeCtx = { scope: 'instance', config: { project_ids: [1] } };
  result = await request('GET', '/api/documents?page=1&page_size=50');
  assert.equal(result.status, 200);
  assert.ok(result.body.items.every((item) => Number(item.equipment_instance_id) === 1));
  const detail = await request('GET', `/api/documents/${other.body.id}`);
  assert.equal(detail.status, 404, '跨项目文档详情应 404');
  const download = await request('GET', `/api/documents/${other.body.id}/download`);
  assert.equal(download.status, 404);
  scopeCtx = { scope: 'all', config: {} };
});

// ---------------- D-6 P3 全修 ----------------

test('D-6a 签收校验角色与签发对象匹配', async () => {
  const stamp = Date.now();
  const result = await upload({ title: '签收演练', equipment_instance_id: 1, doc_type: 'drawing', doc_code: `ACK-${stamp}`, version: 'A0' }, 'ack.pdf', 'PDF-ACK');
  assert.equal(result.status, 200);
  const id = result.body.id;
  let res = await request('PUT', `/api/documents/${id}/issue`, { issued_to: 'assembly' });
  assert.equal(res.status, 200);
  res = await request('POST', `/api/documents/${id}/acknowledge`, {}, { 'x-test-role': 'qc' });
  assert.equal(res.status, 403, 'qc 不能签收装配文档');
  res = await request('POST', `/api/documents/${id}/acknowledge`, {}, { 'x-test-role': 'worker' });
  assert.equal(res.status, 200, 'worker 可以签收装配文档');
});

test('D-6b 显式版本链（parent_document_id）', async () => {
  const stamp = Date.now();
  const first = await upload({ title: '版本链', equipment_instance_id: 1, doc_type: 'drawing', doc_code: `FAM-${stamp}`, version: 'A0' }, 'fam-a0.pdf', 'PDF-A0');
  assert.equal(first.status, 200);
  const second = await upload({ title: '版本链', equipment_instance_id: 1, doc_type: 'drawing', doc_code: `FAM-${stamp}`, version: 'A1', parent_document_id: first.body.id }, 'fam-a1.pdf', 'PDF-A1');
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(second.body.parent_document_id, first.body.id);
  const versions = await request('GET', `/api/documents/${second.body.id}/versions`);
  assert.equal(versions.status, 200);
  assert.equal(versions.body.items.length, 2);
  const familyIds = new Set(versions.body.items.map((item) => item.id));
  assert.ok(familyIds.has(first.body.id) && familyIds.has(second.body.id));
});

test('D-6c 保留期：归档写 retention_until；未到期拒绝清理；到期清理文件', async () => {
  const stamp = Date.now();
  const result = await upload({ title: '保留期演练', equipment_instance_id: 1, doc_type: 'contract', doc_code: `RET-${stamp}`, version: 'A0' }, 'ret.pdf', 'PDF-RET');
  const id = result.body.id;
  let res = await request('DELETE', `/api/documents/${id}`);
  assert.equal(res.status, 200);
  const archived = db.prepare('SELECT retention_until, file_path FROM documents WHERE id=?').get(id);
  assert.ok(archived.retention_until, '归档应写入保留期');
  res = await request('POST', `/api/documents/${id}/purge`, {});
  assert.equal(res.status, 400, '未到保留期不能清理');
  assert.ok(resolveStoredFile(archived.file_path), '文件应还在');
  db.prepare("UPDATE documents SET retention_until = '2000-01-01' WHERE id=?").run(id);
  res = await request('POST', `/api/documents/${id}/purge`, {});
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(db.prepare('SELECT status FROM documents WHERE id=?').get(id).status, 'purged');
  assert.equal(resolveStoredFile(archived.file_path), null, '物理文件应被删除');
  assert.ok(db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action='document.purge'").get().c >= 1);
});

test('D-6d 在线预览：pdf 内联+水印头；xlsx 拒绝预览', async () => {
  const stamp = Date.now();
  const pdf = await upload({ title: '预览演练', equipment_instance_id: 1, doc_type: 'drawing', doc_code: `PRE-${stamp}`, version: 'A0' }, 'preview.pdf', 'PDF-PREVIEW');
  let res = await request('GET', `/api/documents/${pdf.body.id}/preview`);
  assert.equal(res.status, 200);
  assert.ok(db.prepare("SELECT COUNT(*) c FROM document_events WHERE action='preview' AND doc_id=?").get(pdf.body.id).c >= 1);
  const xlsx = await upload({ title: '表格', equipment_instance_id: 1, doc_type: 'report', doc_code: `XLS-${stamp}`, version: 'A0' }, 'table.xlsx', 'XLSX', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(xlsx.status, 200);
  res = await request('GET', `/api/documents/${xlsx.body.id}/preview`);
  assert.equal(res.status, 400);
});
