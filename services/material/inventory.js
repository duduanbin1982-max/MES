// services/material/inventory.js
// 库存 / 移动 / 调拨路由 — 从 materialService.js 拆分 (brooks-debt R1)
'use strict';

const { ApiError } = require("../../app/errors");
const { wrap } = require('../../middleware/asyncHandler');
const { DEFAULT_ROLE_PERMISSIONS, hasPermission } = require('../../app/permissions');
const { emit, Events } = require('../../app/ws/EventBus');
const { makeDbHelpers } = require('./core');

function register(app, db) {
function requireLogin(req, res) {
  if (!req.user) { throw ApiError.unauthorized(); }
  return false;
}

function requirePermission(...permCodes) {
  return (req, res) => {
    if (!req.user) { throw ApiError.unauthorized('未登录'); }
    const rolePerms = DEFAULT_ROLE_PERMISSIONS[req.user.role] || [];
    const userPerms = Array.isArray(req.user.permissions) ? req.user.permissions : rolePerms;
    const ok = permCodes.some(code => hasPermission(userPerms, code));
    if (!ok) {
      throw ApiError.forbidden('权限不足, 需要: ' + permCodes.join(' / '));
    }
    return false;
  };
}
  const { all, get, run } = makeDbHelpers(db);
  // P3-2 分页 + 日期范围 + 默认 50/页 (max 500) 防止 OOM
  app.get('/api/material_movements', wrap((req, res) => {
    if (requireLogin(req, res)) return;
    const { material_lot_id, work_order_id, project_id, movement_type, date_from, date_to, limit, offset } = req.query;
    const lim = Math.min(Math.max(parseInt(limit) || 50, 1), 500);
    const off = Math.max(parseInt(offset) || 0, 0);
    let base = 'FROM material_movements mm JOIN material_lots ml ON mm.material_lot_id = ml.id JOIN materials m ON ml.material_id = m.id WHERE 1=1';
    const params = [];
    if (material_lot_id) { base += ' AND mm.material_lot_id = ?'; params.push(material_lot_id); }
    if (work_order_id)   { base += ' AND mm.work_order_id = ?';   params.push(work_order_id); }
    if (project_id)      { base += ' AND mm.project_id = ?';      params.push(project_id); }
    if (movement_type)   { base += ' AND mm.movement_type = ?';   params.push(movement_type); }
    if (date_from)       { base += ' AND mm.created_at >= ?';     params.push(date_from); }
    if (date_to)         { base += ' AND mm.created_at <= ?';     params.push(date_to); }
    const total = get('SELECT COUNT(*) AS c ' + base, params).c;
    const rows = all('SELECT mm.*, ml.lot_no, m.material_name ' + base + ' ORDER BY mm.created_at DESC LIMIT ? OFFSET ?', params.concat([lim, off]));
    res.json({ total, limit: lim, offset: off, count: rows.length, items: rows });
  }));

  // P0-#2 事务化: movement + inventory.quantity 同步
  // P3-3 抽出单 movement 逻辑为 _applyMovement, POST /batch 复用
  const _defaultLocation = '主仓库-A-01';
  const _applyMovement = (m) => {
    const { material_lot_id, movement_type, quantity, unit, from_location, to_location, work_order_id, project_id, operator_id, notes } = m;
    if (!material_lot_id || !movement_type || quantity === undefined) throw ApiError.validation('material_lot_id/movement_type/quantity 必填')
    if (!['receive', 'issue', 'return', 'transfer', 'adjust'].includes(movement_type)) throw ApiError.validation('movement_type 非法')
    const lot = get('SELECT id, material_id FROM material_lots WHERE id = ?', material_lot_id);
    if (!lot) throw ApiError.notFound('lot 不存在')
    const absQty = Math.abs(Number(quantity));
    const r = run(
      "INSERT INTO material_movements (material_lot_id, movement_type, quantity, unit, from_location, to_location, work_order_id, project_id, operator_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [material_lot_id, movement_type, absQty, unit || null, from_location || null, to_location || null, work_order_id || null, project_id || null, operator_id || null, notes || null]
    );
    const movementId = r.lastInsertRowid;
    if (movement_type === 'receive') {
      const loc = to_location || _defaultLocation;
      const existing = get('SELECT id FROM inventory WHERE material_lot_id = ? AND location = ?', [material_lot_id, loc]);
      if (existing) {
        run("UPDATE inventory SET quantity = quantity + ?, status = ?, last_updated = datetime('now') WHERE id = ?", [absQty, 'available', existing.id]);
      } else {
        run("INSERT INTO inventory (material_lot_id, location, quantity, unit, status) VALUES (?, ?, ?, ?, 'available')", [material_lot_id, loc, absQty, unit || null]);
      }
    } else if (movement_type === 'issue') {
      const loc = from_location || _defaultLocation;
      const inv = get('SELECT id, quantity FROM inventory WHERE material_lot_id = ? AND location = ?', [material_lot_id, loc]);
      if (!inv) throw ApiError.validation('lot ' + material_lot_id + ' @ ' + loc + ' 无库存, 不能出库')
      if (inv.quantity < absQty) throw ApiError.validation('库存不足: 现有 ' + inv.quantity + ', 要出 ' + absQty)
      run("UPDATE inventory SET quantity = quantity - ?, last_updated = datetime('now') WHERE id = ?", [absQty, inv.id]);
      // P0-4: check if below safety stock
      const matRow = get('SELECT m.material_code, m.material_name, m.safety_stock FROM materials m JOIN material_lots ml ON ml.material_id = m.id WHERE ml.id = ?', [material_lot_id]);
      if (matRow && matRow.safety_stock > 0) {
        const totalQty = (get('SELECT SUM(quantity) AS qty FROM inventory WHERE material_lot_id = ?', [material_lot_id]) || {}).qty || 0;
        if (totalQty < matRow.safety_stock) {
          emit(Events.INVENTORY_LOW, { material_lot_id, material_code: matRow.material_code, material_name: matRow.material_name, available_qty: totalQty, safety_stock: matRow.safety_stock });
        }
      }
    } else if (movement_type === 'transfer') {
      if (!from_location || !to_location) throw ApiError.validation('transfer 必须带 from_location + to_location')
      const from = get('SELECT id, quantity FROM inventory WHERE material_lot_id = ? AND location = ?', [material_lot_id, from_location]);
      if (!from || from.quantity < absQty) throw ApiError.validation('源库位库存不足')
      run("UPDATE inventory SET quantity = quantity - ?, last_updated = datetime('now') WHERE id = ?", [absQty, from.id]);
      const to = get('SELECT id FROM inventory WHERE material_lot_id = ? AND location = ?', [material_lot_id, to_location]);
      if (to) {
        run("UPDATE inventory SET quantity = quantity + ?, last_updated = datetime('now') WHERE id = ?", [absQty, to.id]);
      } else {
        run("INSERT INTO inventory (material_lot_id, location, quantity, unit, status) VALUES (?, ?, ?, ?, 'available')", [material_lot_id, to_location, absQty, unit || null]);
      }
    } else if (movement_type === 'adjust') {
      const loc = to_location || from_location || _defaultLocation;
      const existing = get('SELECT id FROM inventory WHERE material_lot_id = ? AND location = ?', [material_lot_id, loc]);
      if (existing) {
        run("UPDATE inventory SET quantity = ?, status = ?, last_updated = datetime('now') WHERE id = ?", [absQty, 'available', existing.id]);
      } else {
        run("INSERT INTO inventory (material_lot_id, location, quantity, unit, status) VALUES (?, ?, ?, ?, 'available')", [material_lot_id, loc, absQty, unit || null]);
      }
    } else if (movement_type === 'return') {
      const loc = to_location || _defaultLocation;
      const existing = get('SELECT id FROM inventory WHERE material_lot_id = ? AND location = ?', [material_lot_id, loc]);
      if (existing) {
        run("UPDATE inventory SET quantity = quantity + ?, status = ?, last_updated = datetime('now') WHERE id = ?", [absQty, 'available', existing.id]);
      } else {
        run("INSERT INTO inventory (material_lot_id, location, quantity, unit, status) VALUES (?, ?, ?, ?, 'available')", [material_lot_id, loc, absQty, unit || null]);
      }
    }
    return { id: movementId };
  };

  app.post('/api/material_movements', wrap((req, res, next) => {
    if (requirePermission('material:write')(req, res)) return;
    try {
      const result = db.transaction(() => _applyMovement(req.body))();
      res.json(result);
    } catch (e) {
      next(e);
    }
  }));

  // P3-3 批量入库: atomic=true 全成功或全回滚, atomic=false 部分成功
  app.post('/api/material_movements/batch', wrap((req, res) => {
    if (requirePermission('material:write')(req, res)) return;
    const { movements, atomic } = req.body;
    if (!Array.isArray(movements) || movements.length === 0) throw ApiError.validation('movements 数组必填, 不能为空');
    if (movements.length > 500) throw ApiError.validation('movements 单批上限 500 条');
    if (atomic) {
      const ids = [];
      try {
        db.transaction(() => { for (let i = 0; i < movements.length; i++) ids.push(_applyMovement(movements[i]).id); })();
        res.json({ success: true, atomic: true, count: ids.length, ids });
      } catch (e) {
        res.status(e.status || 500).json({ success: false, atomic: true, error: e.message, failed_index: -1 });
      }
    } else {
      const results = [];
      const failed = [];
      for (let i = 0; i < movements.length; i++) {
        try {
          const r = db.transaction(() => _applyMovement(movements[i]))();
          results.push(r);
        } catch (e) {
          failed.push({ index: i, error: e.message });
        }
      }
      res.json({ success: failed.length === 0, atomic: false, count: results.length, ids: results.map(x => x.id), failed });
    }
  }));

  // P1-#5 库存预留 (work_order 锁定一批 lot)
  //   业务: 调度器预测"实际可用库存"时, allocated 也算 available 但要锁定
  //   schema: inventory.status 已有 allocated 字段, 但此前无端点用
  app.post('/api/inventory/allocate', wrap((req, res, next) => {
    if (requirePermission('material:admin')(req, res)) return;
    const { material_lot_id, work_order_id, quantity } = req.body;
    if (!material_lot_id || !work_order_id || !quantity) throw ApiError.validation('material_lot_id/work_order_id/quantity 必填');
    const q = Number(quantity);
    if (q <= 0) throw ApiError.validation('quantity 必须 > 0');

    const tx = db.transaction(() => {
      const inv = get("SELECT id, quantity, status, location FROM inventory WHERE material_lot_id = ? AND status = 'available'", material_lot_id);
      if (!inv) throw ApiError.validation('lot ' + material_lot_id + ' 无 available 库存')
      if (inv.quantity < q) throw ApiError.validation('available 不足: 现有 ' + inv.quantity + ', 要预留 ' + q)

      // 拆成两行: available 减, allocated 加 (同 lot 同 location)
      run("UPDATE inventory SET quantity = quantity - ?, last_updated = datetime('now') WHERE id = ?", [q, inv.id]);
      const existingAlloc = get("SELECT id, quantity FROM inventory WHERE material_lot_id = ? AND location = ? AND status = 'allocated'", [material_lot_id, inv.location]);
      if (existingAlloc) {
        run("UPDATE inventory SET quantity = quantity + ?, last_updated = datetime('now') WHERE id = ?", [q, existingAlloc.id]);
      } else {
        run("INSERT INTO inventory (material_lot_id, location, quantity, unit, status) SELECT material_lot_id, location, ?, unit, 'allocated' FROM inventory WHERE id = ?", [q, inv.id]);
      }
      // 记 movement (work_order 关联)
      run("INSERT INTO material_movements (material_lot_id, movement_type, quantity, unit, from_location, to_location, work_order_id, notes) SELECT material_lot_id, 'transfer', ?, unit, location, location, ?, '预留: ' || ? FROM inventory WHERE id = ?",
        [q, work_order_id, 'work_order ' + work_order_id, inv.id]);
      return { ok: true, lot_id: material_lot_id, allocated_qty: q, location: inv.location };
    });
    try {
      res.json(tx());
    } catch (e) { next(e); }
  }));

  // 释放预留 (allocated -> available)
  app.post('/api/inventory/release', wrap((req, res, next) => {
    if (requirePermission('material:admin')(req, res)) return;
    const { material_lot_id, work_order_id, quantity } = req.body;
    if (!material_lot_id || !work_order_id || !quantity) throw ApiError.validation('material_lot_id/work_order_id/quantity 必填');
    const q = Number(quantity);
    if (q <= 0) throw ApiError.validation('quantity 必须 > 0');

    const tx = db.transaction(() => {
      // 找该 work_order 的预留
      const alloc = get("SELECT id, quantity, location FROM inventory WHERE material_lot_id = ? AND status = 'allocated'", material_lot_id);
      if (!alloc) throw ApiError.validation('lot ' + material_lot_id + ' 无 allocated 库存')
      if (alloc.quantity < q) throw ApiError.validation('allocated 不足: 现有 ' + alloc.quantity + ', 要释放 ' + q)

      run("UPDATE inventory SET quantity = quantity - ?, last_updated = datetime('now') WHERE id = ?", [q, alloc.id]);
      const existingAvail = get("SELECT id, quantity FROM inventory WHERE material_lot_id = ? AND location = ? AND status = 'available'", [material_lot_id, alloc.location]);
      if (existingAvail) {
        run("UPDATE inventory SET quantity = quantity + ?, status = 'available', last_updated = datetime('now') WHERE id = ?", [q, existingAvail.id]);
      } else {
        run("INSERT INTO inventory (material_lot_id, location, quantity, unit, status) SELECT material_lot_id, location, ?, unit, 'available' FROM inventory WHERE id = ?", [q, alloc.id]);
      }
      run("INSERT INTO material_movements (material_lot_id, movement_type, quantity, unit, from_location, to_location, work_order_id, notes) SELECT material_lot_id, 'transfer', ?, unit, location, location, ?, '释放: ' || ? FROM inventory WHERE id = ?",
        [q, work_order_id, 'work_order ' + work_order_id, alloc.id]);
      return { ok: true, lot_id: material_lot_id, released_qty: q, location: alloc.location };
    });
    try {
      res.json(tx());
    } catch (e) { next(e); }
  }));

  // P2-7 工单→批次反向追溯
  app.get('/api/work_orders/:id/lots', wrap((req, res) => {
    const woId = req.params.id;
    const wo = get('SELECT id, wo_code FROM work_orders WHERE id = ?', woId);
    if (!wo) throw ApiError.notFound('工单不存在');
    const rows = all(`SELECT ml.id as lot_id, ml.lot_no, m.material_code, m.material_name, m.spec,
                             mm.movement_type, mm.quantity, mm.unit, mm.from_location, mm.to_location,
                             mm.created_at, mm.notes
                      FROM material_movements mm
                      JOIN material_lots ml ON mm.material_lot_id = ml.id
                      JOIN materials m ON ml.material_id = m.id
                      WHERE mm.work_order_id = ?
                      ORDER BY mm.created_at`, woId);
    const summary = {};
    rows.forEach(r => { summary[r.lot_no] = (summary[r.lot_no] || 0) + r.quantity; });
    res.json({ work_order: wo, movements: rows, lot_summary: summary });
  }));

  // P2-8 呆滞料预警 (90 天无 movement)
  app.get('/api/inventory/stagnant', wrap((req, res) => {
    const days = parseInt(req.query.days) || 90;
    const rows = all(`SELECT ml.id as lot_id, ml.lot_no, m.material_code, m.material_name, m.spec,
                             ml.supplier, ml.received_date,
                             i.quantity, i.unit, i.location, i.status, i.last_updated,
                             (julianday('now') - julianday(COALESCE(MAX(mm.created_at), ml.received_date))) as idle_days
                      FROM material_lots ml
                      JOIN materials m ON ml.material_id = m.id
                      LEFT JOIN inventory i ON i.material_lot_id = ml.id
                      LEFT JOIN material_movements mm ON mm.material_lot_id = ml.id
                      WHERE (i.status IS NULL OR i.status IN ('available', 'allocated'))
                        AND (i.quantity IS NULL OR i.quantity > 0)
                      GROUP BY ml.id
                      HAVING idle_days >= ?
                      ORDER BY idle_days DESC`, days);
    res.json({ count: rows.length, days, items: rows });
  }));

  // P2-9 物料单位换算 (1 卷 = factor 吨 / 1 箱 = factor 件)
  app.get('/api/materials/:id/units', wrap((req, res) => {
    const matId = req.params.id;
    const rows = all('SELECT * FROM material_units WHERE material_id = ? ORDER BY from_unit', matId);
    res.json({ count: rows.length, items: rows });
  }));

  app.post('/api/material_units', wrap((req, res) => {
    if (requirePermission('material:write')(req, res)) return;
    const { material_id, from_unit, to_unit, factor, notes } = req.body || {};
    if (!material_id || !from_unit || !to_unit || !factor) throw ApiError.validation('material_id/from_unit/to_unit/factor 必填');
    if (from_unit === to_unit) throw ApiError.validation('from_unit 和 to_unit 不能相同');
    const mat = get('SELECT id, unit FROM materials WHERE id = ?', material_id);
    if (!mat) throw ApiError.notFound('物料不存在');
    try {
      run('INSERT INTO material_units (material_id, from_unit, to_unit, factor, notes) VALUES (?, ?, ?, ?, ?)', [material_id, from_unit, to_unit, factor, notes || null]);
      res.json({ ok: true, id: db.lastInsertRowid, message: '已添加换算 ' + from_unit + ' -> ' + to_unit + ' (×' + factor + ')' });
    } catch (e) { throw e; }
  }));

  app.delete('/api/material_units/:id', wrap((req, res) => {
    if (requirePermission('material:write')(req, res)) return;
    const r = run('DELETE FROM material_units WHERE id = ?', req.params.id);
    res.json({ ok: true, changes: r.changes });
  }));


}

module.exports = { register };
