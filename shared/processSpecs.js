"use strict";
// shared/processSpecs.js
// 2026-11-08（工艺参数审计遗留）：工艺参数规格的公共读模型/校验。
// params.js、spcService.js、spcMonitor.js、processMaster 共用，避免各读写一份 custom_json。
const { ApiError } = require("../app/errors");

const PARAM_FIELDS = ["current_amp", "voltage_v", "speed_mm_min", "temperature_c", "pressure_mpa", "feed_rate"];
const PARAM_LIMITS = {
  current_amp: [0, 100000],
  voltage_v: [0, 1000000],
  speed_mm_min: [0, 1000000],
  temperature_c: [-273.15, 5000],
  pressure_mpa: [0, 10000],
  feed_rate: [0, 1000000],
};

function toSpecNumber(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num)) throw ApiError.validation(`${field} 必须是数字`);
  return num;
}

function normalizeSpecs(specs) {
  if (specs === null || specs === undefined) throw ApiError.validation("specs object required");
  if (typeof specs !== "object" || Array.isArray(specs)) throw ApiError.validation("specs 必须是对象");
  const clean = {};
  for (const rawKey of Object.keys(specs)) {
    const field = String(rawKey).trim().toLowerCase();
    if (!PARAM_LIMITS[field]) throw ApiError.validation(`未知参数 key：${rawKey}`);
    if (clean[field]) throw ApiError.validation(`重复参数 key：${field}`);
    const spec = specs[rawKey];
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
      throw ApiError.validation(`${field} 的规格必须是对象`);
    }
    const lsl = toSpecNumber(spec.lsl, `${field}.lsl`);
    const usl = toSpecNumber(spec.usl, `${field}.usl`);
    if (lsl === null || usl === null) throw ApiError.validation(`${field} 必须同时提供 lsl 与 usl`);
    if (lsl > usl) throw ApiError.validation(`${field} 下限 lsl 不能大于上限 usl`);
    const [limitMin, limitMax] = PARAM_LIMITS[field];
    if (lsl < limitMin || usl > limitMax) {
      throw ApiError.validation(`${field} 规格需在物理范围 ${limitMin}~${limitMax} 内`);
    }
    const target = toSpecNumber(spec.target, `${field}.target`);
    if (target !== null && (target < lsl || target > usl)) {
      throw ApiError.validation(`${field}.target 必须落在 [lsl, usl] 区间内`);
    }
    const unit = spec.unit === undefined || spec.unit === null ? null : String(spec.unit).trim();
    if (unit && unit.length > 20) throw ApiError.validation(`${field}.unit 长度不能超过 20`);
    const normalized = { lsl, usl };
    if (target !== null) normalized.target = target;
    if (unit) normalized.unit = unit;
    clean[field] = normalized;
  }
  if (!Object.keys(clean).length) throw ApiError.validation("specs 不能为空");
  return clean;
}

function parseSpecsJson(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  let parsed = raw;
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw); } catch (_error) { return null; }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (parsed.spc && typeof parsed.spc === "object" && !Array.isArray(parsed.spc)) return parsed.spc;
  return parsed;
}

function findNodeSpecRow(db, nodeId) {
  if (!nodeId) return null;
  try {
    const rows = db.prepare(
      "SELECT id, custom_json FROM process_params WHERE process_node_id = ? AND custom_json IS NOT NULL ORDER BY recorded_at DESC, id DESC LIMIT 50"
    ).all([Number(nodeId)]);
    for (const row of rows) {
      const spec = parseSpecsJson(row.custom_json);
      if (spec && Object.keys(spec).length) return { row, spc: spec };
    }
  } catch (_error) { /* 兼容缺表 */ }
  return null;
}

function getTemplateDefaultSpecs(db, nodeId) {
  if (!nodeId) return null;
  try {
    const row = db.prepare(`
      SELECT n.operation_template_id, t.operation_code, t.default_specs_json
      FROM process_nodes n
      LEFT JOIN process_operation_templates t ON t.id = n.operation_template_id
      WHERE n.id = ?
    `).get(Number(nodeId));
    if (!row || !row.default_specs_json) return null;
    const spec = parseSpecsJson(row.default_specs_json);
    if (!spec || !Object.keys(spec).length) return null;
    return { spec, template_id: row.operation_template_id, operation_code: row.operation_code };
  } catch (_error) {
    return null;
  }
}

/**
 * 读取节点有效规格：节点自己的规格优先，否则回退工序模板默认规格。
 * @returns {{specs:object, source:"node"|"template"|null, source_id?:number, template_id?:number, operation_code?:string}}
 */
function resolveNodeSpecs(db, nodeId) {
  const own = findNodeSpecRow(db, nodeId);
  if (own) return { specs: own.spc, source: "node", source_id: own.row.id };
  const template = getTemplateDefaultSpecs(db, nodeId);
  if (template) return { specs: template.spec, source: "template", template_id: template.template_id, operation_code: template.operation_code };
  return { specs: {}, source: null };
}

module.exports = {
  PARAM_FIELDS, PARAM_LIMITS, toSpecNumber, normalizeSpecs, parseSpecsJson,
  findNodeSpecRow, getTemplateDefaultSpecs, resolveNodeSpecs,
};
