"use strict";
// 统一物料/备件库存服务：所有出入库都走这里，并同步 TPM 通用备件投影。
const { ApiError } = require("../app/errors");

function helpers(db) {
  return {
    get: (sql, params = []) => db.prepare(sql).get(...params),
    all: (sql, params = []) => db.prepare(sql).all(...params),
    run: (sql, params = []) => db.prepare(sql).run(...params),
  };
}

function findCommonSpare(db, materialId) {
  const { get } = helpers(db);
  const material = get("SELECT id, material_code, material_name, unit, safety_stock FROM materials WHERE id = ?", [materialId]);
  if (!material) return null;
  const spare = get(
    "SELECT * FROM equipment_spare_parts WHERE equipment_id IS NULL AND (material_id = ? OR (material_id IS NULL AND part_code = ?)) ORDER BY id LIMIT 1",
    [material.id, material.material_code],
  );
  return { material, spare };
}

function syncCommonSpare(db, materialId, delta) {
  try {
    const { run } = helpers(db);
    const found = findCommonSpare(db, materialId);
    if (!found || !found.spare) return null;
    if (found.spare.material_id == null) run("UPDATE equipment_spare_parts SET material_id = ? WHERE id = ?", [found.material.id, found.spare.id]);
    const next = Math.max(0, Number(found.spare.quantity || 0) + Number(delta));
    run("UPDATE equipment_spare_parts SET quantity = ?, updated_at = datetime('now') WHERE id = ?", [next, found.spare.id]);
    return { spare_id: found.spare.id, quantity: next };
  } catch (_error) {
    return null;
  }
}

function receiveStock(db, options = {}) {
  const { get, run } = helpers(db);
  const materialId = Number(options.materialId);
  const quantity = Number(options.quantity);
  if (!materialId || !(quantity > 0)) throw ApiError.validation("materialId/quantity 必须有效");
  const material = get("SELECT * FROM materials WHERE id = ?", [materialId]);
  if (!material) throw ApiError.notFound("物料不存在");
  const unit = options.unit || material.unit || "件";
  const location = options.location || "备件成品库";
  const inputLotNo = String(options.lotNo || "").trim();
  if (Number(material.lot_managed) === 1 && !inputLotNo) {
    throw ApiError.validation(`物料 ${material.material_code} 是批次管理件，必须填写批次号`);
  }
  const effectiveLotNo = String(inputLotNo || `DEFAULT-${material.material_code}`).slice(0, 64);
  const tx = db.transaction(() => {
    let lot = get("SELECT * FROM material_lots WHERE material_id = ? AND lot_no = ?", [materialId, effectiveLotNo]);
    const reused = Boolean(lot);
    if (!lot) {
      const created = run("INSERT INTO material_lots (material_id, lot_no, received_date, quantity, unit, quality_status, notes) VALUES (?, ?, datetime('now'), ?, ?, 'passed', ?)",
        [materialId, effectiveLotNo, quantity, unit, options.notes || "统一库存入库"]);
      lot = { id: Number(created.lastInsertRowid), lot_no: effectiveLotNo };
    } else {
      run("UPDATE material_lots SET quantity = quantity + ? WHERE id = ?", [quantity, lot.id]);
    }
    const inventory = get("SELECT id FROM inventory WHERE material_lot_id = ? AND location = ?", [lot.id, location]);
    if (inventory) {
      run("UPDATE inventory SET quantity = quantity + ?, last_updated = datetime('now') WHERE id = ?", [quantity, inventory.id]);
    } else {
      run("INSERT INTO inventory (material_lot_id, location, quantity, unit, status) VALUES (?, ?, ?, ?, 'available')", [lot.id, location, quantity, unit]);
    }
    const movement = run(`INSERT INTO material_movements (material_lot_id, movement_type, quantity, unit, to_location, operator_id, notes)
      VALUES (?, 'receive', ?, ?, ?, ?, ?)`,
      [lot.id, quantity, unit, location, options.operatorId || null, options.notes || options.sourceType || "入库"]);
    let spare = null;
    if (options.syncSpare !== false) spare = syncCommonSpare(db, materialId, quantity);
    return { lot_id: Number(lot.id), lot_no: lot.lot_no, material_id: materialId, quantity, unit, location, reused, movement_id: Number(movement.lastInsertRowid), spare };
  });
  return tx();
}

function issueStock(db, options = {}) {
  const { get, all, run } = helpers(db);
  const materialId = Number(options.materialId);
  const quantity = Number(options.quantity);
  if (!materialId || !(quantity > 0)) throw ApiError.validation("materialId/quantity 必须有效");
  const material = get("SELECT * FROM materials WHERE id = ?", [materialId]);
  if (!material) throw ApiError.notFound("物料不存在");
  const tx = db.transaction(() => {
    const lots = all(`SELECT i.id AS inventory_id, i.location, i.quantity, ml.id AS lot_id, ml.lot_no, ml.unit
                        FROM inventory i JOIN material_lots ml ON ml.id = i.material_lot_id
                       WHERE ml.material_id = ? AND i.quantity > 0 ${options.location ? "AND i.location = ?" : ""}
                       ORDER BY ml.id, i.id`, options.location ? [materialId, options.location] : [materialId]);
    const available = lots.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    if (available < quantity) throw ApiError.validation(`物料库存不足：${material.material_code} 需要 ${quantity}，可用 ${available}`);
    let remaining = quantity;
    const movements = [];
    for (const lot of lots) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, Number(lot.quantity));
      run("UPDATE inventory SET quantity = quantity - ?, last_updated=datetime('now') WHERE id = ?", [take, lot.inventory_id]);
      const movement = run(`INSERT INTO material_movements (material_lot_id, movement_type, quantity, unit, from_location, operator_id, notes)
        VALUES (?, 'issue', ?, ?, ?, ?, ?)`,
        [lot.lot_id, take, lot.unit || material.unit || "件", lot.location || null, options.operatorId || null, options.notes || options.sourceType || "出库"]);
      movements.push(Number(movement.lastInsertRowid));
      remaining -= take;
    }
    let spare = null;
    if (options.syncSpare !== false) spare = syncCommonSpare(db, materialId, -quantity);
    return { material_id: materialId, quantity, movements, spare };
  });
  return tx();
}

module.exports = { syncCommonSpare, findCommonSpare, receiveStock, issueStock };
