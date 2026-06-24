// services/purchase/index.js
// 装配子模块
// Author: 三狗子 | Date: 2026-06-25

const suppliers = require('./suppliers')
const orders = require('./orders')

function register(app, db) {
  suppliers.register(app, db)
  orders.register(app, db)
}

module.exports = { register }