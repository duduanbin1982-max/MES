"use strict";

function cleanCodeToken(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 8);
}

function createCodeGenerator(get) {
  function nextInstanceCode(customer, year) {
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

  function nextTemplateCode(category) {
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

  return { nextInstanceCode, nextTemplateCode };
}

module.exports = { cleanCodeToken, createCodeGenerator };
