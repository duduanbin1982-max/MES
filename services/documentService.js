"use strict";
// services/documentService.js
// P0 第 1 件: 文档/图纸管理 (PLM 基础)
//   关联 3 维: 设备实例 / BOM 节点 / ECO
//   类型: drawing/sop/process/qc_std/contract/report/other
//   状态: draft/issued/revoked/archived
//   端点:
//     POST   /api/documents              上传 (multipart) - 需 multer 中间件在 server.js 挂
//     GET    /api/documents              列表 (按 instance/bom_node/type/status 过滤)
//     GET    /api/documents/:id          详情
//     GET    /api/documents/:id/download 下载
//     GET    /api/documents/:id/versions 同文件历史版本
//     PUT    /api/documents/:id/issue    签发
//     PUT    /api/documents/:id/revoke   收回
//     DELETE /api/documents/:id          软删除 (status=archived)
// Author: 三狗子 | Date: 2026-06-25

const { ApiError } = require('../app/errors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 上传根目录
const UPLOAD_ROOT = path.join('/home/dubin/factory-mes/data', 'uploads');

// 文档类型枚举
const DOC_TYPES = ['drawing', 'sop', 'process', 'qc_std', 'contract', 'report', 'other'];
const DOC_STATUS = ['draft', 'issued', 'revoked', 'archived'];
const ISSUE_TARGETS = ['assembly', 'welding', 'qc', 'warehouse', 'field', 'design', 'procurement', 'management'];

// 工具: 计算 sha256
function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// 工具: 存储路径 (按日期分目录)
function buildStoragePath(fileName) {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const ts = now.getTime() + '_' + Math.random().toString(36).slice(2, 8);
  const ext = path.extname(fileName) || '';
  const safe = ts + ext;
  const dir = path.join(UPLOAD_ROOT, yyyy, mm);
  fs.mkdirSync(dir, { recursive: true });
  return { dir, rel: path.join('uploads', yyyy, mm, safe), abs: path.join(dir, safe) };
}

// 验证 metadata
function validateMeta(meta) {
  const errors = [];
  if (!meta.title || String(meta.title).trim().length === 0) errors.push('title 必填');
  if (!meta.doc_type || !DOC_TYPES.includes(meta.doc_type)) errors.push(`doc_type 必须是: ${DOC_TYPES.join('/')}`);
  if (meta.status && !DOC_STATUS.includes(meta.status)) errors.push(`status 必须是: ${DOC_STATUS.join('/')}`);
  if (meta.issued_to && !ISSUE_TARGETS.includes(meta.issued_to)) errors.push(`issued_to 必须是: ${ISSUE_TARGETS.join('/')}`);
  if (meta.bom_node_id !== undefined && meta.bom_node_id !== null && !Number.isInteger(Number(meta.bom_node_id))) {
    errors.push('bom_node_id 必须是整数');
  }
  if (meta.equipment_instance_id !== undefined && meta.equipment_instance_id !== null && !Number.isInteger(Number(meta.equipment_instance_id))) {
    errors.push('equipment_instance_id 必须是整数');
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

// 工具: 把 mime 转 icon
function mimeToIcon(mime) {
  if (!mime) return '📄';
  if (mime.includes('pdf')) return '📕';
  if (mime.startsWith('image/')) return '🖼️';
  if (mime.includes('dwg') || mime.includes('cad')) return '📐';
  if (mime.includes('zip') || mime.includes('rar')) return '🗜️';
  if (mime.includes('excel') || mime.includes('spreadsheet')) return '📊';
  if (mime.includes('word') || mime.includes('document')) return '📝';
  return '📄';
}

function humanSize(bytes) {
  if (!bytes) return '-';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let n = bytes;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(n < 10 ? 2 : 1) + ' ' + u[i];
}

function register(app, db) {
  // 列表 (P0-文档: 兼容老 schema uploaded_at 替 created_at, 读用 COALESCE)
  app.get('/api/documents', (req, res) => {
    const { equipment_instance_id, bom_node_id, eco_id, doc_type, status, q } = req.query;
    let sql = `SELECT d.*, u1.full_name AS created_by_name, u2.full_name AS issued_by_name,
                      b.part_number AS bom_part_number, b.tier AS bom_tier,
                      ei.instance_code, ei.instance_name,
                      COALESCE(d.uploaded_at, d.uploaded_at) AS created_at_alias
               FROM documents d
               LEFT JOIN users u1 ON u1.id = COALESCE(d.uploaded_by, d.uploaded_by)
               LEFT JOIN users u2 ON u2.id = d.issued_by
               LEFT JOIN instance_bom b ON b.id = d.bom_node_id
               LEFT JOIN equipment_instances ei ON ei.id = d.equipment_instance_id
               WHERE 1=1`;
    const params = [];
    if (equipment_instance_id) { sql += ' AND d.equipment_instance_id = ?'; params.push(equipment_instance_id); }
    if (bom_node_id) { sql += ' AND d.bom_node_id = ?'; params.push(bom_node_id); }
    if (eco_id) { sql += ' AND d.eco_id = ?'; params.push(eco_id); }
    if (doc_type) { sql += ' AND d.doc_type = ?'; params.push(doc_type); }
    if (status) { sql += ' AND d.status = ?'; params.push(status); }
    if (q) { sql += ' AND (d.title LIKE ? OR d.doc_code LIKE ? OR d.file_name LIKE ?)'; params.push('%' + q + '%', '%' + q + '%', '%' + q + '%'); }
    sql += " ORDER BY COALESCE(d.uploaded_at, d.uploaded_at) DESC LIMIT 500";
    const rows = db.prepare(sql).all(...params);
    // 附加字段
    rows.forEach(r => {
      r.icon = mimeToIcon(r.mime_type);
      r.human_size = humanSize(r.file_size);
    });
    res.json({ items: rows, total: rows.length });
  });

  // 统计 (按状态/类型) - 必须在 :id 之前注册避免 :id 拦截
  app.get('/api/documents/stats', (req, res) => {
    const byStatus = db.prepare(`SELECT status, COUNT(*) AS count FROM documents GROUP BY status`).all();
    const byType = db.prepare(`SELECT doc_type, COUNT(*) AS count FROM documents GROUP BY doc_type`).all();
    const totalSize = db.prepare(`SELECT COALESCE(SUM(file_size), 0) AS bytes FROM documents WHERE status != 'archived'`).get();
    res.json({ by_status: byStatus, by_type: byType, total_bytes: totalSize.bytes, human_total: humanSize(totalSize.bytes) });
  });

  // 详情
  app.get('/api/documents/pending-ack', (req, res) => {
    var uid = req.user ? req.user.id : 1;
    var docs = db.prepare(`SELECT d.*, ei.instance_code FROM documents d LEFT JOIN equipment_instances ei ON d.equipment_instance_id = ei.id WHERE d.status = 'issued' AND d.id NOT IN (SELECT doc_id FROM doc_acknowledgements WHERE ack_by = ?) ORDER BY d.issued_at DESC LIMIT 50`).all(uid);
    res.json({ pending: docs, count: docs.length });
  });

  app.post('/api/documents/:id/acknowledge', (req, res) => {
    var doc = db.prepare('SELECT id FROM documents WHERE id = ?').get(req.params.id);
    if (!doc) return res.status(404).json({error:'not found'});
    var uid = req.user ? req.user.id : 1;
    if (db.prepare('SELECT id FROM doc_acknowledgements WHERE doc_id = ? AND ack_by = ?').get(req.params.id, uid)) { res.json({ ok: true, already: true }); return; }
    db.prepare('INSERT INTO doc_acknowledgements (doc_id, ack_by) VALUES (?, ?)').run(req.params.id, uid);
    res.json({ ok: true });
  });

  app.get('/api/documents/:id/acknowledgements', (req, res) => {
    var acks = db.prepare('SELECT da.*, u.full_name, u.username FROM doc_acknowledgements da LEFT JOIN users u ON da.ack_by = u.id WHERE da.doc_id = ? ORDER BY da.ack_at DESC').all(req.params.id);
    res.json({ doc_id: parseInt(req.params.id), total: acks.length, acknowledgements: acks });
  });

  db.exec(`CREATE TABLE IF NOT EXISTS doc_acknowledgements (id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id INTEGER NOT NULL, ack_by INTEGER NOT NULL, ack_at TEXT DEFAULT CURRENT_TIMESTAMP, ack_method TEXT DEFAULT 'web')`);
  app.get('/api/documents/:id', (req, res, next) => {
    const id = req.params.id;
    const r = db.prepare(`
      SELECT d.*, u1.full_name AS created_by_name, u2.full_name AS issued_by_name,
             b.part_number AS bom_part_number, b.tier AS bom_tier,
             ei.instance_code, ei.instance_name,
             COALESCE(d.uploaded_at, d.uploaded_at) AS created_at_alias
      FROM documents d
      LEFT JOIN users u1 ON u1.id = COALESCE(d.uploaded_by, d.uploaded_by)
      LEFT JOIN users u2 ON u2.id = d.issued_by
      LEFT JOIN instance_bom b ON b.id = d.bom_node_id
      LEFT JOIN equipment_instances ei ON ei.id = d.equipment_instance_id
      WHERE d.id = ?`).get(id);
    if (!r) return next(ApiError.notFound('文档不存在: ' + id));
    r.icon = mimeToIcon(r.mime_type);
    r.human_size = humanSize(r.file_size);
    res.json(r);
  });

  // 下载
  app.get('/api/documents/:id/download', (req, res, next) => {
    const id = req.params.id;
    const r = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
    if (!r) return next(ApiError.notFound('文档不存在: ' + id));
    const abs = path.join('/home/dubin/factory-mes/data', r.file_path);
    if (!fs.existsSync(abs)) return next(ApiError.notFound('文件已丢失: ' + r.file_name));
    res.setHeader('Content-Type', r.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(r.file_name)}"`);
    res.setHeader('Content-Length', r.file_size || fs.statSync(abs).size);
    fs.createReadStream(abs).pipe(res);
  });

  // 版本历史: 同一 file_hash + doc_code 的所有版本
  app.get('/api/documents/:id/versions', (req, res) => {
    const id = req.params.id;
    const cur = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
    if (!cur) return res.json({ items: [], current: null });
    let items = [];
    if (cur.doc_code) {
      items = db.prepare('SELECT id, version, file_name, file_size, status, COALESCE(uploaded_at, uploaded_at) AS created_at, COALESCE(uploaded_by, uploaded_by) AS created_by FROM documents WHERE doc_code = ? ORDER BY COALESCE(uploaded_at, uploaded_at) DESC').all(cur.doc_code);
    } else if (cur.file_hash) {
      items = db.prepare('SELECT id, version, file_name, file_size, status, COALESCE(uploaded_at, uploaded_at) AS created_at, COALESCE(uploaded_by, uploaded_by) AS created_by FROM documents WHERE file_hash = ? ORDER BY COALESCE(uploaded_at, uploaded_at) DESC').all(cur.file_hash);
    }
    items.forEach(r => { r.human_size = humanSize(r.file_size); });
    res.json({ items, current: id });
  });

  // 上传 (使用 server.js 提前挂的 multer-like raw body)
  // 客户端: POST /api/documents  Content-Type: application/octet-stream  |  X-Doc-Meta: <JSON>  |  X-File-Name: <name>  |  X-File-Mime: <mime>
  app.post('/api/documents', (req, res, next) => {
    try {
      // metadata 从 header X-Doc-Meta 读
      let meta = {};
      try { meta = JSON.parse(req.headers['x-doc-meta'] || '{}'); } catch (e) { return next(ApiError.validation('X-Doc-Meta 不是合法 JSON')); }
      const v = validateMeta(meta);
      if (!v.ok) return next(ApiError.validation('文档元数据校验失败', v.errors));

      const fileName = req.headers['x-file-name'] || (meta.title + '.bin');
      const mime = req.headers['x-file-mime'] || 'application/octet-stream';
      const buf = req.body;
      if (!buf || !Buffer.isBuffer(buf) || buf.length === 0) return next(ApiError.validation('请求体为空, 没收到文件数据'));

      const hash = sha256(buf);
      const { rel, abs } = buildStoragePath(fileName);
      fs.writeFileSync(abs, buf);

      // 检查同设备+同 hash+同 version 重复
      const dupe = db.prepare(`SELECT id, version FROM documents
                                WHERE equipment_instance_id = ? AND file_hash = ? AND version = ?`)
        .get(meta.equipment_instance_id, hash, meta.version || 'A0');
      if (dupe) return next(ApiError.conflict(`文件已存在 (id=${dupe.id} version=${dupe.version}), hash 相同`));

      // FK 校验 (bom_node_id, eco_id 必须存在)
      if (meta.bom_node_id) {
        const bom = db.prepare('SELECT id FROM instance_bom WHERE id = ?').get(meta.bom_node_id);
        if (!bom) return next(ApiError.validation('bom_node_id 不存在: ' + meta.bom_node_id));
      }
      if (meta.eco_id) {
        const eco = db.prepare('SELECT id FROM instance_eco WHERE id = ?').get(meta.eco_id);
        if (!eco) return next(ApiError.validation('eco_id 不存在: ' + meta.eco_id));
      }

      // 兼容老 schema: 同时写 doc_name / doc_no / uploaded_at / uploaded_by
      const userId = req.user?.uid || null;
      const stmt = db.prepare(`INSERT INTO documents (
        equipment_instance_id, bom_node_id, eco_id,
        doc_type, doc_code, title, version,
        file_name, file_path, file_size, mime_type, file_hash,
        status, issued_to, issued_at, issued_by,
        description, tags, uploaded_by,
        doc_name, doc_no, uploaded_by, uploaded_at
      ) VALUES (
        @equipment_instance_id, @bom_node_id, @eco_id,
        @doc_type, @doc_code, @title, @version,
        @file_name, @file_path, @file_size, @mime_type, @file_hash,
        @status, @issued_to, @issued_at, @issued_by,
        @description, @tags, @uploaded_by,
        @title, @doc_code, @uploaded_by, datetime('now')
      )`);
      const r = stmt.run({
        equipment_instance_id: meta.equipment_instance_id || null,
        bom_node_id: meta.bom_node_id || null,
        eco_id: meta.eco_id || null,
        doc_type: meta.doc_type,
        doc_code: meta.doc_code || null,
        title: meta.title,
        version: meta.version || 'A0',
        file_name: fileName,
        file_path: rel,
        file_size: buf.length,
        mime_type: mime,
        file_hash: hash,
        status: meta.status || 'draft',
        issued_to: meta.issued_to || null,
        issued_at: meta.status === 'issued' ? new Date().toISOString() : null,
        issued_by: meta.issued_by || userId,
        description: meta.description || null,
        tags: meta.tags ? JSON.stringify(meta.tags) : null,
        uploaded_by: userId,
      });
      const created = db.prepare('SELECT * FROM documents WHERE id = ?').get(r.lastInsertRowid);
      res.json(created);
    } catch (e) { next(e); }
  });

  // 签发
  app.put('/api/documents/:id/issue', (req, res, next) => {
    try {
      const id = req.params.id;
      const { issued_to } = req.body || {};
      if (!issued_to || !ISSUE_TARGETS.includes(issued_to)) return next(ApiError.validation('issued_to 必须是: ' + ISSUE_TARGETS.join('/')));
      const exist = db.prepare('SELECT id, status FROM documents WHERE id = ?').get(id);
      if (!exist) return next(ApiError.notFound('文档不存在'));
      if (exist.status === 'revoked' || exist.status === 'archived') return next(ApiError.unprocessable('已收回/归档的文档不能签发'));
      db.prepare(`UPDATE documents SET status='issued', issued_to=?, issued_at=datetime('now'), issued_by=?, updated_at=datetime('now') WHERE id=?`)
        .run(issued_to, req.user?.uid || null, id);
      res.json(db.prepare('SELECT * FROM documents WHERE id = ?').get(id));
    } catch (e) { next(e); }
  });

  // 收回 (ECO 变更/作废时)
  app.put('/api/documents/:id/revoke', (req, res, next) => {
    try {
      const id = req.params.id;
      const { reason } = req.body || {};
      const exist = db.prepare('SELECT id FROM documents WHERE id = ?').get(id);
      if (!exist) return next(ApiError.notFound('文档不存在'));
      db.prepare(`UPDATE documents SET status='revoked', revoke_reason=?, revoked_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
        .run(reason || '未指定原因', id);
      res.json(db.prepare('SELECT * FROM documents WHERE id = ?').get(id));
    } catch (e) { next(e); }
  });

  // 软删除
  app.delete('/api/documents/:id', (req, res, next) => {
    try {
      const id = req.params.id;
      const exist = db.prepare('SELECT id FROM documents WHERE id = ?').get(id);
      if (!exist) return next(ApiError.notFound('文档不存在'));
      db.prepare(`UPDATE documents SET status='archived', updated_at=datetime('now') WHERE id=?`).run(id);
      res.json({ id, status: 'archived' });
    } catch (e) { next(e); }
  });
}

// stats moved to before :id
module.exports = { register, validateMeta, DOC_TYPES, DOC_STATUS, ISSUE_TARGETS, sha256, humanSize, mimeToIcon, buildStoragePath };

