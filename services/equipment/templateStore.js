"use strict";

const {
  EMPTY_TEMPLATE_SCOPE,
  INSTANCE_TEMPLATE_SCOPE,
  TEMPLATE_SCOPE_OPTIONS,
} = require("./catalog");

function normalizeCopyScope(value, fallback = EMPTY_TEMPLATE_SCOPE) {
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch (_error) { parsed = {}; }
  }
  if (Array.isArray(parsed)) {
    parsed = parsed.reduce((result, key) => {
      result[key] = true;
      return result;
    }, {});
  }
  const source = parsed && typeof parsed === "object" ? parsed : {};
  return Object.fromEntries(TEMPLATE_SCOPE_OPTIONS.map((option) => [
    option.key,
    source[option.key] === undefined ? Boolean(fallback[option.key]) : Boolean(source[option.key]),
  ]));
}

function scopeKeys(scope) {
  return TEMPLATE_SCOPE_OPTIONS.filter((option) => scope[option.key]).map((option) => option.key);
}

function createTemplateStore({ get, ApiError }) {
  function templateRow(row) {
    if (!row) return null;
    const copyScope = normalizeCopyScope(
      row.copy_scope,
      row.source_instance_id ? INSTANCE_TEMPLATE_SCOPE : EMPTY_TEMPLATE_SCOPE
    );
    return { ...row, copy_scope: copyScope, copy_scope_keys: scopeKeys(copyScope) };
  }

  function getTemplate(templateId) {
    if (!templateId) return null;
    const row = get(`
      SELECT t.*, ei.instance_code AS source_instance_code, ei.instance_name AS source_instance_name
      FROM equipment_instance_templates t
      LEFT JOIN equipment_instances ei ON ei.id = t.source_instance_id
      WHERE t.id = ?
    `, templateId);
    if (!row) throw ApiError.notFound("项目装备模板不存在");
    return templateRow(row);
  }

  return { getTemplate, normalizeCopyScope, templateRow };
}

module.exports = { createTemplateStore, normalizeCopyScope, scopeKeys };
