"use strict";
// app/audit.js
// P1-4 审计日志中间件
//   - record(db, req, entry) 写入一条审计日志
//   - 自动从 req 抓 user_id/username/role/ip/user_agent/request_id
//   - 失败不抛 (审计本身失败不能影响业务)
// Author: 三狗子 | Date: 2026-06-25

/**
 * 写一条审计日志
 * @param {Database} db
 * @param {Request} req  - express req (含 user/ip/headers)
 * @param {Object} entry
 *   - action: string 必填, e.g. 'role.permission.update'
 *   - resource_type?: string
 *   - resource_id?: string|number
 *   - before?: any  (会 JSON.stringify)
 *   - after?: any
 *   - diff_summary?: string
 *   - status?: 'success' | 'failed' (default 'success')
 *   - error?: string
 * @returns {number|null} 插入的 id, 失败 null
 */

const logger = require("./logger").createLogger("audit");

function record(db, req, entry) {
  if (!db) return null;
  const user = req?.user || {};
  const row = {
    user_id: user.uid || user.id || null,
    username: user.username || user.name || null,
    role: user.role || null,
    action: entry.action,
    resource_type: entry.resource_type || null,
    resource_id: entry.resource_id != null ? String(entry.resource_id) : null,
    before_json: entry.before !== undefined ? safeJson(entry.before) : null,
    after_json:  entry.after  !== undefined ? safeJson(entry.after)  : null,
    diff_summary: entry.diff_summary || null,
    ip: req?.ip || null,
    user_agent: req?.headers?.['user-agent'] || null,
    request_id: req?.id || req?.requestId || null,
    status: entry.status || 'success',
    error: entry.error || null,
  };
  try {
    const stmt = db.prepare(`INSERT INTO audit_logs
      (user_id, username, role, action, resource_type, resource_id,
       before_json, after_json, diff_summary, ip, user_agent, request_id, status, error)
      VALUES (@user_id, @username, @role, @action, @resource_type, @resource_id,
              @before_json, @after_json, @diff_summary, @ip, @user_agent, @request_id, @status, @error)`);
    const r = stmt.run(row);
    return Number(r.lastInsertRowid);
  } catch (e) {
    logger.error('[audit] 写入失败:', e.message, 'action:', entry.action);
    return null;
  }
}

function safeJson(v) {
  try { return JSON.stringify(v); } catch (_e) { return null; }
}

/**
 * 查审计日志 (分页 + 过滤)
 * @param {Database} db
 * @param {Object} q
 *   - user_id?, action?, resource_type?, resource_id?, status?
 *   - from?, to? (ISO date)
 *   - limit (default 50, max 200), offset (default 0)
 */
function query(db, q = {}) {
  if (!db) return { rows: [], total: 0 };
  const where = [];
  const params = {};
  if (q.user_id)       { where.push('user_id = @user_id');       params.user_id = q.user_id; }
  if (q.action)        { where.push('action = @action');         params.action = q.action; }
  if (q.resource_type) { where.push('resource_type = @rt');      params.rt = q.resource_type; }
  if (q.resource_id)   { where.push('resource_id = @rid');       params.rid = String(q.resource_id); }
  if (q.status)        { where.push('status = @status');         params.status = q.status; }
  if (q.from)          { where.push('created_at >= @from');      params.from = q.from; }
  if (q.to)            { where.push('created_at <= @to');        params.to = q.to; }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const limit = Math.min(Number(q.limit) || 50, 200);
  const offset = Number(q.offset) || 0;
  try {
    const rows = db.prepare(`SELECT * FROM audit_logs ${whereSql} ORDER BY id DESC LIMIT @limit OFFSET @offset`).all({ ...params, limit, offset });
    const total = db.prepare(`SELECT count(*) AS c FROM audit_logs ${whereSql}`).get(params).c;
    return { rows, total };
  } catch (e) {
    logger.error('[audit] 查询失败:', e.message);
    return { rows: [], total: 0 };
  }
}

/**
 * 高阶: wrap 一个 express handler, 自动在 success 后写 audit
 * 用法: app.put('/x', auth, audit(db, { action: 'xxx.update', resource_type: 'xxx', extractId: r => r.params.id }), handler)
 */
function wrap(db, meta, handler) {
  return async (req, res, next) => {
    let before = null;
    try {
      if (typeof meta.getBefore === 'function') {
        try { before = meta.getBefore(req); } catch (_) { before = null; }
      }
      // 拦截 res.json 拿 after
      const origJson = res.json.bind(res);
      let after = null;
      res.json = (body) => {
        after = body;
        return origJson(body);
      };
      await handler(req, res, next);
      // 写 audit
      const entry = {
        action: meta.action,
        resource_type: meta.resource_type,
        resource_id: meta.extractId ? meta.extractId(req, after) : (req.params?.id || null),
        before,
        after: meta.fullAfter ? after : (meta.extractAfter ? meta.extractAfter(after) : null),
        diff_summary: typeof meta.diff === 'function' ? meta.diff(before, after) : null,
      };
      // 失败状态
      if (res.statusCode >= 400) {
        entry.status = 'failed';
        entry.error = (after && (after.message || after.error)) || `HTTP ${res.statusCode}`;
      }
      record(db, req, entry);
    } catch (e) {
      record(db, req, { ...meta, status: 'failed', error: e.message });
      next(e);
    }
  };
}

module.exports = { record, query, wrap };