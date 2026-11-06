"use strict";
// services/material/inventory.js 的 register() 前置逻辑

const { emit, Events } = require('../../../app/ws/EventBus');
const { DEFAULT_ROLE_PERMISSIONS, hasPermission } = require('../../../app/permissions');
const { makeDbHelpers } = require('../core');
const { ApiError } = require("../../../app/errors");


module.exports = function createContext(app, db, deps) {

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


  // P0-#2 事务化: movement + inventory.quantity 同步
  // P3-3 抽出单 movement 逻辑为 _applyMovement, POST /batch 复用
  const _defaultLocation = '主仓库-A-01';

  const _upsertAvailableInventory = ({ materialLotId, location, quantity, unit, replace = false, setAvailable = true }) => {
    const existing = get('SELECT id FROM inventory WHERE material_lot_id = ? AND location = ?', [materialLotId, location]);
    if (existing) {
      const quantitySql = replace ? 'quantity = ?' : 'quantity = quantity + ?';
      const statusSql = setAvailable ? ', status = ?' : '';
      const params = setAvailable ? [quantity, 'available', existing.id] : [quantity, existing.id];
      run(`UPDATE inventory SET ${quantitySql}${statusSql}, last_updated = datetime('now') WHERE id = ?`, params);
      return;
    }
    run("INSERT INTO inventory (material_lot_id, location, quantity, unit, status) VALUES (?, ?, ?, ?, 'available')", [materialLotId, location, quantity, unit || null]);
  };

  const _receiveMovement = ({ material_lot_id, to_location, absQty, unit }) => {
    _upsertAvailableInventory({
      materialLotId: material_lot_id,
      location: to_location || _defaultLocation,
      quantity: absQty,
      unit,
    });
  };

  const _issueMovement = ({ material_lot_id, from_location, absQty }) => {
    const location = from_location || _defaultLocation;
    const inventory = get('SELECT id, quantity, status FROM inventory WHERE material_lot_id = ? AND location = ?', [material_lot_id, location]);
    if (!inventory) throw ApiError.validation('lot ' + material_lot_id + ' @ ' + location + ' 无库存, 不能出库');
    // 2026-11-07 审计修复: 只有 available 可出库, 隔离/预留库存必须走质量处置或释放
    if (inventory.status && inventory.status !== 'available') {
      throw ApiError.validation('库位 ' + location + ' 批次状态为 ' + inventory.status + ', 不能出库(仅 available 可出)');
    }
    if (inventory.quantity < absQty) throw ApiError.validation('库存不足: 现有 ' + inventory.quantity + ', 要出 ' + absQty);

    run("UPDATE inventory SET quantity = quantity - ?, last_updated = datetime('now') WHERE id = ?", [absQty, inventory.id]);
    const material = get('SELECT m.material_code, m.material_name, m.safety_stock, m.reorder_point FROM materials m JOIN material_lots ml ON ml.material_id = m.id WHERE ml.id = ?', [material_lot_id]);
    if (!material) return;
    // 2026-11-07: 补货线 = max(safety_stock, reorder_point), 与 queryLowStock 保持一致
    const threshold = Math.max(Number(material.safety_stock) || 0, Number(material.reorder_point) || 0);
    if (threshold <= 0) return;

    const totalQty = (get('SELECT SUM(quantity) AS qty FROM inventory WHERE material_lot_id = ? AND status = ?', [material_lot_id, 'available']) || {}).qty || 0;
    if (totalQty >= threshold) return;
    emit(Events.INVENTORY_LOW, {
      material_lot_id,
      material_code: material.material_code,
      material_name: material.material_name,
      available_qty: totalQty,
      safety_stock: material.safety_stock,
      threshold,
      shortage_qty: Math.round((threshold - totalQty) * 1000) / 1000,
    });
  };

  const _transferMovement = ({ material_lot_id, from_location, to_location, absQty, unit }) => {
    if (!from_location || !to_location) throw ApiError.validation('transfer 必须带 from_location + to_location');
    const source = get('SELECT id, quantity FROM inventory WHERE material_lot_id = ? AND location = ?', [material_lot_id, from_location]);
    if (!source || source.quantity < absQty) throw ApiError.validation('源库位库存不足');

    run("UPDATE inventory SET quantity = quantity - ?, last_updated = datetime('now') WHERE id = ?", [absQty, source.id]);
    _upsertAvailableInventory({ materialLotId: material_lot_id, location: to_location, quantity: absQty, unit, setAvailable: false });
  };

  const _adjustMovement = ({ material_lot_id, from_location, to_location, absQty, unit }) => {
    _upsertAvailableInventory({
      materialLotId: material_lot_id,
      location: to_location || from_location || _defaultLocation,
      quantity: absQty,
      unit,
      replace: true,
    });
  };

  const _movementHandlers = {
    receive: _receiveMovement,
    issue: _issueMovement,
    return: _receiveMovement,
    transfer: _transferMovement,
    adjust: _adjustMovement,
  };

  const MAX_MOVEMENT_QTY = 1e9;
  // 2026-11-07 审计修复: 数量必须是有限正数。原实现 Math.abs(Number(q)) 会把 -5 静默
  // 变成 5(负库存被当出库), 'abc' 变成 NaN 写库触发 NOT NULL 约束 500。
  const _parseMovementQty = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) throw ApiError.validation('quantity 必须是数字');
    if (n <= 0) throw ApiError.validation('quantity 必须 > 0');
    if (n > MAX_MOVEMENT_QTY) throw ApiError.validation('quantity 超出上限 ' + MAX_MOVEMENT_QTY);
    return Math.round(n * 1e6) / 1e6;
  };

  const _applyMovement = (m) => {
    const { material_lot_id, movement_type, quantity, unit, from_location, to_location, work_order_id, project_id, operator_id, notes } = m;
    if (!material_lot_id || !movement_type || quantity === undefined || quantity === null || quantity === '') throw ApiError.validation('material_lot_id/movement_type/quantity 必填');
    if (!_movementHandlers[movement_type]) throw ApiError.validation('movement_type 非法');
    const lot = get('SELECT id, material_id FROM material_lots WHERE id = ?', material_lot_id);
    if (!lot) throw ApiError.notFound('lot 不存在');
    const absQty = _parseMovementQty(quantity);
    const r = run(
      "INSERT INTO material_movements (material_lot_id, movement_type, quantity, unit, from_location, to_location, work_order_id, project_id, operator_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [material_lot_id, movement_type, absQty, unit || null, from_location || null, to_location || null, work_order_id || null, project_id || null, operator_id || null, notes || null]
    );
    _movementHandlers[movement_type]({ material_lot_id, from_location, to_location, absQty, unit });
    return { id: r.lastInsertRowid };
  };



  // P3-3 批量入库: atomic=true 全成功或全回滚, atomic=false 部分成功


  // P1-#5 库存预留 (work_order 锁定一批 lot)
  //   业务: 调度器预测"实际可用库存"时, allocated 也算 available 但要锁定
  //   schema: inventory.status 已有 allocated 字段, 但此前无端点用


  // 释放预留 (allocated -> available)


  // P2-7 工单→批次反向追溯


  // P2-8 呆滞料预警 (90 天无 movement)


  // P2-9 物料单位换算 (1 卷 = factor 吨 / 1 箱 = factor 件)
  return { _adjustMovement, _applyMovement, _defaultLocation, _issueMovement, _movementHandlers, _receiveMovement, _transferMovement, _upsertAvailableInventory, all, get, requireLogin, requirePermission, run };
};
