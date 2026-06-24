"use strict";
// routes/guards.js
// 角色限制中间件 (只在 server.js / workOrderService 注入用)
// Author: 三狗子 | Date: 2026-06-24

function onlyForemanOrAdmin(req, res, next) {
  if (!['admin', 'foreman'].includes(req.user?.role)) {
    return res.status(403).json({ error: '需要车间主任或管理员权限' });
  }
  next();
}

function onlyWelder(req, res, next) {
  if (!['admin', 'welder', 'worker'].includes(req.user?.role)) {
    return res.status(403).json({ error: '需要焊工/工人权限' });
  }
  next();
}

module.exports = { onlyForemanOrAdmin, onlyWelder };