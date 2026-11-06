"use strict";
// services/purchase/suppliers/validation.js
// 供应商主数据入参校验（2026-11-07 采购/供应商审计）：
//   - supplier_code 去空格 + 格式 + 大小写不敏感唯一
//   - rating 仅允许 A/B/C/D
//   - supplier_category / business_categories 仅允许枚举值
//   - is_active 布尔化（拒绝 "false" 被当成真值）
//   - supplier_name 非空、长度受限

const { ApiError } = require("../../../app/errors");

const SUPPLIER_RATINGS = ["A", "B", "C", "D"];
const SUPPLIER_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,31}$/;

function normalizeIsActive(value) {
  if (value === true || value === 1 || value === "1" || value === "true") return 1;
  if (value === false || value === 0 || value === "0" || value === "false") return 0;
  return null;
}

function normalizeCategories(value, allowedCategories) {
  let list = [];
  if (Array.isArray(value)) list = value;
  else if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      list = Array.isArray(parsed) ? parsed : [value];
    } catch (_error) {
      list = value.split(/[,\uFF0C;；、]/);
    }
  }
  const categories = [...new Set(list.map((item) => String(item).trim()).filter(Boolean))];
  if (categories.length === 0) throw ApiError.validation("business_categories 不能为空");
  const invalid = categories.filter((item) => !allowedCategories.includes(item));
  if (invalid.length) throw ApiError.validation("business_categories 含非法分类: " + invalid.join(", "));
  return categories;
}

function validateSupplierName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) throw ApiError.validation("supplier_name 必填");
  if (name.length > 100) throw ApiError.validation("supplier_name 长度不能超过 100");
  return name;
}

function validateRating(value) {
  const rating = value === undefined || value === null || value === "" ? "B" : String(value).toUpperCase();
  if (!SUPPLIER_RATINGS.includes(rating)) throw ApiError.validation("rating 必须是 A/B/C/D");
  return rating;
}

function validateCreatePayload(body, allowedCategories) {
  const code = typeof body.supplier_code === "string" ? body.supplier_code.trim() : "";
  if (!code) throw ApiError.validation("supplier_code 必填");
  if (!SUPPLIER_CODE_PATTERN.test(code)) throw ApiError.validation("supplier_code 格式非法（2-32 位字母/数字/_/-）");
  const name = validateSupplierName(body.supplier_name);
  const rating = validateRating(body.rating);
  const supplierCategory = body.supplier_category || "general";
  if (!allowedCategories.includes(supplierCategory)) throw ApiError.validation("供应商分类不合法");
  const isActive = normalizeIsActive(body.is_active === undefined ? 1 : body.is_active);
  if (isActive === null) throw ApiError.validation("is_active 必须是布尔值");
  const categories = body.business_categories === undefined
    ? [supplierCategory]
    : normalizeCategories(body.business_categories, allowedCategories);
  return { code, name, rating, supplierCategory, isActive, categories };
}

function validateUpdatePayload(body, allowedCategories) {
  const update = {};
  if (body.supplier_name !== undefined) update.supplier_name = validateSupplierName(body.supplier_name);
  if (body.rating !== undefined) update.rating = validateRating(body.rating);
  if (body.is_active !== undefined) {
    const isActive = normalizeIsActive(body.is_active);
    if (isActive === null) throw ApiError.validation("is_active 必须是布尔值");
    update.is_active = isActive;
  }
  if (body.supplier_category !== undefined) {
    if (!allowedCategories.includes(body.supplier_category)) throw ApiError.validation("供应商分类不合法");
    update.supplier_category = body.supplier_category;
  }
  if (body.business_categories !== undefined) {
    const categories = normalizeCategories(body.business_categories, allowedCategories);
    update.business_categories = JSON.stringify(categories);
    update.is_key_supplier = categories.includes("key_component") ? 1 : 0;
    update.is_outsource_supplier = categories.includes("outsourcing") ? 1 : 0;
    update.is_standard_supplier = categories.includes("standard_part") ? 1 : 0;
    if (!update.supplier_category && categories.length) update.supplier_category = categories[0];
  }
  return update;
}

module.exports = {
  SUPPLIER_CODE_PATTERN,
  SUPPLIER_RATINGS,
  normalizeCategories,
  normalizeIsActive,
  validateCreatePayload,
  validateRating,
  validateSupplierName,
  validateUpdatePayload,
};
