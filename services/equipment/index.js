'use strict';
// services/equipment/index.js
// Aggregates equipment sub-modules for register-all.js auto-discovery

const service = require('./service');
const scheduler = require('./scheduler');
const multiInstanceScheduler = require('./multiInstanceScheduler');
const workstationOee = require('./oee');

const logger = require("../../app/logger").createLogger("equipment");

const moduleNames = ['service', 'scheduler', 'multiInstanceScheduler', 'workstationOee'];

function register(app, db) {
  service.register(app, db);
  // 2026-11-05（审计 F-01）：单项目「重新排程」路由此前从未注册，导致线上 404
  scheduler.register(app, db);
  multiInstanceScheduler.register(app, db);
  workstationOee.register(app, db);
  logger.info('[equipment] Registered: instances + types + scheduler + multi-scheduler + workstation OEE');
}

module.exports = { register, moduleNames };
