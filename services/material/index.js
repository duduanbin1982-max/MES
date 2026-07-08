'use strict';
// services/material/index.js

const inventory = require('./inventory');

function register(app, db) {
  inventory.register(app, db);
  console.log('[material] Registered: inventory + movements');
}

module.exports = { register };
