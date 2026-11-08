"use strict";

function cleanCodeToken(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 8);
}

function codeOf(value) {
  if (!value) return null;
  return typeof value === "string" ? value : value.code || null;
}

function createCodeGenerator(get, options = {}) {
  function fallbackInstanceCode(customer, year) {
    const normalizedYear = String(year || new Date().getFullYear()).replace(/\D/g, "").slice(0, 4)
      || String(new Date().getFullYear());
    const customerToken = cleanCodeToken(customer);
    const prefix = customerToken ? `TBM-${customerToken}-${normalizedYear}` : `TBM-${normalizedYear}`;
    const row = get(
      "SELECT instance_code FROM equipment_instances WHERE instance_code LIKE ? ORDER BY id DESC LIMIT 1",
      [`${prefix}-%`]
    );
    const last = row?.instance_code?.match(/-(\d{3,})$/);
    const sequence = String(last ? Number(last[1]) + 1 : 1).padStart(3, "0");
    return `${prefix}-${sequence}`;
  }

  function fallbackTemplateCode(category) {
    const year = String(new Date().getFullYear());
    const categoryToken = cleanCodeToken(category || "TBM") || "TBM";
    const prefix = `TPL-${categoryToken}-${year}`;
    const row = get(
      "SELECT template_code FROM equipment_instance_templates WHERE template_code LIKE ? ORDER BY id DESC LIMIT 1",
      [`${prefix}-%`]
    );
    const last = row?.template_code?.match(/-(\d{3,})$/);
    const sequence = String(last ? Number(last[1]) + 1 : 1).padStart(3, "0");
    return `${prefix}-${sequence}`;
  }

  function nextInstanceCode(customer, year) {
    if (typeof options.nextRuleCode === "function") {
      const ruled = codeOf(options.nextRuleCode("equipment_instance", { customer, year }));
      if (ruled) return ruled;
    }
    return fallbackInstanceCode(customer, year);
  }

  function previewInstanceCode(customer, year) {
    if (typeof options.previewRuleCode === "function") {
      const ruled = codeOf(options.previewRuleCode("equipment_instance", { customer, year }));
      if (ruled) return ruled;
    }
    return nextInstanceCode(customer, year);
  }

  function nextTemplateCode(category) {
    if (typeof options.nextRuleCode === "function") {
      const ruled = codeOf(options.nextRuleCode("equipment_template", { category, year: new Date().getFullYear() }));
      if (ruled) return ruled;
    }
    return fallbackTemplateCode(category);
  }

  function describeInstanceRule() {
    if (typeof options.describeRule === "function") return options.describeRule("equipment_instance");
    return { rule_code: "builtin", description: "TBM-[客户缩写]-YYYY-###（内置回退）" };
  }

  return { nextInstanceCode, previewInstanceCode, nextTemplateCode, describeInstanceRule };
}

module.exports = { cleanCodeToken, createCodeGenerator };
