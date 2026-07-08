"use strict";
const { wrap } = require('../middleware/asyncHandler');
// services/pickService.js
// P1 领料/退料工作流 (基于 BOM + 库存 + material_movements)
//   GET  /api/work_orders/:id/pick-list    生成领料单 (BOM需求 vs 库存可用)
//   POST /api/work_orders/:id/pick         执行领料 (批量出库, 事务)
//   POST /api/work_orders/:id/return       退料 (余料回库)
//   GET  /api/work_orders/:id/pick-history 领退料历史
// Author: 三狗子 | Date: 2026-06-26

const { ApiError } = require("../app/errors");
const { emit, Events } = require("../app/ws/EventBus");

function register(app, db) {
  const all = (sql, p = []) => db.prepare(sql).all(p);
  const get = (sql, p = []) => db.prepare(sql).get(p);
  const run = (sql, p = []) => db.prepare(sql).run(p);
  

  const DEFAULT_LOCATION = "主仓库-A-01";

  // ====== 1. 生成领料单 ======
  app.get("/api/work_orders/:id/pick-list", wrap((req, res) => {
    const wo = get("SELECT * FROM work_orders WHERE id = ?", req.params.id);
    if (!wo) throw ApiError.notFound("工单不存在")

    const eiId = wo.equipment_instance_id;

    // BOM 物料 (排除虚项、替代料、tier=0)
    const bomRows = all(
      `SELECT ib.id AS bom_id, ib.material_id, ib.quantity, ib.unit, ib.scrap_factor,
              ib.tier, ib.part_number, ib.category, ib.storage_location,
              m.material_code, m.material_name, m.spec
       FROM instance_bom ib
       LEFT JOIN materials m ON ib.material_id = m.id
       WHERE ib.equipment_instance_id = ? AND ib.tier > 0
         AND ib.is_phantom = 0 AND ib.is_alternative = 0
         AND ib.material_id IS NOT NULL
       ORDER BY ib.tier, ib.id`,
      eiId
    );

    if (!bomRows.length) return res.json({ wo_id: wo.id, wo_code: wo.wo_code, items: [], total_qty: 0 });

    // 汇总需求
    const demandMap = {};
    for (const b of bomRows) {
      const key = b.material_id;
      if (!demandMap[key]) {
        demandMap[key] = {
          material_id: b.material_id,
          material_code: b.material_code || "N/A",
          material_name: b.material_name || b.part_number || "未知",
          spec: b.spec || "",
          unit: b.unit || "件",
          bom_qty: 0,
          storage_location: b.storage_location || DEFAULT_LOCATION,
          bom_nodes: [],
        };
      }
      const qty = (b.quantity || 0) * (b.scrap_factor || 1);
      demandMap[key].bom_qty += qty;
      demandMap[key].bom_nodes.push({ bom_id: b.bom_id, tier: b.tier, part_number: b.part_number, qty_per: b.quantity, category: b.category });
    }

    const demandIds = Object.keys(demandMap).map(Number);
    const items = [];

    if (demandIds.length) {
      // 已领料量 (该工单的 issue movements)
      const pickedMap = {};
      const pickedRows = all(
        `SELECT ml.material_id, SUM(mm.quantity) AS picked_qty
         FROM material_movements mm
         JOIN material_lots ml ON mm.material_lot_id = ml.id
         WHERE mm.work_order_id = ? AND mm.movement_type = 'issue'
         GROUP BY ml.material_id`,
        wo.id
      );
      for (const r of pickedRows) pickedMap[r.material_id] = r.picked_qty;

      // 库存可用量
      const ph = demandIds.map(() => "?").join(",");
      const invRows = all(
        `SELECT ml.material_id, i.location, SUM(i.quantity) AS available_qty
         FROM inventory i
         JOIN material_lots ml ON i.material_lot_id = ml.id
         WHERE ml.material_id IN (${ph}) AND i.status = 'available'
         GROUP BY ml.material_id, i.location`,
        demandIds
      );

      const stockMap = {};
      for (const r of invRows) {
        if (!stockMap[r.material_id]) stockMap[r.material_id] = [];
        stockMap[r.material_id].push({ location: r.location, qty: r.available_qty });
      }

      for (const [mid, d] of Object.entries(demandMap)) {
        const midNum = Number(mid);
        const alreadyPicked = pickedMap[midNum] || 0;
        const remaining = Math.max(0, d.bom_qty - alreadyPicked);
        const totalAvail = (stockMap[midNum] || []).reduce((s, l) => s + l.qty, 0);

        items.push({
          material_id: midNum,
          material_code: d.material_code,
          material_name: d.material_name,
          spec: d.spec,
          unit: d.unit,
          bom_required: Math.round(d.bom_qty * 1000) / 1000,
          already_picked: Math.round(alreadyPicked * 1000) / 1000,
          remaining: Math.round(remaining * 1000) / 1000,
          available_qty: Math.round(totalAvail * 1000) / 1000,
          storage_location: d.storage_location,
          status: remaining <= 0 ? "done"
            : totalAvail <= 0 ? "empty"
            : totalAvail < remaining ? "short"
            : "ready",
          stock_locations: (stockMap[midNum] || []).slice(0, 5),
          bom_nodes: d.bom_nodes.slice(0, 3),
        });
      }
    }

    const totalQty = items.reduce((s, i) => s + i.bom_required, 0);
    const doneCount = items.filter((i) => i.status === "done").length;
    const readyCount = items.filter((i) => i.status === "ready").length;
    const shortCount = items.filter((i) => i.status === "short" || i.status === "empty").length;

    res.json({
      wo_id: wo.id,
      wo_code: wo.wo_code,
      wo_title: wo.title,
      total_items: items.length,
      done_items: doneCount,
      ready_items: readyCount,
      short_items: shortCount,
      total_bom_qty: Math.round(totalQty * 1000) / 1000,
      items: items.sort((a, b) => {
        const order = { empty: 0, short: 1, ready: 2, done: 3 };
        return (order[a.status] || 0) - (order[b.status] || 0);
      }),
    });
  }));

  // ====== 2. 执行领料 (批量出库) ======
  app.post("/api/work_orders/:id/pick", wrap((req, res) => {
    const wo = get("SELECT * FROM work_orders WHERE id = ?", req.params.id);
    if (!wo) throw ApiError.notFound("工单不存在")

    const { items, operator_id, location } = req.body;
    if (!Array.isArray(items) || !items.length) {
      throw ApiError.validation("items 数组必填, 格式: [{material_id, lot_id, quantity}]")
    }

    const opId = operator_id || (req.user && req.user.sub);
    const loc = location || DEFAULT_LOCATION;

    const results = [];
    const errors = [];

    const tx = db.transaction(() => {
      for (const item of items) {
        try {
          const { material_id, lot_id, quantity } = item;
          if (!material_id || !quantity || quantity <= 0) {
            errors.push({ material_id, error: "material_id/quantity 必填且 quantity > 0" });
            continue;
          }

          // 确定 lot (可指定或自动找第一条 available)
          let lot;
          if (lot_id) {
            lot = get("SELECT * FROM material_lots WHERE id = ? AND material_id = ?", [lot_id, material_id]);
          } else {
            lot = get(
              `SELECT ml.* FROM material_lots ml
               JOIN inventory i ON i.material_lot_id = ml.id
               WHERE ml.material_id = ? AND i.location = ? AND i.status = 'available' AND i.quantity >= ?
               ORDER BY ml.received_date ASC LIMIT 1`,
              [material_id, loc, quantity]
            );
          }
          if (!lot) {
            errors.push({ material_id, error: "无可用库存 (material=" + material_id + ", loc=" + loc + ")" });
            continue;
          }

          // 校验库存
          const inv = get(
            "SELECT id, quantity FROM inventory WHERE material_lot_id = ? AND location = ? AND status = 'available'",
            [lot.id, loc]
          );
          if (!inv || inv.quantity < quantity) {
            errors.push({
              material_id,
              lot_id: lot.id,
              error: "库存不足: 现有 " + (inv ? inv.quantity : 0) + ", 要领 " + quantity,
            });
            continue;
          }

          // 出库: inventory -qty
          run("UPDATE inventory SET quantity = quantity - ?, last_updated = datetime('now') WHERE id = ?", [quantity, inv.id]);

          // 记 movement (issue)
          const r = run(
            `INSERT INTO material_movements (material_lot_id, movement_type, quantity, unit, from_location, work_order_id, operator_id, notes)
             VALUES (?, 'issue', ?, ?, ?, ?, ?, ?)`,
            [lot.id, quantity, lot.unit || "件", loc, wo.id, opId, "领料: WO-" + wo.wo_code]
          );

          results.push({
            movement_id: Number(r.lastInsertRowid),
            material_id,
            lot_id: lot.id,
            lot_no: lot.lot_no,
            quantity,
            location: loc,
          });
        } catch (e) {
          errors.push({ material_id: item.material_id, error: e.message });
        }
      }
    });

    try {
      tx();
    } catch (e) {
      return res.status(500).json({ error: "事务失败: " + e.message, results, errors });
    }

    if (results.length) {
      emit(Events.INVENTORY_LOW, {
        wo_id: wo.id,
        wo_code: wo.wo_code,
        picked_items: results.length,
        operator_id: opId,
      });
    }

    res.json({
      wo_id: wo.id,
      wo_code: wo.wo_code,
      picked: results.length,
      errors: errors.length,
      results,
      errors_detail: errors.length ? errors : undefined,
    });
  }));

  // ====== 3. 退料 (余料回库) ======
  app.post("/api/work_orders/:id/return", wrap((req, res) => {
    const wo = get("SELECT * FROM work_orders WHERE id = ?", req.params.id);
    if (!wo) throw ApiError.notFound("工单不存在")

    const { items, operator_id, location, reason } = req.body;
    if (!Array.isArray(items) || !items.length) {
      throw ApiError.validation("items 数组必填, 格式: [{lot_id, quantity, reason}]")
    }

    const opId = operator_id || (req.user && req.user.sub);
    const loc = location || DEFAULT_LOCATION;

    const results = [];
    const errors = [];

    const tx = db.transaction(() => {
      for (const item of items) {
        try {
          const { lot_id, quantity } = item;
          if (!lot_id || !quantity || quantity <= 0) {
            errors.push({ lot_id, error: "lot_id/quantity 必填且 quantity > 0" });
            continue;
          }

          const lot = get("SELECT * FROM material_lots WHERE id = ?", lot_id);
          if (!lot) {
            errors.push({ lot_id, error: "批次不存在" });
            continue;
          }

          // 回库: inventory +qty (upsert)
          const existing = get("SELECT id FROM inventory WHERE material_lot_id = ? AND location = ?", [lot_id, loc]);
          if (existing) {
            run("UPDATE inventory SET quantity = quantity + ?, status = 'available', last_updated = datetime('now') WHERE id = ?", [quantity, existing.id]);
          } else {
            run("INSERT INTO inventory (material_lot_id, location, quantity, unit, status) VALUES (?, ?, ?, ?, 'available')",
              [lot_id, loc, quantity, lot.unit || "件"]);
          }

          // 记 movement (return)
          const r = run(
            `INSERT INTO material_movements (material_lot_id, movement_type, quantity, unit, to_location, work_order_id, operator_id, notes)
             VALUES (?, 'return', ?, ?, ?, ?, ?, ?)`,
            [lot_id, quantity, lot.unit || "件", loc, wo.id, opId, (item.reason || reason || "退料") + " WO-" + wo.wo_code]
          );

          results.push({
            movement_id: Number(r.lastInsertRowid),
            lot_id,
            lot_no: lot.lot_no,
            quantity,
            reason: item.reason || reason || "",
          });
        } catch (e) {
          errors.push({ lot_id: item.lot_id, error: e.message });
        }
      }
    });

    try { tx(); } catch (e) {
      return res.status(500).json({ error: "事务失败: " + e.message, results, errors });
    }

    res.json({
      wo_id: wo.id,
      wo_code: wo.wo_code,
      returned: results.length,
      errors: errors.length,
      results,
      errors_detail: errors.length ? errors : undefined,
    });
  }));

  // ====== 4. 领退料历史 ======
  app.get("/api/work_orders/:id/pick-history", wrap((req, res) => {
    const wo = get("SELECT id, wo_code FROM work_orders WHERE id = ?", req.params.id);
    if (!wo) throw ApiError.notFound("工单不存在")

    const rows = all(
      `SELECT mm.id, mm.movement_type, mm.quantity, mm.unit, mm.from_location, mm.to_location,
              mm.notes, mm.created_at,
              ml.lot_no, ml.supplier, ml.heat_no,
              m.material_code, m.material_name,
              u.full_name AS operator_name
       FROM material_movements mm
       JOIN material_lots ml ON mm.material_lot_id = ml.id
       JOIN materials m ON ml.material_id = m.id
       LEFT JOIN users u ON mm.operator_id = u.id
       WHERE mm.work_order_id = ? AND mm.movement_type IN ('issue', 'return')
       ORDER BY mm.created_at DESC`,
      wo.id
    );

    // 汇总
    const summary = { issue: { count: 0, total_qty: 0 }, return: { count: 0, total_qty: 0 } };
    for (const r of rows) {
      if (r.movement_type === "issue") { summary.issue.count++; summary.issue.total_qty += r.quantity; }
      else if (r.movement_type === "return") { summary.return.count++; summary.return.total_qty += r.quantity; }
    }

    res.json({ work_order: wo, summary, movements: rows, count: rows.length });
  }));
}

module.exports = { register };
