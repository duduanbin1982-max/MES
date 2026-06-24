// services/equipment/scheduler/index.js
// 装配子模块 register
const scheduler = require('./scheduler')

function register(app, db) {
  scheduler.register(app, db)
}

module.exports = { register }