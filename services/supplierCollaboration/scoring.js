"use strict";
// services/supplierCollaboration/scoring.js
// 供应商评分: 交期 / 质量 / 服务 三项加权，写入 supplier_score_snapshots。
// (原 services/supplierCollaborationService.js 第 155-219 行)

const { ApiError } = require("../../app/errors");
const { get, run } = require("./_helpers");

function clampScore(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.min(100, Math.max(0, Math.round(num)));
}

function scoreSupplier(db, supplierId, period = new Date().toISOString().slice(0, 7)) {
  const supplier = get(db, "SELECT * FROM suppliers WHERE id = ?", [supplierId]);
  if (!supplier) throw ApiError.notFound("supplier not found");

  const po = get(db, `
    SELECT
      COUNT(*) AS total_po,
      SUM(CASE WHEN status IN ('received','closed') THEN 1 ELSE 0 END) AS received_po,
      SUM(CASE WHEN expected_date IS NOT NULL AND closed_at IS NOT NULL AND date(closed_at) <= date(expected_date) THEN 1 ELSE 0 END) AS on_time_po,
      SUM(CASE WHEN expected_date IS NOT NULL AND status NOT IN ('received','closed','cancelled') AND date(expected_date) < date('now') THEN 1 ELSE 0 END) AS overdue_po
    FROM purchase_orders
    WHERE supplier_id = ?
  `, [supplierId]) || {};
  const incoming = get(db, `
    SELECT
      COUNT(*) AS total_inspections,
      SUM(CASE WHEN result = 'pass' THEN 1 ELSE 0 END) AS pass_count,
      SUM(CASE WHEN result = 'fail' THEN 1 ELSE 0 END) AS fail_count
    FROM incoming_inspections
    WHERE supplier_id = ?
  `, [supplierId]) || {};
  const tracking = get(db, `
    SELECT
      COUNT(*) AS total_tracking,
      SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS delivered_tracking,
      SUM(CASE WHEN delay_days > 0 THEN 1 ELSE 0 END) AS delayed_tracking
    FROM purchase_tracking
    WHERE supplier = ? OR supplier = ?
  `, [supplier.supplier_name, supplier.supplier_code]) || {};
  const outsource = get(db, `
    SELECT
      COUNT(*) AS total_outsource,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_outsource,
      SUM(CASE WHEN quality_status = 'fail' THEN 1 ELSE 0 END) AS outsource_quality_fail
    FROM outsourcing_orders
    WHERE supplier_id = ?
  `, [supplierId]) || {};

  const deliveryBase = Number(po.received_po || 0) + Number(tracking.delivered_tracking || 0);
  const deliveryGood = Number(po.on_time_po || 0) + Math.max(0, Number(tracking.delivered_tracking || 0) - Number(tracking.delayed_tracking || 0));
  const deliveryScore = deliveryBase > 0 ? clampScore((deliveryGood / deliveryBase) * 100) : 80;
  const qualityBase = Number(incoming.total_inspections || 0) + Number(outsource.total_outsource || 0);
  const qualityBad = Number(incoming.fail_count || 0) + Number(outsource.outsource_quality_fail || 0);
  const qualityScore = qualityBase > 0 ? clampScore(((qualityBase - qualityBad) / qualityBase) * 100) : 80;
  const servicePenalty = Math.min(30, Number(po.overdue_po || 0) * 10 + Math.max(0, Number(outsource.total_outsource || 0) - Number(outsource.completed_outsource || 0)) * 3);
  const serviceScore = clampScore(Math.max(60, 90 - servicePenalty));
  const totalScore = clampScore(deliveryScore * 0.4 + qualityScore * 0.4 + serviceScore * 0.2);
  const grade = totalScore >= 90 ? "A" : totalScore >= 80 ? "B" : totalScore >= 70 ? "C" : "D";
  const metrics = { po, incoming, tracking, outsource };

  run(db, `
    INSERT INTO supplier_score_snapshots (supplier_id, period, delivery_score, quality_score, service_score, total_score, grade, metrics_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(supplier_id, period) DO UPDATE SET
      delivery_score=excluded.delivery_score,
      quality_score=excluded.quality_score,
      service_score=excluded.service_score,
      total_score=excluded.total_score,
      grade=excluded.grade,
      metrics_json=excluded.metrics_json,
      created_at=datetime('now')
  `, [supplierId, period, deliveryScore, qualityScore, serviceScore, totalScore, grade, JSON.stringify(metrics)]);

  return { supplier_id: supplierId, supplier_name: supplier.supplier_name, period, delivery_score: deliveryScore, quality_score: qualityScore, service_score: serviceScore, total_score: totalScore, grade, metrics };
}

module.exports = { scoreSupplier };
