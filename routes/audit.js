"use strict";
// routes/audit.js
// P1-4 审计日志查询 (audit:read)
//   GET /api/audit/logs?user_id&action&resource_type&resource_id&status&from&to&limit&offset
// Author: 三狗子 | Date: 2026-06-25

const { requirePermission } = require('../middleware/auth');
const audit = require('../app/audit');

function register(app, db) {
  app.get('/api/audit/logs', requirePermission('audit:read'), (req, res) => {
    const q = {
      user_id:       req.query.user_id ? Number(req.query.user_id) : undefined,
      action:        req.query.action,
      resource_type: req.query.resource_type,
      resource_id:   req.query.resource_id,
      status:        req.query.status,
      from:          req.query.from,
      to:            req.query.to,
      limit:         req.query.limit,
      offset:        req.query.offset,
    };
    const result = audit.query(db, q);
    res.json(result);
  });
}

module.exports = { register };