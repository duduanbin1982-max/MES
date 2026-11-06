"use strict";

const { ApiError } = require("../../app/errors");

// 2026-11-07（工序/岗位审计）：字符串 "false" 不能被当成 true。
function safeBool(value) {
  if (value === true || value === 1) return 1;
  if (value === false || value === 0 || value === null || value === undefined) return 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return 1;
    if (["0", "false", "no", "off", ""].includes(normalized)) return 0;
    return 1;
  }
  return value ? 1 : 0;
}

function toInteger(value, field, { min = 0, max = 1000000 } = {}) {
  const num = Number(value);
  if (!Number.isInteger(num)) throw ApiError.validation(`${field} 必须是整数`);
  if (num < min || num > max) throw ApiError.validation(`${field} 需在 ${min}~${max} 之间`);
  return num;
}

function toNumber(value, field, { min = 0, max = 1000000 } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) throw ApiError.validation(`${field} 必须是数字`);
  if (num < min || num > max) throw ApiError.validation(`${field} 需在 ${min}~${max} 之间`);
  return num;
}

function toText(value, field, { required = false, max = 200 } = {}) {
  if (value === undefined || value === null) {
    if (required) throw ApiError.validation(`${field} 必填`);
    return null;
  }
  const text = String(value).trim();
  if (!text) {
    if (required) throw ApiError.validation(`${field} 必填`);
    return null;
  }
  if (text.length > max) throw ApiError.validation(`${field} 长度不能超过 ${max}`);
  return text;
}

function toCode(value, field, { required = false, max = 64 } = {}) {
  const code = toText(value, field, { required, max });
  if (!code) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(code)) {
    throw ApiError.validation(`${field} 仅允许字母/数字/下划线/点/中划线，且以字母或数字开头`);
  }
  return code;
}

function createDbAccess(db) {
  return {
    all: (sql, params = []) => db.prepare(sql).all(params),
    get: (sql, params = []) => db.prepare(sql).get(params),
    run: (sql, params = []) => db.prepare(sql).run(params),
  };
}

module.exports = { safeBool, toInteger, toNumber, toText, toCode, createDbAccess };
