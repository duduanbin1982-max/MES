"use strict";
// services/cost/variance/index.js
// P2-2（2026-10-19）：成本三层差异接口。
//   GET /api/equipment_instances/:id/cost_variance   项目级：材料量差/价差 + 人工效率差/费率差
//   GET /api/cost/work_orders/:id/variance           工单级：人工三层 + 材料价差（量差需工单级 BOM 用量，暂缺）
//
// 数据来源：instance_bom（标准用量）+ materials（标准/实际单价）+ material_movements（实际领用）
//          + process_nodes / work_order_operations（标准/实际工时）+ system_settings（人工费率）

const { wrap } = require("../../../middleware/asyncHandler");
const { materialVariance, laborVariance, summarize, pickLaborRate, laborCoverageOk, round2 } = require("../../../app/cost/variance");

function register(app, db) {
  const all = (sql, ...params) => db.prepare(sql).all(...params);
  const get = (sql, ...params) => db.prepare(sql).get(...params);
  const safeAll = (sql, ...params) => { try { return all(sql, ...params); } catch (_error) { return []; } };

  function resolveRate() {
    // system_settings 可能不存在（老库）→ 用 IIFE 包一层，避免"赋值后未使用"的 lint 噪音
    const rateRow = (() => {
      try {
        return get("SELECT value FROM system_settings WHERE key = 'labor_rate_per_hour'");
      } catch (_error) {
        return null;
      }
    })();
    const settingValue = rateRow ? rateRow.value : null;
    return pickLaborRate({ settingValue, envValue: process.env.LABOR_RATE_PER_HOUR || null, fallback: 200 });
  }

  // ---------------- 项目级三层差异
  app.get("/api/equipment_instances/:id/cost_variance", wrap((req, res) => {
    const instance = get("SELECT id, instance_code, instance_name FROM equipment_instances WHERE id = ?", req.params.id);
    if (!instance) return res.status(404).json({ error: "equipment_instance not found" });

    // 标准：BOM 用量 × 标准单价（materials.estimated_unit_price，缺则用 actual，再缺用 0）
    const bomRows = all(`
      SELECT ib.material_id, m.material_code, m.material_name,
             SUM(ib.quantity) AS standard_qty,
             COALESCE(NULLIF(m.estimated_unit_price, 0), NULLIF(m.actual_unit_price, 0), 0) AS standard_price,
             COALESCE(NULLIF(m.actual_unit_price, 0), NULLIF(m.estimated_unit_price, 0), 0) AS actual_price
      FROM instance_bom ib
      JOIN materials m ON m.id = ib.material_id
      WHERE ib.equipment_instance_id = ? AND ib.material_id IS NOT NULL
      GROUP BY ib.material_id
      ORDER BY ib.material_id
    `, instance.id);

    // 实际：本项目的领料数量（含该装备下工单的领料）
    const issueRows = all(`
      SELECT ml.material_id, SUM(mm.quantity) AS actual_qty
      FROM material_movements mm
      JOIN material_lots ml ON ml.id = mm.material_lot_id
      WHERE mm.movement_type = 'issue'
        AND (mm.project_id = ? OR mm.work_order_id IN (SELECT id FROM work_orders WHERE equipment_instance_id = ?))
      GROUP BY ml.material_id
    `, instance.id, instance.id);
    const actualByMaterial = new Map(issueRows.map((row) => [Number(row.material_id), Number(row.actual_qty) || 0]));
    const purchaseRows = safeAll(`
      SELECT poi.material_id,
             SUM(CASE WHEN COALESCE(poi.received_qty, 0) > 0 THEN poi.received_qty ELSE poi.quantity END) AS actual_qty,
             SUM(COALESCE(poi.total_price, poi.quantity * poi.unit_price, 0)) AS actual_amount
        FROM purchase_order_items poi JOIN purchase_orders po ON po.id = poi.po_id
       WHERE po.equipment_instance_id = ? AND poi.material_id IS NOT NULL
       GROUP BY poi.material_id`, instance.id);
    const purchaseByMaterial = new Map(purchaseRows.map((row) => [Number(row.material_id), { qty: Number(row.actual_qty || 0), amount: Number(row.actual_amount || 0) }]));

    const materialLines = bomRows.map((row) => {
      const purchase = purchaseByMaterial.get(Number(row.material_id));
      const hasIssue = actualByMaterial.has(Number(row.material_id)) || Boolean(purchase && purchase.qty > 0);
      const actualQty = purchase && purchase.qty > 0 ? purchase.qty : (actualByMaterial.get(Number(row.material_id)) || 0);
      const actualPrice = purchase && purchase.amount > 0 && purchase.qty > 0 ? round2(purchase.amount / purchase.qty) : row.actual_price;
      const line = materialVariance({
        standardQty: row.standard_qty,
        actualQty,
        standardPrice: row.standard_price,
        actualPrice,
      });
      return {
        ...line,
        material_id: row.material_id,
        material_code: row.material_code,
        material_name: row.material_name,
        actual_missing: !hasIssue,
        actual_source: purchase && purchase.qty > 0 ? "purchase_order" : (hasIssue ? "material_movement" : "none"),
        price_missing: !actualPrice || !row.standard_price,
        // 没领料就没有量差：标为不可用，金额进 not_computed，不能算成"节约"
        available: hasIssue,
        unavailable_reason: hasIssue ? null : "no_issue_record",
      };
    });

    // 人工：标准工时 = 工艺节点估算；实际工时 = 报工（无报工时退化为工单 actual_hours）
    const stdHours = get("SELECT COALESCE(SUM(estimated_hours), 0) AS h FROM process_nodes WHERE equipment_instance_id = ?", instance.id).h;
    const reportedHours = get(`
      SELECT COALESCE(SUM(wo.hours_worked), 0) AS h
      FROM work_order_operations wo
      JOIN work_orders w ON w.id = wo.work_order_id
      WHERE w.equipment_instance_id = ?
    `, instance.id).h;
    const bookedHours = get("SELECT COALESCE(SUM(actual_hours), 0) AS h FROM work_orders WHERE equipment_instance_id = ?", instance.id).h;
    const actHours = Number(reportedHours) > 0 ? Number(reportedHours) : Number(bookedHours);
    const rate = resolveRate();
    const labor = laborVariance({ standardHours: stdHours, actualHours: actHours, standardRate: rate.rate, actualRate: null });
    labor.rate_source = rate.source;
    // 没有实际工时 → 效率差不可算（不能把"没报工"当成 100% 节约）
    const coverage = laborCoverageOk({
      standardHours: stdHours,
      actualHours: actHours,
      minPct: Number(process.env.LABOR_COVERAGE_MIN_PCT || 10) || 10,
    });
    labor.available = coverage.ok;
    labor.unavailable_reason = coverage.reason;
    labor.coverage_pct = coverage.coverage_pct;
    labor.actual_hours_source = Number(reportedHours) > 0 ? "work_order_operations" : (Number(bookedHours) > 0 ? "work_orders.actual_hours" : "none");

    const summary = summarize({ materialLines, labor });

    // 关键件价格差异（万元/件 → 元）：项目成本偏差不能只看物料+人工。
    const keyRows = all(`
      SELECT key_component_id, material_id, material_code, material_name, component_type, supplier,
             quantity, estimated_unit_price, actual_unit_price
        FROM v_instance_key_component_costs WHERE instance_id = ?
    `, instance.id);
    const keyPurchaseRows = safeAll(`
      SELECT poi.material_id,
             SUM(CASE WHEN COALESCE(poi.received_qty, 0) > 0 THEN poi.received_qty ELSE poi.quantity END) AS actual_qty,
             SUM(COALESCE(poi.total_price, poi.quantity * poi.unit_price, 0)) AS actual_amount
        FROM purchase_order_items poi JOIN purchase_orders po ON po.id = poi.po_id
       WHERE po.equipment_instance_id = ? AND poi.material_id IS NOT NULL
       GROUP BY poi.material_id`, instance.id);
    const keyPurchaseByMaterial = new Map(keyPurchaseRows.map((row) => [Number(row.material_id), { qty: Number(row.actual_qty || 0), amount: Number(row.actual_amount || 0) }]));
    const keyLines = keyRows.map((row) => {
      const qty = Number(row.quantity || 0);
      const estUnit = Number(row.estimated_unit_price || 0);
      const hasActual = row.actual_unit_price != null;
      const actUnit = hasActual ? Number(row.actual_unit_price) : estUnit;
      const purchase = keyPurchaseByMaterial.get(Number(row.material_id));
      const actualQty = purchase && purchase.qty > 0 ? purchase.qty : null;
      const priceVariance = round2((actUnit - estUnit) * (actualQty == null ? qty : actualQty) * 10000);
      const quantityVariance = actualQty == null ? null : round2((actualQty - qty) * estUnit * 10000);
      const actualCost = quantityVariance != null ? round2(estUnit * qty * 10000 + priceVariance + quantityVariance) : round2(actUnit * qty * 10000);
      return {
        key_component_id: row.key_component_id,
        material_code: row.material_code,
        material_name: row.material_name,
        component_type: row.component_type,
        supplier: row.supplier,
        quantity: qty,
        actual_qty: actualQty,
        actual_qty_source: actualQty == null ? "none" : "purchase_order",
        quantity_variance_available: actualQty != null,
        quantity_variance: quantityVariance,
        estimated_unit_price: estUnit,
        actual_unit_price: hasActual ? actUnit : null,
        price_unit: "wan",
        estimated_cost: round2(estUnit * qty * 10000),
        actual_cost: actualCost,
        price_variance: priceVariance,
      };
    });
    const keyEstimated = round2(keyLines.reduce((sum, row) => sum + row.estimated_cost, 0));
    const keyActual = round2(keyLines.reduce((sum, row) => sum + row.actual_cost, 0));
    const keyVariance = round2(keyActual - keyEstimated);

    // 成本台账（project_cost_entries）：P2-2 的真实成本来源。三层差异只覆盖材料+人工，
    // 外协/折旧/返工/质量损失属于"其他成本"，单列并与计算值做台账核对。
    const ledgerRows = (() => {
      try {
        const hasFx = Boolean(get("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cost_fx_rates'"));
        return hasFx
          ? all(`SELECT e.cost_type, COUNT(*) AS cnt,
                  COALESCE(SUM(e.amount * COALESCE(f.rate_to_cny, 1)), 0) AS total
                  FROM project_cost_entries e
                  LEFT JOIN cost_fx_rates f ON f.currency = e.currency
                  WHERE e.equipment_instance_id = ? AND e.deleted_at IS NULL AND e.status = 'posted'
                  GROUP BY e.cost_type`, instance.id)
          : all(`SELECT cost_type, COUNT(*) AS cnt, COALESCE(SUM(amount), 0) AS total
                  FROM project_cost_entries
                  WHERE equipment_instance_id = ? AND deleted_at IS NULL AND status = 'posted'
                  GROUP BY cost_type`, instance.id);
      } catch (_error) {
        return [];
      }
    })();
    const ledgerByType = {};
    let ledgerTotal = 0;
    for (const row of ledgerRows) {
      ledgerByType[row.cost_type] = { count: row.cnt, amount: round2(row.total) };
      ledgerTotal += Number(row.total) || 0;
    }
    const otherCostKeys = ["outsourcing", "depreciation", "rework", "quality_loss"];
    const otherCosts = round2(otherCostKeys.reduce((sum, key) => sum + (ledgerByType[key]?.amount || 0), 0));
    const ledgerMaterial = ledgerByType.material?.amount || 0;
    const ledgerLabor = ledgerByType.labor?.amount || 0;
    const computedActualMaterial = round2(materialLines.filter((line) => line.available !== false).reduce((sum, line) => sum + (line.actual_cost || 0), 0));
    const computedActualLabor = labor.available ? round2(labor.actual_cost || 0) : null;
    const ledger = {
      entries: ledgerRows.reduce((sum, row) => sum + Number(row.cnt || 0), 0),
      total: round2(ledgerTotal),
      by_type: ledgerByType,
      other_costs: otherCosts,
      material_actual: round2(ledgerMaterial),
      labor_actual: round2(ledgerLabor),
      cross_check: {
        material_computed: computedActualMaterial,
        material_ledger: round2(ledgerMaterial),
        material_diff: round2(ledgerMaterial - computedActualMaterial),
        labor_computed: computedActualLabor,
        labor_ledger: round2(ledgerLabor),
        labor_diff: computedActualLabor === null ? null : round2(ledgerLabor - computedActualLabor),
        note: "台账合计用于核对：差异 = 台账金额 − 本次计算金额（材料按领料×单价，人工按工时×费率）",
      },
      actual_total_including_other: round2(summary.totals.actual_cost + otherCosts),
    };

    // 全口径：关键件按有效合同价折算，台账有值时优先用台账（避免与领料/工时推算重复）
    const materialStandard = round2(materialLines.reduce((sum, line) => sum + Number(line.standard_cost || 0), 0));
    const materialActualComputed = round2(materialLines.filter((line) => line.available !== false).reduce((sum, line) => sum + Number(line.actual_cost || 0), 0));
    const materialUnavailableStandard = round2(materialLines.filter((line) => line.available === false).reduce((sum, line) => sum + Number(line.standard_cost || 0), 0));
    // 没有领料记录的物料不能当节约：按标准用量 × 当前实际/标准单价占位，
    // 与 cost_rollup 的“物料实际价 × BOM 用量”口径保持一致。
    const materialUnavailableActualProxy = round2(materialLines.filter((line) => line.available === false).reduce((sum, line) => {
      const qty = Number(line.standard_qty || 0);
      const price = Number(line.actual_price || line.standard_price || 0);
      return sum + qty * price;
    }, 0));
    const materialActual = ledgerMaterial > 0 ? round2(ledgerMaterial) : round2(materialActualComputed + materialUnavailableActualProxy);
    const laborActual = ledgerLabor > 0 ? round2(ledgerLabor) : (labor.available ? round2(labor.actual_cost || 0) : 0);
    // 其他成本（外协/折旧/返工/质量）没有标准预算，只进实际，不抬高预算基线
    const standardCostFull = round2(materialStandard + Number(labor.standard_cost || 0) + keyEstimated);
    const actualCostFull = round2(materialActual + laborActual + keyActual + otherCosts);
    const totalVarianceFull = round2(actualCostFull - standardCostFull);
    labor.ledger_actual_cost = ledgerLabor;
    labor.ledger_actual_hours = rate.rate > 0 ? round2(ledgerLabor / rate.rate) : null;
    labor.ledger_cost_variance = ledgerLabor > 0 ? round2(ledgerLabor - Number(labor.standard_cost || 0)) : null;
    ledger.actual_total_including_other = actualCostFull;
    ledger.material_actual_full = materialActual;
    ledger.labor_actual_full = laborActual;
    ledger.key_component_actual = keyActual;

    // 数据缺口（诚实标注，避免把"没有数据"当成"没有差异"）
    const dataGaps = [];
    const missingActual = materialLines.filter((line) => line.actual_missing).length;
    const missingPrice = materialLines.filter((line) => line.price_missing).length;
    if (missingActual) dataGaps.push(`${missingActual} 种物料没有领料记录，其量差未计入合计（标准金额见 not_computed，避免被误读成节约）`);
    if (missingPrice) dataGaps.push(`${missingPrice} 种物料缺标准/实际单价，价差按 0 计`);
    if (ledgerLabor > 0) dataGaps.push(`人工实际成本按台账 ${ledgerLabor} 元计入全口径；台账折算工时 ${round2(ledgerLabor / rate.rate)}h，与报工覆盖需财务复核`);
    if (keyLines.some((line) => line.actual_qty == null)) dataGaps.push("部分关键件没有采购实际数量，关键件量差不可算（价差仍按合同价计算）");
    if (coverage.reason === "no_actual_hours") dataGaps.push("没有实际工时（报工/工单均未回填），效率差未计入合计");
    else if (coverage.reason === "insufficient_actual_hours") dataGaps.push(`实际工时只覆盖标准工时的 ${coverage.coverage_pct}%（低于 ${coverage.min_pct}%），效率差未计入合计；补齐报工后再看`);
    else if (Number(reportedHours) === 0 && Number(bookedHours) > 0) dataGaps.push("实际工时取自工单 actual_hours（无工序级报工），精度到工单级");

    res.json({
      equipment_instance: instance,
      material_lines: materialLines,
      labor,
      labor_rate: { rate: rate.rate, source: rate.source, unit: "元/小时" },
      totals: summary.totals,
      not_computed: summary.not_computed,
      ledger,
      key_components: {
        count: keyLines.length,
        estimated_total: keyEstimated,
        actual_total: keyActual,
        price_variance: keyVariance,
        price_unit: "wan",
        lines: keyLines,
      },
      full_totals: {
        standard_cost: standardCostFull,
        actual_cost: actualCostFull,
        total_variance: totalVarianceFull,
        material_standard: materialStandard,
        material_actual: materialActual,
        material_actual_computed: materialActualComputed,
        material_unavailable_standard_proxy: materialUnavailableStandard,
        material_unavailable_actual_proxy: materialUnavailableActualProxy,
        labor_standard: Number(labor.standard_cost || 0),
        labor_actual: laborActual,
        key_component_standard: keyEstimated,
        key_component_actual: keyActual,
        other_costs: otherCosts,
      },
      top_contributors: summary.top_contributors,
      data_gaps: dataGaps,
      basis: "标准成本法：标准用量取 instance_bom，实际用量取 material_movements(issue)；标准工时取 process_nodes.estimated_hours；台账取 project_cost_entries(posted)",
    });
  }));

  // ---------------- 工单级三层差异
  app.get("/api/cost/work_orders/:id/variance", wrap((req, res) => {
    const wo = get(`SELECT w.id, w.wo_code, w.title, w.status, w.equipment_instance_id,
                           w.estimated_hours, w.actual_hours, w.quantity_planned, w.quantity_completed
                    FROM work_orders w WHERE w.id = ?`, req.params.id);
    if (!wo) return res.status(404).json({ error: "work_order not found" });

    const reported = get("SELECT COALESCE(SUM(hours_worked), 0) AS h FROM work_order_operations WHERE work_order_id = ?", wo.id).h;
    const actualHours = Number(reported) > 0 ? Number(reported) : Number(wo.actual_hours || 0);
    const rate = resolveRate();
    const labor = laborVariance({ standardHours: wo.estimated_hours || 0, actualHours, standardRate: rate.rate, actualRate: null });
    labor.rate_source = rate.source;
    const woCoverage = laborCoverageOk({
      standardHours: wo.estimated_hours || 0,
      actualHours,
      minPct: Number(process.env.LABOR_COVERAGE_MIN_PCT || 10) || 10,
    });
    labor.available = woCoverage.ok;
    labor.unavailable_reason = woCoverage.reason;
    labor.coverage_pct = woCoverage.coverage_pct;
    labor.actual_hours_source = Number(reported) > 0 ? "work_order_operations" : (Number(wo.actual_hours || 0) > 0 ? "work_orders.actual_hours" : "none");

    // 材料：该工单领料的"价差"可算（实际用量 × (实际单价 − 标准单价)）；量差需要工单级标准用量，当前无
    const issueRows = all(`
      SELECT ml.material_id, m.material_code, m.material_name, SUM(mm.quantity) AS actual_qty,
             COALESCE(NULLIF(m.estimated_unit_price, 0), NULLIF(m.actual_unit_price, 0), 0) AS standard_price,
             COALESCE(NULLIF(m.actual_unit_price, 0), NULLIF(m.estimated_unit_price, 0), 0) AS actual_price
      FROM material_movements mm
      JOIN material_lots ml ON ml.id = mm.material_lot_id
      JOIN materials m ON m.id = ml.material_id
      WHERE mm.movement_type = 'issue' AND mm.work_order_id = ?
      GROUP BY ml.material_id
    `, wo.id);

    const materialLines = issueRows.map((row) => {
      const line = materialVariance({ standardQty: row.actual_qty, actualQty: row.actual_qty, standardPrice: row.standard_price, actualPrice: row.actual_price });
      return {
        ...line,
        material_id: row.material_id,
        material_code: row.material_code,
        material_name: row.material_name,
        quantity_variance_available: false,
      };
    });

    const summary = summarize({ materialLines, labor });
    const dataGaps = ["工单级标准用量未维护（BOM 挂在装备实例上），本工单只拆价差+人工三层；量差请在项目级（/cost-variance）查看"];
    if (issueRows.length === 0) dataGaps.push("该工单没有领料记录，材料价差为 0");
    if (labor.unavailable_reason === "no_actual_hours") dataGaps.push("该工单还没有报工/实际工时，人工效率差未计入合计");
    else if (labor.unavailable_reason === "insufficient_actual_hours") dataGaps.push(`该工单报工只覆盖标准工时的 ${labor.coverage_pct}%（低于 ${laborCoverageOk({ minPct: Number(process.env.LABOR_COVERAGE_MIN_PCT || 10) || 10 }).min_pct}%），效率差未计入合计`);

    res.json({
      work_order: wo,
      material_lines: materialLines,
      labor,
      labor_rate: { rate: rate.rate, source: rate.source, unit: "元/小时" },
      totals: summary.totals,
      not_computed: summary.not_computed,
      top_contributors: summary.top_contributors,
      data_gaps: dataGaps,
      basis: "工单级：人工三层（标准工时=estimated_hours，实际=报工/actual_hours）+ 材料价差（领料实际单价 vs 标准单价）",
    });
  }));
}

module.exports = { register };
