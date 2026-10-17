"use strict";
// 快模式按主题拆分（原 services/bom/service/mutations.js）
const { ApiError } = require("../../../../app/errors");
const { normalizeInt, normalizeBool, cleanText } = require("../../core");

function getParent(db, instanceId, parentId) {
  if (!parentId) return null;
  return db.prepare("SELECT id, tier FROM instance_bom WHERE id = ? AND equipment_instance_id = ?").get(parentId, instanceId) || null;
}

function deriveTier(db, instanceId, parentId, fallback = 0) {
  const parent = getParent(db, instanceId, parentId);
  if (parent) return Number(parent.tier || 0) + 1;
  return normalizeInt(fallback, 0);
}

function nextSortOrder(db, instanceId, parentId) {
  const row = parentId
    ? db.prepare("SELECT MAX(COALESCE(sort_order, 0)) AS max_sort FROM instance_bom WHERE equipment_instance_id = ? AND parent_id = ?").get(instanceId, parentId)
    : db.prepare("SELECT MAX(COALESCE(sort_order, 0)) AS max_sort FROM instance_bom WHERE equipment_instance_id = ? AND parent_id IS NULL").get(instanceId);
  return Number(row?.max_sort || 0) + 10;
}

function isDescendant(db, candidateId, ancestorId) {
  const rows = db.prepare("SELECT id, parent_id FROM instance_bom").all();
  const children = new Map();
  for (const row of rows) {
    const parentId = normalizeInt(row.parent_id, null);
    if (!parentId) continue;
    const arr = children.get(parentId) || [];
    arr.push(Number(row.id));
    children.set(parentId, arr);
  }
  const stack = [...(children.get(Number(ancestorId)) || [])];
  while (stack.length) {
    const id = stack.pop();
    if (Number(id) === Number(candidateId)) return true;
    stack.push(...(children.get(Number(id)) || []));
  }
  return false;
}

function assertNoCycle(db, nodeId, parentId) {
  if (!parentId) return;
  if (Number(nodeId) === Number(parentId)) throw ApiError.validation("parent_id 不能等于自身 id");
  if (isDescendant(db, parentId, nodeId)) throw ApiError.validation("不能把节点移动到自己的子孙节点下");
}

function inferNodeType(node) {
  const explicit = cleanText(node.node_type);
  if (explicit) return explicit;
  const tier = normalizeInt(node.tier, 2);
  const category = cleanText(node.category);
  if (tier === 0 || category === "成品") return "equipment";
  if (normalizeBool(node.is_phantom) || category === "虚拟件") return "virtual";
  if (category === "自制部件") return tier === 1 ? "system" : "assembly";
  if (category === "自制机加件" || category === "自制钣金件") return "self_made";
  if (category === "标准紧固件") return "standard";
  if (category === "原材料") return "raw_material";
  if (category === "辅助材料") return "consumable";
  if (category === "外购成品" || category === "气动元件" || category === "电气元件" || category === "外协件") return "purchased";
  if (tier === 1) return "system";
  if (tier === 2) return "assembly";
  return "component";
}

module.exports = { assertNoCycle, deriveTier, getParent, inferNodeType, isDescendant, nextSortOrder };
