"use strict";
// app/middleware/responseIntercepter.js
// P0-3 响应拦截器: 把业务 res.json({error: msg}) 统一为 {code, message, details, requestId}
//   1) error 是字符串 -> VALIDATION_ERROR / NOT_FOUND / FORBIDDEN / UNAUTHORIZED / INTERNAL (按 status 推断)
//   2) 已有 {code, message, details} 形态 -> 透传 + 加 requestId
//   3) 业务 res.json({...其他}) 不变
// Author: 三狗子 | Date: 2026-06-25

const { ErrorCode } = require('../errors');

function pickCodeFromMessage(msg) {
  if (typeof msg !== 'string') return ErrorCode.VALIDATION;
  if (/未登录|token/i.test(msg)) return ErrorCode.UNAUTHORIZED;
  if (/权限|role/i.test(msg)) return ErrorCode.FORBIDDEN;
  if (/不存在|找不到|not found/i.test(msg)) return ErrorCode.NOT_FOUND;
  if (/库存|超出|冲突|重复|已存在|不允许/i.test(msg)) return ErrorCode.CONFLICT;
  return ErrorCode.VALIDATION;
}

function pickCodeFromStatus(status) {
  if (status === 401) return ErrorCode.UNAUTHORIZED;
  if (status === 403) return ErrorCode.FORBIDDEN;
  if (status === 404) return ErrorCode.NOT_FOUND;
  if (status === 409) return ErrorCode.CONFLICT;
  if (status === 422) return ErrorCode.UNPROCESSABLE;
  if (status === 429) return ErrorCode.RATE_LIMIT;
  if (status >= 500) return ErrorCode.INTERNAL;
  return ErrorCode.VALIDATION;
}

function responseInterceptor() {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      const status = res.statusCode || 200;
      // 已统一格式: 透传
      if (body && typeof body === 'object' && 'code' in body && 'message' in body) {
        return originalJson({ ...body, requestId: req.id });
      }
      // 业务老格式 {error: msg}
      if (body && typeof body === 'object' && typeof body.error === 'string') {
        const code = pickCodeFromStatus(status) === ErrorCode.VALIDATION
          ? pickCodeFromMessage(body.error)
          : pickCodeFromStatus(status);
        return originalJson({
          code,
          message: body.error,
          details: body.details || null,
          requestId: req.id,
        });
      }
      // 数组/对象 (业务正常返回)
      if (status >= 400) {
        // 4xx/5xx 但 body 不是 {error}, 兜底
        return originalJson({
          code: pickCodeFromStatus(status),
          message: (body && body.message) || (typeof body === 'string' ? body : '请求失败'),
          details: body && typeof body === 'object' ? body : null,
          requestId: req.id,
        });
      }
      return originalJson(body);
    };
    next();
  };
}

module.exports = responseInterceptor;
