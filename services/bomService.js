"use strict";
// services/bomService.js
// P2 BOM 管理 (实例 BOM: 4 级结构 + 12 字段 + ECO 追溯 + 成本汇总 + 校验)
//   GET    /api/equipment_instances/:id/bom              树 (含子件)
//   GET    /api/equipment_instances/:id/bom/cost         成本汇总
//   POST   /api/equipment_instances/:id/bom              新增节点
//   PUT    /api/bom/:id                                  更新
//   DELETE /api/bom/:id                                  删除子树
//   POST   /api/equipment_instances/:id/bom/import       CSV 导入
//   GET    /api/equipment_instances/:id/bom/compare      ECO 对比 (v_old vs v_new)
//   POST   /api/equipment_instances/:id/bom/validate     校验
// Author: 三狗子 | Date: 2026-06-25

const { ApiError } = require('../app/errors');

// 12 必填字段定义 (文章标准)
const BOM_FIELDS = {
  // 基础标识
  tier:              { type: 'int',  label: '层级(0-3)',   required: true,  tier_specific: false },
  material_id:       { type: 'int',  label: '物料ID',      required: false, tier_specific: [1,2,3] },  // tier 0 总装可为 NULL
  part_number:       { type: 'text', label: '图号/型号',   required: false, max: 200 },
  // 数量
  quantity:          { type: 'real', label: '单台数量',    required: true,  min: 0.0001 },
  unit:              { type: 'text', label: '单位',        required: true,  enum: ['件','个','米','千克','套','台','根','条','升'] },
  category:          { type: 'text', label: '物料分类',    required: true,  enum: ['自制机加件','自制钣金件','标准紧固件','气动元件','电气元件','外购成品','辅助材料','成品','自制部件'] },
  // 技术要求
  material_grade:    { type: 'text', label: '材质牌号',    required: false, max: 100 },
  surface_treatment: { type: 'text', label: '表面处理',    required: false, max: 200 },
  brand_recommend:   { type: 'text', label: '推荐品牌',    required: false, max: 100 },
  brand_grade:       { type: 'text', label: '品牌等级',    required: false, enum: ['A','B','不可替代'] },
  // 工艺
  operation_id:      { type: 'int',  label: '工序ID',      required: false },
  scrap_factor:      { type: 'real', label: '损耗系数',    required: false, default: 1.0, min: 1.0, max: 2.0 },
  is_phantom:        { type: 'int',  label: '虚项',        required: false, default: 0 },
  // 关键性
  is_key_component:  { type: 'int',  label: '关键件',      required: false, default: 0 },
  is_wear_part:      { type: 'int',  label: '易损件',      required: false, default: 0 },
  storage_location:  { type: 'text', label: '存放位置',    required: false, max: 100 },
  // 替代
  is_alternative:    { type: 'int',  label: '替代料',      required: false, default: 0 },
  alternative_group: { type: 'text', label: '替代组',      required: false, max: 50 },
  alternative_priority: { type: 'int', label: '替代优先级', required: false, default: 1, min: 1 },
  // 成本/管理
  weight:            { type: 'real', label: '单重kg',      required: false, min: 0 },
  unit_price:        { type: 'real', label: '估价',        required: false, min: 0 },
  version:           { type: 'text', label: '版本',        required: false, default: 'A0', max: 10 },
  eco_id:            { type: 'int',  label: 'ECO ID',      required: false },
  effective_from:    { type: 'text', label: '生效起始',    required: false },
  effective_to:      { type: 'text', label: '生效截止',    required: false },
  notes:             { type: 'text', label: '备注',        required: false, max: 500 },
};

/**
 * 校验单条 BOM 节点
 * @returns { ok: true } | { ok: false, errors: string[] }
 */
function validateNode(node) {
  const errors = [];
  // tier 必填且 0-3
  if (!Number.isInteger(node.tier) || node.tier < 0 || node.tier > 3) {
    errors.push('tier 必须是 0/1/2/3');
  }
  // quantity > 0
  if (!(node.quantity > 0)) errors.push('quantity 必须 > 0');
  // 单位枚举
  if (node.unit && !BOM_FIELDS.unit.enum.includes(node.unit)) {
    errors.push('unit 必须是: ' + BOM_FIELDS.unit.enum.join('/'));
  }
  // category 枚举
  if (node.category && !BOM_FIELDS.category.enum.includes(node.category)) {
    errors.push('category 必须是: ' + BOM_FIELDS.category.enum.join('/'));
  }
  // material_id 必须是已存在物料 (由调用方传 allMaterials 校验)
  // parent_id 不能 = id 自己 (循环)
  if (node.parent_id && node.id && Number(node.parent_id) === Number(node.id)) {
    errors.push('parent_id 不能等于自身 id');
  }
  // scrap_factor 范围
  if (node.scrap_factor !== undefined && (node.scrap_factor < 1.0 || node.scrap_factor > 2.0)) {
    errors.push('scrap_factor 应在 1.0-2.0');
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

/**
 * 整树校验
 */
function validateTree(db, instanceId) {
  const errors = [];
  // 1) 根唯一 (tier=0 + parent_id=null)
  const roots = db.prepare(
    "SELECT id FROM instance_bom WHERE equipment_instance_id = ? AND (parent_id IS NULL OR parent_id = 0) AND tier = 0"
  ).all(instanceId);
  if (roots.length === 0) errors.push('缺少根节点 (tier=0)');
  if (roots.length > 1) errors.push(`多个根节点 (${roots.length}), 应只有 1 个`);

  // 2) 循环引用 (从所有无 parent 的节点开始 DFS, 不用 roots 限制, 否则孤儿节点检不到)
  const all = db.prepare("SELECT id, parent_id FROM instance_bom WHERE equipment_instance_id = ?").all(instanceId);
  const childMap = new Map();
  const starts = [];
  for (const r of all) {
    if (r.parent_id === null || r.parent_id === 0) starts.push(r.id)
    if (!childMap.has(r.parent_id)) childMap.set(r.parent_id, []);
    childMap.get(r.parent_id).push(r.id);
  }
  // 循环检测: 从每个节点都做 DFS, 任何有环的连通分量都能发现
  //   inStack (当前路径) + visited (已访问) 分开
  //   遇到 inStack = 真循环; 遇到 visited 但不在 inStack = 正常重访 (DAG)
  const visited = new Set();
  let foundCycle = false;
  for (const startId of all.map(r => r.id)) {
    if (visited.has(startId)) continue;
    const inStack = new Set();
    const stack = [startId];
    while (stack.length) {
      const id = stack.pop();
      if (inStack.has(id)) { errors.push(`循环引用: id=${id} 出现第二次`); foundCycle = true; break; }
      if (visited.has(id)) continue;
      visited.add(id);
      inStack.add(id);
      const children = childMap.get(id) || [];
      for (const ch of children) stack.push(ch);
    }
    if (foundCycle) break;
  }
  if (!foundCycle) {
    // 未访问的节点 = 孤儿 (parent 指向不存在)
    for (const r of all) {
      if (!visited.has(r.id)) errors.push(`孤儿节点: id=${r.id} parent_id=${r.parent_id} 指向不存在`)
    }
  }

  // 3) 数量为 0
  const zeroQty = db.prepare("SELECT id FROM instance_bom WHERE equipment_instance_id = ? AND quantity <= 0").all(instanceId);
  for (const r of zeroQty) errors.push(`quantity <= 0: id=${r.id}`);

  // 4) material_id 不存在
  const badMat = db.prepare(`
    SELECT b.id, b.material_id FROM instance_bom b
    WHERE b.equipment_instance_id = ? AND b.material_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM materials m WHERE m.id = b.material_id)
  `).all(instanceId);
  for (const r of badMat) errors.push(`物料不存在: bom_id=${r.id}, material_id=${r.material_id}`);

  // 5) 虚项不能是叶子有 quantity (虚项只是结构, 数量累加在子件)
  const phantomLeaf = db.prepare(`
    SELECT b.id FROM instance_bom b
    WHERE b.equipment_instance_id = ? AND b.is_phantom = 1
      AND NOT EXISTS (SELECT 1 FROM instance_bom c WHERE c.parent_id = b.id)
  `).all(instanceId);
  for (const r of phantomLeaf) errors.push(`虚项 (bom_id=${r.id}) 必须是父节点, 不能是叶子`);

  return { ok: errors.length === 0, errors, total: all.length };
}

/**
 * 递归算成本 (qty * unit_price, 累加所有叶子)
 */
function calcCost(db, instanceId) {
  const all = db.prepare(`
    SELECT b.id, b.parent_id, b.quantity, b.unit_price, b.material_id,
           m.material_name, m.material_code, b.scrap_factor, b.is_phantom
    FROM instance_bom b
    LEFT JOIN materials m ON m.id = b.material_id
    WHERE b.equipment_instance_id = ?
  `).all(instanceId);

  // 叶子 (无子节点)
  const childMap = new Map();
  for (const r of all) {
    if (!childMap.has(r.parent_id)) childMap.set(r.parent_id, []);
    childMap.get(r.parent_id).push(r);
  }
  const isLeaf = (id) => !(childMap.get(id) || []).length;

  // DFS 自底向上算
  const costMap = new Map();
  function dfs(id) {
    if (costMap.has(id)) return costMap.get(id);
    const node = all.find(n => n.id === id);
    if (isLeaf(id)) {
      // 叶子: 自身成本 (虚项 0)
      if (node.is_phantom) { costMap.set(id, { cost: 0, self: 0, leaf: 0, ph: 0 }); return costMap.get(id); }
      const self = Math.round((node.unit_price || 0) * (node.quantity || 0) * (node.scrap_factor || 1.0) * 10000) / 10000;
      costMap.set(id, { cost: self, self, leaf: self, ph: 0 });
      return costMap.get(id);
    }
    // 父: 累加子件成本. child.cost 已经包含 child.qty*scrap, 这里不要再乘 c.qty/c.scrap
    // MRP 公式: cost(node) = self(node) + Σ cost(child)
    //   self(node) = node.qty * node.unit_price * node.scrap (虚项 0)
    //   cost(child) = child.qty * child.unit_price * child.scrap + Σ grandchild
    let total = 0;
    for (const c of (childMap.get(id) || [])) {
      const sub = dfs(c.id);
      total += sub.cost;
    }
    // 自身成本 (虚项不计); 浮点 4 位舍入避免 110.00000000000001
    const self = node.is_phantom ? 0 : Math.round((node.unit_price || 0) * (node.quantity || 0) * (node.scrap_factor || 1.0) * 10000) / 10000;
    costMap.set(id, { cost: Math.round((total + self) * 10000) / 10000, self: Math.round(self * 10000) / 10000, leaf: 0, ph: 0 });
    return costMap.get(id);
  }

  // 算所有节点
  for (const n of all) dfs(n.id);
  return all.map(n => ({ id: n.id, ...costMap.get(n.id), material_name: n.material_name, material_code: n.material_code, is_phantom: n.is_phantom }));
}

/**
 * ECO 对比: 同一 instance, version A vs version B
 */
function compareVersions(db, instanceId, verA, verB) {
  const rowsA = db.prepare("SELECT * FROM instance_bom WHERE equipment_instance_id = ? AND version = ?").all(instanceId, verA);
  const rowsB = db.prepare("SELECT * FROM instance_bom WHERE equipment_instance_id = ? AND version = ?").all(instanceId, verB);
  const keyA = new Map(rowsA.map(r => [`${r.parent_id || 'root'}-${r.material_id || 'v'}-${r.part_number || ''}`, r]));
  const keyB = new Map(rowsB.map(r => [`${r.parent_id || 'root'}-${r.material_id || 'v'}-${r.part_number || ''}`, r]));

  const added = [];       // 在 B 不在 A
  const removed = [];     // 在 A 不在 B
  const changed = [];     // 两边都有但字段不同
  for (const [k, b] of keyB) {
    if (!keyA.has(k)) added.push(b);
    else {
      const a = keyA.get(k);
      const diff = {};
      for (const f of Object.keys(BOM_FIELDS)) {
        if (a[f] !== b[f]) diff[f] = { from: a[f], to: b[f] };
      }
      if (Object.keys(diff).length) changed.push({ id: b.id, ...diff });
    }
  }
  for (const [k, a] of keyA) if (!keyB.has(k)) removed.push(a);
  return { added, removed, changed, count: { A: rowsA.length, B: rowsB.length } };
}

/**
 * CSV 解析 (简单格式, 含表头)
 */
// P2 BOM: 把平铺 rows 按 parent_id 拼成树状
function buildTree(rows) {
  const map = new Map();
  const roots = [];
  rows.forEach(r => map.set(r.id, { ...r, children: [] }));
  rows.forEach(r => {
    const node = map.get(r.id);
    if (r.parent_id && map.has(r.parent_id)) {
      map.get(r.parent_id).children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

// P2 BOM: 4 级层级统计 (文章: 0 总装 / 1 部件 / 2 零件 / 3 毛坯)
function tierSummary(rows) {
  const summary = { 0: 0, 1: 0, 2: 0, 3: 0, total: rows.length };
  rows.forEach(r => { if (summary[r.tier] !== undefined) summary[r.tier]++; });
  return summary;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error('CSV 至少 2 行 (表头 + 数据)');
  const headers = lines[0].split(',').map(s => s.trim().replace(/^"|"$/g, ''));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map(s => s.trim().replace(/^"|"$/g, ''));
    const row = {};
    headers.forEach((h, idx) => { row[h] = cells[idx] || null; });
    rows.push(row);
  }
  return { headers, rows };
}

function register(app, db) {
  // P2 BOM 4 级拆分法: 按层级/视图过滤
  //   ?view=tree (默认) → 树状结构, 适合总览
  //   ?view=flat        → 平铺数组, 配合 ?tier / ?part_id 过滤
  //   ?tier=0/1/2/3     → 仅返指定层级 (0=总装, 1=部件, 2=零件, 3=毛坯)
  //   ?part_id=N        → 仅返某部件下的子件 (仅看这个部件装什么)
  app.get('/api/equipment_instances/:id/bom', (req, res) => {
    const instanceId = req.params.id;
    const { view = 'tree', tier, part_id } = req.query;

    const allRows = db.prepare(`
      SELECT b.*, m.material_code, m.material_name, m.unit AS m_unit, m.spec
      FROM instance_bom b
      LEFT JOIN materials m ON m.id = b.material_id
      WHERE b.equipment_instance_id = ?
      ORDER BY b.tier, b.parent_id, b.id
    `).all(instanceId);

    const summary = tierSummary(allRows);

    if (view === 'tree') {
      let rows = allRows;
      if (part_id) {
        // 只取某部件子树
        const ids = new Set([Number(part_id)]);
        let added = true;
        while (added) {
          added = false;
          for (const r of allRows) {
            if (r.parent_id && ids.has(r.parent_id) && !ids.has(r.id)) { ids.add(r.id); added = true; }
          }
        }
        rows = allRows.filter(r => ids.has(r.id));
      }
      return res.json({ view: 'tree', tier_summary: summary, tree: buildTree(rows), total: rows.length });
    }

    // view=flat
    let flat = allRows;
    if (tier !== undefined) flat = flat.filter(r => r.tier === Number(tier));
    if (part_id) {
      const ids = new Set([Number(part_id)]);
      let added = true;
      while (added) {
        added = false;
        for (const r of allRows) {
          if (r.parent_id && ids.has(r.parent_id) && !ids.has(r.id)) { ids.add(r.id); added = true; }
        }
      }
      flat = flat.filter(r => ids.has(r.id));
    }
    return res.json({ view: 'flat', tier_summary: summary, items: flat, total: flat.length, tier: tier !== undefined ? Number(tier) : null });
  });

  // P2 BOM: 4 级层级清单 (文章: 部件清单给装配班组, 零件清单给采购, 毛坯清单给生产下料)
  app.get('/api/equipment_instances/:id/bom/levels', (req, res) => {
    const instanceId = req.params.id;
    const rows = db.prepare(`
      SELECT b.*, m.material_code, m.material_name, m.unit AS m_unit, m.spec
      FROM instance_bom b
      LEFT JOIN materials m ON m.id = b.material_id
      WHERE b.equipment_instance_id = ?
      ORDER BY b.tier, b.id
    `).all(instanceId);
    const levels = { 0: [], 1: [], 2: [], 3: [] };
    rows.forEach(r => { if (levels[r.tier]) levels[r.tier].push(r); });
    res.json({ levels, summary: tierSummary(rows) });
  });

  // 成本汇总
  app.get('/api/equipment_instances/:id/bom/cost', (req, res) => {
    const costs = calcCost(db, req.params.id);
    const totalCost = costs.reduce((s, c) => s + c.cost, 0);
    res.json({ items: costs, total_cost: totalCost });
  });

  // 校验
  app.get('/api/equipment_instances/:id/bom/validate', (req, res) => {
    res.json(validateTree(db, req.params.id));
  });

  // 新增节点
  app.post('/api/equipment_instances/:id/bom', (req, res, next) => {
    try {
      const node = req.body || {};
      node.equipment_instance_id = req.params.id;
      // 默认
      if (node.tier === undefined) node.tier = 2;
      if (!node.unit) node.unit = '件';
      if (!node.version) node.version = 'A0';
      if (node.scrap_factor === undefined) node.scrap_factor = 1.0;
      if (node.alternative_priority === undefined) node.alternative_priority = 1;
      const v = validateNode(node);
      if (!v.ok) return next(ApiError.validation('BOM 校验失败', v.errors));
      // better-sqlite3 不接受 undefined, 统一转 null; 缺省值兜底
      const safeNode = {
        equipment_instance_id: node.equipment_instance_id,
        parent_id: node.parent_id ?? null,
        tier: node.tier ?? 2,
        version: node.version ?? 'A0',
        eco_id: node.eco_id ?? null,
        effective_from: node.effective_from ?? null,
        effective_to: node.effective_to ?? null,
        material_id: node.material_id ?? null,
        part_number: node.part_number ?? null,
        quantity: node.quantity ?? 1,
        unit: node.unit ?? '件',
        scrap_factor: node.scrap_factor ?? 1.0,
        category: node.category ?? null,
        material_grade: node.material_grade ?? null,
        surface_treatment: node.surface_treatment ?? null,
        brand_recommend: node.brand_recommend ?? null,
        brand_grade: node.brand_grade ?? null,
        is_alternative: node.is_alternative ? 1 : 0,
        alternative_group: node.alternative_group ?? null,
        alternative_priority: node.alternative_priority ?? 1,
        operation_id: node.operation_id ?? null,
        is_phantom: node.is_phantom ? 1 : 0,
        is_key_component: node.is_key_component ? 1 : 0,
        is_wear_part: node.is_wear_part ? 1 : 0,
        storage_location: node.storage_location ?? null,
        weight: node.weight ?? null,
        unit_price: node.unit_price ?? null,
        notes: node.notes ?? null,
        created_by: req.user?.uid ?? null,
      };
      const stmt = db.prepare(`INSERT INTO instance_bom (
        equipment_instance_id, parent_id, tier, version, eco_id,
        effective_from, effective_to, material_id, part_number,
        quantity, unit, scrap_factor, category, material_grade, surface_treatment,
        brand_recommend, brand_grade, is_alternative, alternative_group, alternative_priority,
        operation_id, is_phantom, is_key_component, is_wear_part, storage_location,
        weight, unit_price, notes, created_by
      ) VALUES (
        @equipment_instance_id, @parent_id, @tier, @version, @eco_id,
        @effective_from, @effective_to, @material_id, @part_number,
        @quantity, @unit, @scrap_factor, @category, @material_grade, @surface_treatment,
        @brand_recommend, @brand_grade, @is_alternative, @alternative_group, @alternative_priority,
        @operation_id, @is_phantom, @is_key_component, @is_wear_part, @storage_location,
        @weight, @unit_price, @notes, @created_by
      )`);
      const r = stmt.run(safeNode);
      const created = db.prepare('SELECT * FROM instance_bom WHERE id = ?').get(r.lastInsertRowid);
      res.json(created);
    } catch (e) { next(e); }
  });

  // 更新节点
  app.put('/api/bom/:id', (req, res, next) => {
    try {
      const id = req.params.id;
      const exist = db.prepare('SELECT * FROM instance_bom WHERE id = ?').get(id);
      if (!exist) return next(ApiError.notFound('BOM 节点不存在: ' + id));
      const merged = { ...exist, ...req.body };
      const v = validateNode(merged);
      if (!v.ok) return next(ApiError.validation('BOM 校验失败', v.errors));
      const updatable = [
        'tier', 'version', 'eco_id', 'effective_from', 'effective_to',
        'material_id', 'part_number', 'quantity', 'unit', 'scrap_factor',
        'category', 'material_grade', 'surface_treatment',
        'brand_recommend', 'brand_grade',
        'is_alternative', 'alternative_group', 'alternative_priority',
        'operation_id', 'is_phantom', 'is_key_component', 'is_wear_part', 'storage_location',
        'weight', 'unit_price', 'notes', 'parent_id',
      ];
      const sets = updatable.map(f => `${f} = @${f}`).join(', ');
      db.prepare(`UPDATE instance_bom SET ${sets}, updated_at = datetime('now') WHERE id = @id`).run({ ...req.body, id });
      res.json(db.prepare('SELECT * FROM instance_bom WHERE id = ?').get(id));
    } catch (e) { next(e); }
  });

  // 删除节点 (级联子树)
  app.delete('/api/bom/:id', (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const exist = db.prepare('SELECT id FROM instance_bom WHERE id = ?').get(id);
      if (!exist) return next(ApiError.notFound('BOM 节点不存在: ' + id));
      // 找所有后代
      const toDel = new Set([id]);
      let added = true;
      while (added) {
        added = false;
        const all = db.prepare("SELECT id, parent_id FROM instance_bom").all();
        for (const r of all) {
          if (r.parent_id && toDel.has(r.parent_id) && !toDel.has(r.id)) {
            toDel.add(r.id); added = true;
          }
        }
      }
      const del = db.prepare('DELETE FROM instance_bom WHERE id = ?');
      for (const i of toDel) del.run(i);
      res.json({ deleted: Array.from(toDel), count: toDel.size });
    } catch (e) { next(e); }
  });

  // CSV 导入
  app.post('/api/equipment_instances/:id/bom/import', (req, res, next) => {
    try {
      const { csv } = req.body || {};
      if (!csv) return next(ApiError.validation('csv 必填'));
      const { headers, rows } = parseCsv(csv);
      const required = ['tier', 'quantity', 'unit', 'category'];
      for (const r of required) if (!headers.includes(r)) return next(ApiError.validation('CSV 缺必填列: ' + r));
      let inserted = 0, errors = 0;
      const errList = [];
      for (const r of rows) {
        const node = {
          equipment_instance_id: req.params.id,
          tier: Number(r.tier) || 2,
          quantity: Number(r.quantity) || 1,
          unit: r.unit || '件',
          category: r.category,
          material_id: r.material_id ? Number(r.material_id) : null,
          part_number: r.part_number || null,
          material_grade: r.material_grade || null,
          surface_treatment: r.surface_treatment || null,
          brand_recommend: r.brand_recommend || null,
          scrap_factor: Number(r.scrap_factor) || 1.0,
          is_phantom: Number(r.is_phantom) || 0,
          is_key_component: Number(r.is_key_component) || 0,
          is_wear_part: Number(r.is_wear_part) || 0,
          parent_id: r.parent_id ? Number(r.parent_id) : null,
          notes: r.notes || null,
        };
        const v = validateNode(node);
        if (!v.ok) { errors++; errList.push({ row: r, errors: v.errors }); continue; }
        try {
          db.prepare(`INSERT INTO instance_bom (equipment_instance_id, parent_id, tier, material_id, part_number, quantity, unit, scrap_factor, category, material_grade, surface_treatment, brand_recommend, is_phantom, is_key_component, is_wear_part, notes)
            VALUES (@equipment_instance_id, @parent_id, @tier, @material_id, @part_number, @quantity, @unit, @scrap_factor, @category, @material_grade, @surface_treatment, @brand_recommend, @is_phantom, @is_key_component, @is_wear_part, @notes)`).run(node);
          inserted++;
        } catch (e) { errors++; errList.push({ row: r, error: e.message }); }
      }
      res.json({ inserted, errors, total: rows.length, error_list: errList.slice(0, 10) });
    } catch (e) { next(e); }
  });

  // ECO 对比
  app.get('/api/equipment_instances/:id/bom/compare', (req, res) => {
    const { v1 = 'A0', v2 = 'A1' } = req.query;
    res.json(compareVersions(db, req.params.id, v1, v2));
  });
}

module.exports = { register, validateNode, validateTree, calcCost, compareVersions, parseCsv, BOM_FIELDS };