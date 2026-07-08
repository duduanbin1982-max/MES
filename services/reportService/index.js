// services/reportService/index.js
// 装配各子模块 register
const milestones = require('./milestones')
const fieldService = require('./fieldService')
const dashboard = require('./dashboard')
const reports = require('./reports')
const reportService = require('./reportService')

function register(app, db) {
  milestones.register(app, db)
  fieldService.register(app, db)
  dashboard.register(app, db)
  reports.register(app, db)
  reportService.register(app, db)
}

module.exports = { register }
