// services/tbmAdvanced/index.js
// TBM 增强模块 — 5 子模块分发 (brooks-audit R2)
'use strict';

const { runMigration } = require('./_migration');

function register(app, db) {
  runMigration(db);
  require('./criticalParts').registerRoutes(app, db);
  require('./purchaseTracking').registerRoutes(app, db);
  require('./projectDashboard').registerRoutes(app, db);
  require('./acceptance').registerRoutes(app, db);
  require('./faultKB').registerRoutes(app, db);
}

module.exports = { register };
