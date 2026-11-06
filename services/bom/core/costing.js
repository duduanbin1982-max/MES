"use strict";

const { BOM_FIELDS } = require("./constants");
const { normalizeInt, normalizeBool, round4 } = require("./utils");

function calcCost(db, instanceId) {
  const all = db.prepare(`
    SELECT b.id, b.parent_id, b.quantity, b.unit_price, b.material_id,
           m.material_name, m.material_code, b.scrap_factor, b.is_phantom
    FROM instance_bom b
    LEFT JOIN materials m ON m.id = b.material_id
    WHERE b.equipment_instance_id = ?
  `).all(instanceId);

  const byId = new Map(all.map((row) => [Number(row.id), row]));
  const childMap = new Map();
  for (const row of all) {
    const key = normalizeInt(row.parent_id, null);
    if (!childMap.has(key)) childMap.set(key, []);
    childMap.get(key).push(row);
  }

  const memo = new Map();
  function dfs(id) {
    if (memo.has(id)) return memo.get(id);
    const node = byId.get(id);
    const children = childMap.get(id) || [];
    if (!children.length) {
      if (normalizeBool(node.is_phantom)) {
        const value = { cost: 0, self: 0, leaf: 0, ph: 0 };
        memo.set(id, value);
        return value;
      }
      const self = round4((node.unit_price || 0) * (node.quantity || 0) * (node.scrap_factor || 1));
      const value = { cost: self, self, leaf: self, ph: 0 };
      memo.set(id, value);
      return value;
    }
    // 2026-11-07（BOM 审计）：子节点数量是"每个父件"的用量，父节点自身数量>1 时
    // 子树成本必须按父数量放大（原实现漏乘，导致多件装配成本被低估）。
    let unitChildrenCost = 0;
    let leaf = 0;
    for (const child of children) {
      const sub = dfs(Number(child.id));
      unitChildrenCost += sub.cost;
      leaf += sub.leaf;
    }
    const quantity = Math.max(0, Number(node.quantity) || 0);
    const scrap = Number(node.scrap_factor) || 1;
    const self = normalizeBool(node.is_phantom) ? 0 : round4((node.unit_price || 0) * quantity * scrap);
    const total = round4(unitChildrenCost * quantity + self);
    const value = { cost: total, self, leaf: round4(leaf), ph: normalizeBool(node.is_phantom) ? 1 : 0 };
    memo.set(id, value);
    return value;
  }

  for (const node of all) dfs(Number(node.id));
  return all.map((node) => ({
    id: node.id,
    ...memo.get(Number(node.id)),
    material_name: node.material_name,
    material_code: node.material_code,
    is_phantom: normalizeBool(node.is_phantom),
  }));
}

function compareVersions(db, instanceId, verA, verB) {
  const rowsA = db.prepare("SELECT * FROM instance_bom WHERE equipment_instance_id = ? AND version = ?").all(instanceId, verA);
  const rowsB = db.prepare("SELECT * FROM instance_bom WHERE equipment_instance_id = ? AND version = ?").all(instanceId, verB);
  const keyA = new Map(rowsA.map((r) => [`${r.parent_id || "root"}-${r.material_id || "v"}-${r.part_number || ""}`, r]));
  const keyB = new Map(rowsB.map((r) => [`${r.parent_id || "root"}-${r.material_id || "v"}-${r.part_number || ""}`, r]));
  const added = [];
  const removed = [];
  const changed = [];
  for (const [key, rowB] of keyB.entries()) {
    if (!keyA.has(key)) {
      added.push(rowB);
      continue;
    }
    const rowA = keyA.get(key);
    const diff = {};
    for (const field of Object.keys(BOM_FIELDS)) {
      if (rowA[field] !== rowB[field]) diff[field] = { from: rowA[field], to: rowB[field] };
    }
    if (Object.keys(diff).length) changed.push({ id: rowB.id, ...diff });
  }
  for (const [key, rowA] of keyA.entries()) {
    if (!keyB.has(key)) removed.push(rowA);
  }
  return { added, removed, changed, count: { A: rowsA.length, B: rowsB.length } };
}

module.exports = {
  calcCost,
  compareVersions,
};
