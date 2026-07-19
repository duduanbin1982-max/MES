// services/supplierDashboardService.js
// 供应商协同看板 —— 评分 / 采购跟催 / 来料检验 / 外协进度
"use strict";
const { makeDbHelpers } = require("../app/dbHelpers");
const { wrap } = require("../middleware/asyncHandler");

function register(app, db) {
  const { get, all, run } = makeDbHelpers(db);

  app.get("/api/supplier/dashboard", wrap((req, res) => {
    // 供应商列表 + 最新评分
    const suppliers = all(`
      SELECT s.*, 
        (SELECT total_score FROM supplier_score_snapshots ss WHERE ss.supplier_id = s.id ORDER BY period DESC LIMIT 1) AS latest_score,
        (SELECT grade FROM supplier_score_snapshots ss WHERE ss.supplier_id = s.id ORDER BY period DESC LIMIT 1) AS latest_grade,
        (SELECT COUNT(*) FROM purchase_orders po WHERE po.supplier_id = s.id) AS po_count,
        (SELECT COUNT(*) FROM incoming_inspections ii WHERE ii.supplier_id = s.id) AS inspection_count,
        (SELECT COUNT(*) FROM outsourcing_orders oo WHERE oo.supplier_id = s.id) AS outsource_count
      FROM suppliers s
      WHERE s.is_active = 1
      ORDER BY latest_score DESC
    `);

    // 评分历史
    const scores = all(`
      SELECT ss.*, s.supplier_name FROM supplier_score_snapshots ss
      LEFT JOIN suppliers s ON s.id = ss.supplier_id
      ORDER BY ss.period DESC, ss.total_score DESC
    `);

    // 采购跟催
    const tracking = all(`
      SELECT pt.*, s.supplier_name FROM purchase_tracking pt
      LEFT JOIN purchase_orders po ON po.id = pt.purchase_order_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      ORDER BY pt.risk_level DESC, pt.planned_delivery ASC
    `);

    // 来料检验
    const inspections = all(`
      SELECT ii.*, s.supplier_name, m.material_name
      FROM incoming_inspections ii
      LEFT JOIN suppliers s ON s.id = ii.supplier_id
      LEFT JOIN materials m ON m.id = ii.material_id
      ORDER BY ii.inspection_date DESC
    `);

    // 采购订单
    const orders = all(`
      SELECT po.*, s.supplier_name, ei.instance_name
      FROM purchase_orders po
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      LEFT JOIN equipment_instances ei ON ei.id = po.equipment_instance_id
      ORDER BY po.expected_date ASC
    `);

    // 外协
    const outsource = all(`
      SELECT oo.*, s.supplier_name, ei.instance_name
      FROM outsourcing_orders oo
      LEFT JOIN suppliers s ON s.id = oo.supplier_id
      LEFT JOIN equipment_instances ei ON ei.id = oo.equipment_instance_id
      ORDER BY oo.planned_finish ASC
    `);

    res.json({
      suppliers, scores, tracking, inspections, orders, outsource,
      overview: {
        total_suppliers: suppliers.length,
        a_grade: suppliers.filter(s => s.latest_grade === "A").length,
        active_tracking: tracking.filter(t => t.status === "following").length,
        overdue_tracking: tracking.filter(t => t.delay_days > 0).length,
        fail_inspections: inspections.filter(i => i.result === "fail").length,
        active_outsource: outsource.filter(o => o.status !== "completed").length,
      }
    });
  }));

  console.log("[supplierDashboard] Registered");
}

module.exports = { register };
