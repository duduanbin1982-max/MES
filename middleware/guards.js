// middleware/guards.js
// 角色守卫（2026-11-05 修：原文件中文乱码 + ApiError 构造参数错位导致 403 被包成 400）
const { ApiError } = require("../app/errors");

function reject(message, roles) {
  const error = ApiError.forbidden(message);
  error.details = { allowed_roles: roles };
  return error;
}

function onlyForemanOrAdmin(req, res, next) {
  if (!['admin', 'foreman'].includes(req.user?.role)) {
    throw reject('需要车间主任或管理员权限', ['admin', 'foreman']);
  }
  next();
}

/** 计划员也可创建/派工/改工位（2026-11-05 审计：计划员是工单主用户，但原守卫只放行主任/管理员） */
function onlyForemanAdminOrPlanner(req, res, next) {
  if (!['admin', 'foreman', 'planner'].includes(req.user?.role)) {
    throw reject('需要车间主任、计划员或管理员权限', ['admin', 'foreman', 'planner']);
  }
  next();
}

function onlyWelder(req, res, next) {
  if (!['admin', 'welder', 'worker'].includes(req.user?.role)) {
    throw reject('需要焊工或工人权限', ['admin', 'welder', 'worker']);
  }
  next();
}

function foremanOrWorker(req, res, next) {
  if (!['admin', 'foreman', 'planner', 'welder', 'worker'].includes(req.user?.role)) {
    throw reject('需要车间主任、计划员、焊工或工人权限', ['admin', 'foreman', 'planner', 'welder', 'worker']);
  }
  next();
}

module.exports = { onlyForemanOrAdmin, onlyForemanAdminOrPlanner, onlyWelder, foremanOrWorker };
