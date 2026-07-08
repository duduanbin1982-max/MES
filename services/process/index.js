"use strict";
// services/process/index.js
const nodeModule = require("./node");
const paramsModule = require("./params");

function register(app, db) {
  nodeModule.register(app, db);
  paramsModule.register(app, db);
}

module.exports = { register };
