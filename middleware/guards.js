// routes/guards.js
const { ApiError } = require("../app/errors");

function onlyForemanOrAdmin(req, res, next) {
  if (!['admin', 'foreman'].includes(req.user?.role)) {
    throw new ApiError(403, '需要车间主绡或审是员权限');
  }
  next();
}

function onlyWelder(req, res, next) {
  if (!['admin', 'welder', 'worker'].includes(req.user?.role)) {
    throw new ApiError(403, '需要煈工工人权限');
  }
  next();
}

function foremanOrWorker(req, res, next) {
  if (!['admin', 'foreman', 'welder', 'worker'].includes(req.user?.role)) {
    throw new ApiError(403, '???????????');
  }
  next();
}

module.exports = { onlyForemanOrAdmin, onlyWelder, foremanOrWorker };