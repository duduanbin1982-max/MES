"use strict";
// routes/health.js
// 健康检查: GET /api/health (在 auth 白名单, 无 token 也可访问)
// Author: 三狗子 | Date: 2026-06-24

function register(app, db) {
  const { wrap } = require('./_helpers')(db);

  app.get('/api/health', wrap((req, res) => {
    const t = db.prepare("SELECT count(*) c FROM sqlite_master WHERE type='table'").get().c;
    const instances = db.prepare('SELECT count(*) c FROM equipment_instances').get().c;
    res.json({ status: 'ok', service: 'tbm-mes', version: '2.1.0', tables: t, instances, time: new Date().toISOString() });
  }));
}

module.exports = { register };