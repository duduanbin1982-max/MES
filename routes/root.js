"use strict";
// routes/root.js
// 服务根路由 + favicon + SPA fallback
//   GET  /
//   GET  /favicon.ico
//   GET  /*  (非 /api, 走前端 index.html, 仅 DIST 存在时挂载)
// Author: 三狗子 | Date: 2026-06-24

const path = require('path');
const { DIST, DIST_EXISTS } = require('../app');

function register(app) {
  app.get('/', (req, res) => {
    res.json({
      service: 'TBM-MES',
      version: '2.1.0',
      phase: 'phase-1 + RBAC + Settings (v2.2)',
      core_entity: 'equipment_instances',
      api: '/api',
      docs: '见 /api/health',
    });
  });

  app.get('/favicon.ico', (req, res) => res.status(204).end());

  if (DIST_EXISTS) {
    app.get(/^(?!\/api).*/, (req, res) => {
      res.sendFile(path.join(DIST, 'index.html'));
    });
    console.log('[frontend] serving from', DIST);
  }
}

module.exports = { register };