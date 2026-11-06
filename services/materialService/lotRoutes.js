"use strict";

const { wrap } = require("../../middleware/asyncHandler");
const audit = require("../../app/audit");

const MAX_QTY = 1e9;
const QUALITY_STATUSES = ["pending", "passed", "failed"];

function registerLotRoutes({ app, db, helpers, guards, ApiError }) {
  const { all, get, run } = helpers;
  const { requireLogin, requirePermission } = guards;

  // 2026-11-07 审计修复: 数量必须是有限正数 (原实现 <=0 / NaN 均能入库)
  const parsePositiveQty = (value, field) => {
    const n = Number(value);
    if (!Number.isFinite(n)) throw ApiError.validation(field + " 必须是数字");
    if (n <= 0) throw ApiError.validation(field + " 必须 > 0");
    if (n > MAX_QTY) throw ApiError.validation(field + " 超出上限 " + MAX_QTY);
    return Math.round(n * 1e6) / 1e6;
  };

  const normalizeUnit = (value, fallback) => {
    const text = String(value == null ? "" : value).trim() || String(fallback == null ? "" : fallback).trim();
    if (!text) throw ApiError.validation("单位必填");
    if (text.length > 32) throw ApiError.validation("单位过长(<=32 字符)");
    return text;
  };

  // 单位必须是物料基准单位, 或已登记换算规则里出现过的单位
  const assertUnitAllowed = (materialId, baseUnit, unit) => {
    if (!baseUnit || unit === baseUnit) return;
    const rule = get("SELECT id FROM material_units WHERE material_id = ? AND (from_unit = ? OR to_unit = ?) LIMIT 1", [materialId, unit, unit]);
    if (!rule) throw ApiError.validation("单位 " + unit + " 不在物料基准单位(" + baseUnit + ")或已登记换算规则内");
  };

  const normalizeQualityStatus = (value, fallback) => {
    const text = String(value == null ? "" : value).trim().toLowerCase();
    if (!text) return fallback;
    const normalized = text === "pass" ? "passed" : (text === "fail" ? "failed" : text);
    if (!QUALITY_STATUSES.includes(normalized)) throw ApiError.validation("quality_status 只接受 " + QUALITY_STATUSES.join("/"));
    return normalized;
  };

  app.get("/api/material_lots", wrap((req, res) => {
    const { material_id } = req.query;
    let sql = "SELECT ml.*, m.material_name FROM material_lots ml JOIN materials m ON ml.material_id = m.id";
    const params = [];
    if (material_id) {
      sql += " WHERE ml.material_id = ?";
      params.push(material_id);
    }
    sql += " ORDER BY ml.received_date DESC";
    res.json(all(sql, params));
  }));

  app.get("/api/material_lots/:id", wrap((req, res) => {
    if (requireLogin(req, res)) return;
    const id = parseInt(req.params.id);
    if (!id) throw ApiError.validation("id 必填且必须为数字");
    const lot = get("SELECT ml.*, m.material_code, m.material_name, m.spec, m.unit AS material_unit FROM material_lots ml JOIN materials m ON ml.material_id = m.id WHERE ml.id = ?", id);
    if (!lot) throw ApiError.notFound("lot 不存在");
    const inventory = all("SELECT location, quantity, unit, status, last_updated FROM inventory WHERE material_lot_id = ? ORDER BY location", id);
    const totalQty = inventory.reduce((sum, row) => sum + (row.quantity || 0), 0);
    const movements = all("SELECT movement_type, SUM(quantity) AS qty, COUNT(*) AS cnt FROM material_movements WHERE material_lot_id = ? GROUP BY movement_type", id);
    const movementStats = {};
    for (const movement of movements) movementStats[movement.movement_type] = { qty: movement.qty, cnt: movement.cnt };
    res.json({ ...lot, inventory, inventory_total: totalQty, movement_stats: movementStats });
  }));

  app.post("/api/material_lots/:id/split", wrap((req, res) => {
    if (requirePermission("material:write")(req, res)) return;
    const sourceId = parseInt(req.params.id);
    if (!sourceId) throw ApiError.validation("id 非法");
    const { quantity, new_lot_no, location, notes } = req.body;
    if (!new_lot_no) throw ApiError.validation("new_lot_no 必填");
    const newLotNo = String(new_lot_no).trim();
    if (!newLotNo) throw ApiError.validation("new_lot_no 不能为空");
    if (newLotNo.length > 64) throw ApiError.validation("new_lot_no 过长(<=64)");
    // 2026-11-07 审计修复: 原 Math.abs(Number()) 把 -5 静默变 5
    const amount = parsePositiveQty(quantity, "quantity");
    const duplicate = get("SELECT id FROM material_lots WHERE lot_no = ?", newLotNo);
    if (duplicate) throw ApiError.validation("新 lot_no 已存在");
    const result = db.transaction(() => {
      const source = get("SELECT * FROM material_lots WHERE id = ?", sourceId);
      if (!source) {
        const error = new Error("源 lot 不存在");
        error.status = 404;
        throw error;
      }
      const targetLocation = location || "主仓库-A-01";
      const inventory = get("SELECT id, quantity FROM inventory WHERE material_lot_id = ? AND location = ?", [sourceId, targetLocation]);
      if (!inventory || inventory.quantity < amount) {
        const error = new Error("源库位库存不足: 现有 " + (inventory ? inventory.quantity : 0) + ", 要拆 " + amount);
        error.status = 400;
        throw error;
      }
      run("UPDATE inventory SET quantity = quantity - ?, last_updated = datetime('now') WHERE id = ?", [amount, inventory.id]);
      const created = run(
        "INSERT INTO material_lots (material_id, lot_no, supplier, heat_no, certificate_no, received_date, quantity, unit, quality_status, notes) VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?)",
        [source.material_id, newLotNo, source.supplier, source.heat_no, source.certificate_no, amount, source.unit, source.quality_status, "由 " + source.lot_no + " 拆出 " + amount + (notes ? "; " + notes : "")]
      );
      const newId = created.lastInsertRowid;
      run("INSERT INTO inventory (material_lot_id, location, quantity, unit, status) VALUES (?, ?, ?, ?, 'available')", [newId, targetLocation, amount, source.unit]);
      run("INSERT INTO material_movements (material_lot_id, movement_type, quantity, unit, from_location, to_location, notes) VALUES (?, 'transfer', ?, ?, ?, ?, ?)",
        [sourceId, amount, source.unit, targetLocation, targetLocation, "split to " + newLotNo]);
      return { source_lot_id: sourceId, new_lot_id: newId, new_lot_no: newLotNo, quantity: amount, location: targetLocation };
    })();
    audit.record(db, req, {
      action: "material_lot.split",
      resource_type: "material_lot",
      resource_id: result.new_lot_id,
      after: result,
      diff_summary: "拆批 " + result.quantity + " -> " + result.new_lot_no,
    });
    res.json(result);
  }));

  app.post("/api/material_lots/:id/merge", wrap((req, res) => {
    if (requirePermission("material:write")(req, res)) return;
    const targetId = parseInt(req.params.id);
    if (!targetId) throw ApiError.validation("id 非法");
    const { source_lot_ids, location, notes } = req.body;
    if (!Array.isArray(source_lot_ids) || source_lot_ids.length === 0) throw ApiError.validation("source_lot_ids 数组必填");
    if (source_lot_ids.length > 50) throw ApiError.validation("源 lot 上限 50 个");
    // 2026-11-07 审计修复: 原实现直接 includes(targetId), 字符串 id "2" 可绕过"不能合到自身"
    const normalizedSourceIds = Array.from(new Set(source_lot_ids.map((value) => Number(value))));
    if (normalizedSourceIds.some((id) => !Number.isInteger(id) || id <= 0)) throw ApiError.validation("source_lot_ids 必须是正整数");
    if (normalizedSourceIds.includes(targetId)) throw ApiError.validation("不能合到自身");
    const result = db.transaction(() => {
      const target = get("SELECT * FROM material_lots WHERE id = ?", targetId);
      if (!target) {
        const error = new Error("目标 lot 不存在");
        error.status = 404;
        throw error;
      }
      const targetLocation = location || "主仓库-A-01";
      const merged = [];
      for (const sourceId of normalizedSourceIds) {
        const source = get("SELECT * FROM material_lots WHERE id = ?", sourceId);
        if (!source) {
          const error = new Error("源 lot " + sourceId + " 不存在");
          error.status = 404;
          throw error;
        }
        if (source.material_id !== target.material_id) {
          const error = new Error("源 lot " + sourceId + " 物料 " + source.material_id + " 与目标 " + target.material_id + " 不同");
          error.status = 400;
          throw error;
        }
        const inventory = get("SELECT id, quantity FROM inventory WHERE material_lot_id = ? AND location = ?", [sourceId, targetLocation]);
        if (!inventory) {
          const error = new Error("源 lot " + sourceId + " 在 " + targetLocation + " 无库存");
          error.status = 400;
          throw error;
        }
        if (!(Number(inventory.quantity) > 0)) {
          const error = new Error("源 lot " + sourceId + " 在 " + targetLocation + " 可合数量为 " + inventory.quantity + ", 必须 > 0");
          error.status = 400;
          throw error;
        }
        run("UPDATE inventory SET quantity = 0, last_updated = datetime('now') WHERE id = ?", [inventory.id]);
        const targetInventory = get("SELECT id FROM inventory WHERE material_lot_id = ? AND location = ?", [targetId, targetLocation]);
        if (targetInventory) {
          run("UPDATE inventory SET quantity = quantity + ?, last_updated = datetime('now') WHERE id = ?", [inventory.quantity, targetInventory.id]);
        } else {
          run("INSERT INTO inventory (material_lot_id, location, quantity, unit, status) VALUES (?, ?, ?, ?, 'available')", [targetId, targetLocation, inventory.quantity, source.unit]);
        }
        run("INSERT INTO material_movements (material_lot_id, movement_type, quantity, unit, from_location, to_location, notes) VALUES (?, 'transfer', ?, ?, ?, ?, ?)",
          [sourceId, inventory.quantity, source.unit, targetLocation, targetLocation, "merged to lot " + target.lot_no + (notes ? "; " + notes : "")]);
        merged.push({ source_lot_id: sourceId, source_lot_no: source.lot_no, quantity: inventory.quantity });
      }
      return { target_lot_id: targetId, target_lot_no: target.lot_no, location: targetLocation, merged };
    })();
    audit.record(db, req, {
      action: "material_lot.merge",
      resource_type: "material_lot",
      resource_id: result.target_lot_id,
      after: result,
      diff_summary: "合批 " + result.merged.length + " 个源批次 -> " + result.target_lot_no,
    });
    res.json(result);
  }));

  app.post("/api/material_lots/receive", wrap((req, res) => {
    if (requirePermission("material:write")(req, res)) return;
    const { material_id, lot_no, supplier, heat_no, certificate_no, quantity, unit, location, notes } = req.body;
    const materialId = Number(material_id);
    if (!Number.isInteger(materialId) || materialId <= 0) throw ApiError.validation("material_id 必须是正整数");
    const lotNo = String(lot_no == null ? "" : lot_no).trim();
    if (!lotNo) throw ApiError.validation("lot_no 必填");
    if (lotNo.length > 64) throw ApiError.validation("lot_no 过长(<=64)");
    const qty = parsePositiveQty(quantity, "quantity");
    const material = get("SELECT id, unit FROM materials WHERE id = ?", materialId);
    if (!material) throw ApiError.notFound("物料不存在");
    const duplicate = get("SELECT id FROM material_lots WHERE lot_no = ?", lotNo);
    if (duplicate) throw ApiError.validation("lot_no 已存在: " + lotNo);
    const targetLocation = String(location || "主仓库-A-01").trim();
    const targetUnit = normalizeUnit(unit, material.unit || "pcs");
    assertUnitAllowed(materialId, material.unit, targetUnit);
    const qualityStatus = normalizeQualityStatus(req.body.quality_status, "pending");
    const transaction = db.transaction(() => {
      const created = run(
        "INSERT INTO material_lots (material_id, lot_no, supplier, heat_no, certificate_no, received_date, quantity, unit, quality_status, notes) VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?)",
        [materialId, lotNo, supplier || null, heat_no || null, certificate_no || null, qty, targetUnit, qualityStatus, notes || null]
      );
      const lotId = created.lastInsertRowid;
      run("INSERT INTO inventory (material_lot_id, location, quantity, unit, status) VALUES (?, ?, ?, ?, 'available')", [lotId, targetLocation, qty, targetUnit]);
      run("INSERT INTO material_movements (material_lot_id, movement_type, quantity, unit, to_location, notes) VALUES (?, 'receive', ?, ?, ?, ?)",
        [lotId, qty, targetUnit, targetLocation, "一键入库: " + (notes || "")]);
      return { id: lotId };
    });
    const received = transaction();
    audit.record(db, req, {
      action: "material_lot.receive",
      resource_type: "material_lot",
      resource_id: received.id,
      after: { material_id: materialId, lot_no: lotNo, quantity: qty, unit: targetUnit, location: targetLocation, quality_status: qualityStatus },
      diff_summary: "入库 " + lotNo + " " + qty + targetUnit,
    });
    res.json(received);
  }));
}

module.exports = { registerLotRoutes };
