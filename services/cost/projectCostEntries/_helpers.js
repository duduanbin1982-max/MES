"use strict";
// services/cost/projectCostEntries/_helpers.js
// 成本类型常量 + 时间/金额工具 + 请求体归一化。
// (原 services/cost/projectCostEntries.js 第 5-17、87-128 行)

function makeDbHelpers(db) {
  return {
    all: (sql, ...params) => db.prepare(sql).all(...params),
    get: (sql, ...params) => db.prepare(sql).get(...params),
    run: (sql, ...params) => db.prepare(sql).run(...params),
  };
}

const COST_TYPES = new Set(["material", "labor", "outsourcing", "depreciation", "rework", "quality_loss"]);
const COST_TYPE_LABELS = {
  material: "材料",
  labor: "人工",
  outsourcing: "外协",
  depreciation: "折旧",
  rework: "返工",
  quality_loss: "质量损失",
};

const nowISO = () => new Date().toISOString().slice(0, 19).replace("T", " ");
const todayISO = () => new Date().toISOString().slice(0, 10);
const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;

function normalizeBody(body, partial = false) {
  const out = {};
  if (!partial || body.equipment_instance_id !== undefined) {
    const id = Number(body.equipment_instance_id);
    if (!Number.isInteger(id) || id <= 0) throw new Error("equipment_instance_id 必填且必须为正整数");
    out.equipment_instance_id = id;
  }
  if (!partial || body.cost_type !== undefined) {
    if (!COST_TYPES.has(String(body.cost_type || ""))) throw new Error("cost_type 必须是 material/labor/outsourcing/depreciation/rework/quality_loss");
    out.cost_type = String(body.cost_type);
  }
  if (!partial || body.description !== undefined) {
    const description = String(body.description || "").trim();
    if (!description) throw new Error("description 必填");
    out.description = description;
  }
  if (!partial || body.amount !== undefined) {
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount < 0) throw new Error("amount 必须是非负数");
    out.amount = round2(amount);
  }
  for (const field of ["bom_node_id", "work_order_id"]) {
    if (body[field] !== undefined) {
      const value = body[field] === null || body[field] === "" ? null : Number(body[field]);
      if (value !== null && (!Number.isInteger(value) || value <= 0)) throw new Error(`${field} 必须为正整数`);
      out[field] = value;
    }
  }
  for (const field of ["source_type", "source_ref", "vendor", "notes"]) {
    if (body[field] !== undefined) out[field] = body[field] == null ? null : String(body[field]).trim() || null;
  }
  if (body.currency !== undefined) out.currency = String(body.currency || "CNY").trim() || "CNY";
  if (!partial || body.occurred_on !== undefined) out.occurred_on = String(body.occurred_on || todayISO()).slice(0, 10);
  if (body.status !== undefined) {
    const status = String(body.status || "posted");
    if (!["draft", "posted", "void"].includes(status)) throw new Error("status 必须是 draft/posted/void");
    out.status = status;
  } else if (!partial) {
    out.status = "posted";
  }
  return out;
}

module.exports = { COST_TYPES, COST_TYPE_LABELS, nowISO, todayISO, round2, normalizeBody, makeDbHelpers };
