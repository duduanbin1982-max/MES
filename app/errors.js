"use strict";
// app/errors.js
// P0-3 统一错误响应
//   业务层 throw new ApiError(code, message, status, details)
//   顶层 errorHandler 中间件统一格式 { code, message, details, requestId }
// Author: 三狗子 | Date: 2026-06-25

// 标准错误码 (前端可 switch)

const logger = require("./logger").createLogger("errors");

const ErrorCode = {
  // 4xx
  VALIDATION: 'VALIDATION_ERROR',          // 400 通用校验失败
  UNAUTHORIZED: 'UNAUTHORIZED',            // 401 未登录
  FORBIDDEN: 'FORBIDDEN',                  // 403 权限不足
  NOT_FOUND: 'NOT_FOUND',                  // 404 资源不存在
  CONFLICT: 'CONFLICT',                    // 409 冲突 (重复/库存超限)
  UNPROCESSABLE: 'UNPROCESSABLE_ENTITY',   // 422 业务规则
  RATE_LIMIT: 'RATE_LIMITED',              // 429
  // 5xx
  INTERNAL: 'INTERNAL_ERROR',              // 500 兜底
  DB_ERROR: 'DATABASE_ERROR',              // 500 DB
  UPSTREAM: 'UPSTREAM_ERROR',              // 502 飞书/外部失败
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',      // 501
};

class ApiError extends Error {
  constructor(code, message, status = 400, details = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
  // 工厂方法
  static validation(msg, details) { return new ApiError(ErrorCode.VALIDATION, msg, 400, details); }
  static notFound(msg = '资源不存在', details) { return new ApiError(ErrorCode.NOT_FOUND, msg, 404, details); }
  static conflict(msg, details) { return new ApiError(ErrorCode.CONFLICT, msg, 409, details); }
  static forbidden(msg = '权限不足', details) { return new ApiError(ErrorCode.FORBIDDEN, msg, 403, details); }
  static unauthorized(msg = '未登录或 token 无效') { return new ApiError(ErrorCode.UNAUTHORIZED, msg, 401); }
  static unprocessable(msg, details) { return new ApiError(ErrorCode.UNPROCESSABLE, msg, 422, details); }
  static db(msg, details) { return new ApiError(ErrorCode.DB_ERROR, msg, 500, details); }
  static upstream(msg, details) { return new ApiError(ErrorCode.UPSTREAM, msg, 502, details); }
  static internal(msg = '服务内部错误', details) { return new ApiError(ErrorCode.INTERNAL, msg, 500, details); }
}

// errorHandler 中间件: 必须放在所有 route 之后, 4 个参数 (err, req, res, next)
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  // ApiError: 业务抛的, 直接用
  if (err instanceof ApiError) {
    if (err.status >= 500) logger.error(`[${req.id}] ${err.code}: ${err.message}`, err.details || '');
    return res.status(err.status).json({ code: err.code, message: err.message, details: err.details, requestId: req.id });
  }
  // 兼容旧业务: throw new Error() + e.status (我刚加的 wrap 逻辑)
  if (err && err.status) {
    return res.status(err.status).json({
      code: err.status >= 500 ? ErrorCode.INTERNAL : ErrorCode.VALIDATION,
      message: err.message || '请求失败',
      details: null,
      requestId: req.id,
    });
  }
  // 兜底
  logger.error(`[${req.id}] UNHANDLED:`, err);
  res.status(500).json({
    code: ErrorCode.INTERNAL,
    message: '服务内部错误',
    details: process.env.NODE_ENV === 'production' ? null : (err && err.message),
    requestId: req.id,
  });
}

// 404 兜底 (放在 errorHandler 前)
function notFoundHandler(req, res) {
  res.status(404).json({
    code: ErrorCode.NOT_FOUND,
    message: '接口不存在',
    details: { path: req.path, method: req.method },
    requestId: req.id,
  });
}

module.exports = { ApiError, ErrorCode, errorHandler, notFoundHandler };
