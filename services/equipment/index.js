'use strict';
// services/equipment/index.js
// Aggregates equipment sub-modules for register-all.js auto-discovery

const service = require('./service');
const multiInstanceScheduler = require('./multiInstanceScheduler');
const workstationOee = require('./oee');

function register(app, db) {
  service.register(app, db);
  multiInstanceScheduler.register(app, db);
  workstationOee.register(app, db);
  console.log('[equipment] Registered: instances + types + multi-scheduler + workstation OEE');
}

module.exports = { register };
