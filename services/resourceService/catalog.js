"use strict";

const STATION_TYPES = [
  { value: "assembly", label: "装配工位", default_skills: ["assembly", "crane", "mechanical"] },
  { value: "welding", label: "焊接工位", default_skills: ["welding", "ndt"] },
  { value: "machining", label: "机加工位", default_skills: ["machining", "cnc"] },
  { value: "inspection", label: "检验工位", default_skills: ["qc", "ndt", "measurement"] },
  { value: "cutting", label: "下料工位", default_skills: ["cutting"] },
  { value: "forming", label: "成型工位", default_skills: ["forming"] },
  { value: "commissioning", label: "调试工位", default_skills: ["commissioning", "hydraulic", "electric"] },
  { value: "warehouse", label: "仓储工位", default_skills: ["warehouse", "forklift"] },
  { value: "general", label: "通用工位", default_skills: [] },
];

function safeJson(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (_error) {
    return String(value).split(/[,，;；、]/).map((item) => item.trim()).filter(Boolean);
  }
}

function jsonText(value) {
  return JSON.stringify(safeJson(value));
}

function inferStationType(row) {
  const text = `${row.code || ""} ${row.name || ""} ${row.workshop || ""}`.toLowerCase();
  if (/焊|weld/.test(text)) return "welding";
  if (/机加|镗|铣|车|cnc|machining|boring/.test(text)) return "machining";
  if (/检|质|探伤|qc|inspect|ndt|measurement/.test(text)) return "inspection";
  if (/装配|总装|assembly/.test(text)) return "assembly";
  if (/切割|下料|cut/.test(text)) return "cutting";
  if (/折弯|卷制|成型|form/.test(text)) return "forming";
  if (/调试|试压|commission|test/.test(text)) return "commissioning";
  if (/仓|库|warehouse/.test(text)) return "warehouse";
  return "general";
}

function typeLabel(type) {
  return STATION_TYPES.find((item) => item.value === type)?.label || type || "通用工位";
}

module.exports = { STATION_TYPES, safeJson, jsonText, inferStationType, typeLabel };
