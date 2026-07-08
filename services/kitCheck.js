"use strict";
const { wrap } = require('../middleware/asyncHandler');
// services/kitCheck.js
// P0 物料齐套检查: 工单 -> BOM -> 库存 -> 缺料清单
//   GET /api/work_orders/:id/kit-check     齐套率 + 缺料明细
//   GET /api/work_orders/:id/kit-check/short 仅缺料项
// Author: 三狗子 | Date: 2026-06-25
// P1-3 refactor: 共享 core BOM聚合/库存查询/缺口计算

const { ApiError } = require("../app/errors");
const { getBomRows, aggregateDemand, getStockMap, computeKitItems } = require("./kitCheckCore");

function register(app, db) {
  const get = (sql, p = []) => db.prepare(sql).get(p);

  app.get("/api/work_orders/:id/kit-check", wrap((req, res) => {
    const wo = get("SELECT * FROM work_orders WHERE id = ?", req.params.id);
    if (!wo) throw ApiError.notFound("工单不存在");

    const eiId = wo.equipment_instance_id;

    // 1) 查 BOM
    const bomRows = getBomRows(db, eiId);
    if (!bomRows.length) {
      return res.json({ kit_ready: true, kit_rate: 100, total_items: 0, short_items: 0, items: [], summary: "无BOM物料" });
    }

    // 2) 按 material_id 聚合需求
    const demandMap = aggregateDemand(db, bomRows);
    const demandIds = Object.keys(demandMap).map(Number);
    if (!demandIds.length) {
      return res.json({ kit_ready: true, kit_rate: 100, total_items: 0, short_items: 0, items: [], summary: "BOM 无物料关联" });
    }

    // 3) 查库存
    const stockMap = getStockMap(db, demandIds);

    // 4) 计算齐套
    const items = computeKitItems(demandMap, stockMap);
    const totalItems = items.length;
    const shortItems = items.filter(i => i.shortage_qty > 0).length;
    const kitRate = totalItems > 0 ? Math.round(((totalItems - shortItems) / totalItems) * 100) : 100;

    res.json({
      wo_id: wo.id,
      wo_code: wo.wo_code,
      equipment_instance_id: eiId,
      kit_ready: shortItems === 0,
      kit_rate: kitRate,
      total_items: totalItems,
      short_items: shortItems,
      items,
      summary: shortItems === 0
        ? `全部 ${totalItems} 项物料齐套`
        : `${shortItems}/${totalItems} 项缺料, 齐套率 ${kitRate}%`,
    });
  }));

  // 仅缺料项
  app.get("/api/work_orders/:id/kit-check/short", wrap((req, res) => {
    const wo = get("SELECT * FROM work_orders WHERE id = ?", req.params.id);
    if (!wo) throw ApiError.notFound("工单不存在");

    const bomRows = getBomRows(db, wo.equipment_instance_id);
    const demandMap = aggregateDemand(db, bomRows);
    const demandIds = Object.keys(demandMap).map(Number);
    const stockMap = getStockMap(db, demandIds);
    const items = computeKitItems(demandMap, stockMap);
    const shorts = items.filter(i => i.shortage_qty > 0);

    res.json({ wo_id: wo.id, wo_code: wo.wo_code, short_count: shorts.length, items: shorts });
  }));
}

module.exports = { register };

