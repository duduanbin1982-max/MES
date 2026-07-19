"use strict";

const { wrap } = require("../../middleware/asyncHandler");

const CODE_PREFIX_BY_TYPE = {
  machining: "JJ",
  sheet_metal: "BJ",
  fastener: "BZ",
  pneumatic: "QD",
  electrical: "DQ",
  purchased: "WG",
  raw: "YL",
  auxiliary: "FL",
};

function normalizeHeader(value) {
  const key = String(value || "").trim().toLowerCase();
  const map = {
    "物料编码": "material_code", "编码": "material_code", code: "material_code", material_code: "material_code",
    "物料名称": "material_name", "名称": "material_name", name: "material_name", material_name: "material_name",
    "物料类型": "material_type", "类型": "material_type", type: "material_type", material_type: "material_type",
    "规格": "spec", "型号": "spec", spec: "spec",
    "单位": "unit", unit: "unit",
    "关键件": "is_key_component", is_key_component: "is_key_component",
    "自制": "is_self_made", is_self_made: "is_self_made",
    "默认供应商": "default_supplier", supplier: "default_supplier", default_supplier: "default_supplier",
    "安全库存": "safety_stock", safety_stock: "safety_stock",
    "再订货点": "reorder_point", reorder_point: "reorder_point",
    "预估单价": "estimated_unit_price", estimated_unit_price: "estimated_unit_price",
    "实际单价": "actual_unit_price", actual_unit_price: "actual_unit_price",
    "备注": "notes", notes: "notes",
  };
  return map[key] || key;
}

function parseBool(value) {
  if (value === true || value === 1) return 1;
  const text = String(value || "").trim().toLowerCase();
  return ["1", "true", "yes", "y", "是", "关键", "自制"].includes(text) ? 1 : 0;
}

function parseNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(number) ? number : null;
}

function splitCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if ((character === "," || character === "\t") && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  cells.push(current.trim());
  return cells;
}

function parseMaterialRows(payload) {
  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload)) return payload;
  const text = String(payload.text || payload.csv || "").trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map(normalizeHeader);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? "";
    });
    return row;
  });
}

function normalizeMaterial(row) {
  return {
    material_code: String(row.material_code || "").trim(),
    material_name: String(row.material_name || "").trim(),
    material_type: String(row.material_type || "purchased").trim(),
    spec: String(row.spec || "").trim() || null,
    unit: String(row.unit || "件").trim(),
    is_key_component: parseBool(row.is_key_component),
    is_self_made: parseBool(row.is_self_made),
    default_supplier: String(row.default_supplier || "").trim() || null,
    safety_stock: parseNumber(row.safety_stock),
    reorder_point: parseNumber(row.reorder_point),
    estimated_unit_price: parseNumber(row.estimated_unit_price),
    actual_unit_price: parseNumber(row.actual_unit_price),
    notes: String(row.notes || "").trim() || null,
  };
}

function registerImportRoutes({ app, db, helpers, guards, ApiError }) {
  const { all, get, run } = helpers;
  const { requirePermission } = guards;

  function validateMaterial(material, seenCodes, rowIndex) {
    const errors = [];
    const warnings = [];
    if (!material.material_code) errors.push("物料编码必填");
    if (!material.material_name) errors.push("物料名称必填");
    if (!material.unit) errors.push("单位必填");
    if (!/^[A-Z]{2,4}-[A-Z0-9][A-Z0-9-]{1,40}$/i.test(material.material_code)) {
      errors.push("物料编码格式建议为 前缀-流水号，如 JJ-0001 / BZ-M8-020");
    }
    const expectedPrefix = CODE_PREFIX_BY_TYPE[material.material_type];
    if (expectedPrefix && !material.material_code.toUpperCase().startsWith(expectedPrefix + "-")) {
      warnings.push(`物料类型 ${material.material_type} 建议编码前缀 ${expectedPrefix}-`);
    }
    if (seenCodes.has(material.material_code)) errors.push("导入文件内物料编码重复");
    seenCodes.add(material.material_code);
    const existing = get("SELECT id, material_name, spec, unit FROM materials WHERE material_code = ?", material.material_code);
    if (existing) errors.push(`系统中已存在相同物料编码: ${existing.material_name}`);
    const sameIdentity = all(`
      SELECT id, material_code
      FROM materials
      WHERE material_name = ? AND COALESCE(spec, '') = COALESCE(?, '') AND unit = ? AND material_type = ?
      LIMIT 5
    `, [material.material_name, material.spec || "", material.unit, material.material_type]);
    if (sameIdentity.length) warnings.push("疑似一物多码: " + sameIdentity.map((item) => item.material_code).join(", "));
    return { row: rowIndex, material, errors, warnings, valid: errors.length === 0 };
  }

  app.get("/api/materials/import/template", wrap((_req, res) => {
    res.type("text/csv; charset=utf-8");
    res.send([
      "material_code,material_name,material_type,spec,unit,is_key_component,is_self_made,default_supplier,safety_stock,reorder_point,estimated_unit_price,actual_unit_price,notes",
      "JJ-0001,安装底板,machining,Q235B,件,0,1,机加工供应商A,2,1,120,118,示例",
      "BZ-M8-020,内六角圆柱头螺钉,fastener,M8×20,件,0,0,东明,200,100,0.35,0.32,GB/T 70.1",
    ].join("\n"));
  }));

  app.post("/api/materials/import/validate", wrap((req, res) => {
    const rows = parseMaterialRows(req.body || {});
    const seenCodes = new Set();
    const results = rows.map((row, index) => validateMaterial(normalizeMaterial(row), seenCodes, index + 2));
    const valid = results.filter((item) => item.valid).length;
    const invalid = results.length - valid;
    const warnings = results.reduce((sum, item) => sum + item.warnings.length, 0);
    res.json({ total: results.length, valid, invalid, warnings, items: results });
  }));

  app.post("/api/materials/import/commit", wrap((req, res) => {
    if (requirePermission("material:write")(req, res)) return;
    const rows = parseMaterialRows(req.body || {});
    const seenCodes = new Set();
    const results = rows.map((row, index) => validateMaterial(normalizeMaterial(row), seenCodes, index + 2));
    const invalid = results.filter((item) => !item.valid);
    if (invalid.length) throw ApiError.validation("存在校验错误，禁止导入", invalid.slice(0, 20));
    const transaction = db.transaction(() => {
      const created = [];
      for (const item of results) {
        const material = item.material;
        const result = run(`
          INSERT INTO materials (
            material_code, material_name, material_type, spec, unit, is_key_component, is_self_made,
            default_supplier, notes, safety_stock, reorder_point, estimated_unit_price, actual_unit_price
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          material.material_code, material.material_name, material.material_type, material.spec, material.unit,
          material.is_key_component, material.is_self_made, material.default_supplier, material.notes,
          material.safety_stock, material.reorder_point, material.estimated_unit_price, material.actual_unit_price,
        ]);
        created.push({ id: result.lastInsertRowid, material_code: material.material_code });
      }
      return created;
    });
    const created = transaction();
    res.json({ created: created.length, items: created });
  }));

  app.get("/api/material_duplicates", wrap((_req, res) => {
    const codeDuplicates = all(`
      SELECT material_code, COUNT(*) AS count
      FROM materials
      GROUP BY material_code
      HAVING COUNT(*) > 1
      ORDER BY count DESC
    `);
    const identityDuplicates = all(`
      SELECT material_name, COALESCE(spec, '') AS spec, unit, material_type, COUNT(*) AS count,
             GROUP_CONCAT(material_code) AS material_codes
      FROM materials
      GROUP BY material_name, COALESCE(spec, ''), unit, material_type
      HAVING COUNT(*) > 1
      ORDER BY count DESC
    `);
    res.json({ code_duplicates: codeDuplicates, identity_duplicates: identityDuplicates });
  }));
}

module.exports = { parseMaterialRows, registerImportRoutes };
