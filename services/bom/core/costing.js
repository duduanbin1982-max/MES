"use strict";

const { BOM_FIELDS } = require("./constants");
const { normalizeInt, normalizeBool, round4 } = require("./utils");

function calcCost(db, instanceId, bomType = "EBOM") {
  let columns;
  try { columns = new Set(db.prepare("PRAGMA table_info(instance_bom)").all().map((column) => column.name)); } catch (_error) { columns = new Set(); }
  const laborExpr = columns.has("labor_cost") ? "COALESCE(b.labor_cost, 0)" : "0";
  const manufacturingExpr = columns.has("manufacturing_cost") ? "COALESCE(b.manufacturing_cost, 0)" : "0";
  const typeClause = columns.has("bom_type") && bomType ? "AND COALESCE(b.bom_type, 'EBOM') = ?" : "";
  const all = db.prepare(`
    SELECT b.id, b.parent_id, b.quantity, b.unit_price, ${laborExpr} AS labor_cost, ${manufacturingExpr} AS manufacturing_cost, b.material_id,
           m.material_name, m.material_code, b.scrap_factor, b.is_phantom
    FROM instance_bom b
    LEFT JOIN materials m ON m.id = b.material_id
    WHERE b.equipment_instance_id = ? ${typeClause}
  `).all(...(typeClause ? [instanceId, bomType] : [instanceId]));

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
      const self = round4(((node.unit_price || 0) + (node.labor_cost || 0) + (node.manufacturing_cost || 0)) * (node.quantity || 0) * (node.scrap_factor || 1));
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
    const self = normalizeBool(node.is_phantom) ? 0 : round4(((node.unit_price || 0) + (node.labor_cost || 0) + (node.manufacturing_cost || 0)) * quantity * scrap);
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

// 2026-11-07（BOM 审计 B-8）：ECO 对比改用"业务键 + 出现次数"，结构移动不再误报新增/删除
function compareVersions(db, instanceId, verA, verB) {
  const rowsA = db.prepare("SELECT * FROM instance_bom WHERE equipment_instance_id = ? AND version = ?").all(instanceId, verA);
  const rowsB = db.prepare("SELECT * FROM instance_bom WHERE equipment_instance_id = ? AND version = ?").all(instanceId, verB);
  const businessKey = (row) => {
    const identity = row.material_id ? "M" + row.material_id : "P" + String(row.part_number || "").trim();
    return identity + "|" + String(row.unit || "") + "|" + String(row.category || "");
  };
  const groupRows = (rows) => {
    const map = new Map();
    for (const row of rows) {
      const key = businessKey(row);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    }
    for (const list of map.values()) list.sort((a, b) => Number(a.id) - Number(b.id));
    return map;
  };
  const mapA = groupRows(rowsA);
  const mapB = groupRows(rowsB);
  const added = [];
  const removed = [];
  const changed = [];
  const keys = new Set([...mapA.keys(), ...mapB.keys()]);
  for (const key of keys) {
    const listA = (mapA.get(key) || []).slice();
    const listB = (mapB.get(key) || []).slice();
    const length = Math.max(listA.length, listB.length);
    for (let index = 0; index < length; index += 1) {
      const rowA = listA[index];
      const rowB = listB[index];
      if (!rowA && rowB) { added.push(rowB); continue; }
      if (rowA && !rowB) { removed.push(rowA); continue; }
      const diff = {};
      for (const field of Object.keys(BOM_FIELDS)) {
        if (field === "version") continue; // ECO 对比跨版本，版本号本身不代表变更
        if (rowA[field] !== rowB[field]) diff[field] = { from: rowA[field], to: rowB[field] };
      }
      if (Object.keys(diff).length) changed.push({ id: rowB.id, business_key: key, ...diff });
    }
  }
  return { added, removed, changed, count: { A: rowsA.length, B: rowsB.length } };
}

module.exports = {
  calcCost,
  compareVersions,
};
