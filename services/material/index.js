'use strict';
// services/material/index.js

const inventory = require('./inventory');

const logger = require("../../app/logger").createLogger("material");

function register(app, db) {
  inventory.register(app, db);
  logger.info('[material] Registered: inventory + movements');
}

module.exports = { register };
