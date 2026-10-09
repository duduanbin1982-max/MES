"use strict";
// Fault risk prediction: read active models, score history, write ai_predictions.

const { modelRow } = require("./_helpers");

function confidenceFor(model) {
  const metrics = model.metrics;
  const sampleScore = Math.min(model.training_rows / 500, 0.2);
  const skillScore = Math.max(0, Math.min(metrics.skill_vs_baseline || 0, 1)) * 0.4;
  return Math.min(0.95, 0.35 + sampleScore + skillScore);
}

function predictFaultWithModels(db, deviceCode, hoursBack = 168) {
  const modelRows = db.prepare(`
    SELECT m.*, d.device_code, d.device_name, dp.point_code, dp.point_name, dp.unit,
           dp.alarm_low, dp.alarm_high
    FROM ai_models m
    JOIN iot_devices d ON d.id = m.device_id
    JOIN iot_data_points dp ON dp.id = m.point_id
    WHERE d.device_code = ? AND m.status = 'active'
    ORDER BY m.point_id
  `).all(deviceCode).map(modelRow);
  if (!modelRows.length) return null;

  const pointPredictions = [];
  for (const model of modelRows) {
    const limit = Math.max(model.parameters.lag + 1, Math.min(Number(hoursBack || 168), 720));
    const sourceCondition = model.training_source === "simulator" ? "source = 'simulator'" : "source <> 'simulator'";
    const rows = db.prepare(`
      SELECT avg_value FROM iot_reading_hourly
      WHERE device_id = ? AND point_id = ? AND ${sourceCondition} AND avg_value IS NOT NULL
      ORDER BY bucket_hour DESC LIMIT ?
    `).all(model.device_id, model.point_id, limit).reverse();
    const history = rows.map((row) => Number(row.avg_value));
    if (history.length < model.parameters.lag) continue;
    const thresholds = require("../modelCore").assessThreshold(model.parameters, Number(model.alarm_low), Number(model.alarm_high));
    const scored = require("../modelCore").scoreForecast(model.parameters, history, thresholds, 24);
    const failureIndex = scored.predictions.findIndex((value) => value > thresholds.high || value < thresholds.low);
    pointPredictions.push({
      model_id: model.id,
      model_code: model.model_code,
      model_version: model.version,
      point_code: model.point_code,
      point_name: model.point_name,
      unit: model.unit,
      risk_pct: Math.round(scored.risk * 10) / 10,
      current_value: history[history.length - 1],
      next_prediction: Math.round(scored.next_prediction * 100) / 100,
      predicted_failure_hours: failureIndex >= 0 ? failureIndex + 1 : null,
      threshold_low: thresholds.low,
      threshold_high: thresholds.high,
      calibration_status: thresholds.calibration_status,
      confidence: Math.round(confidenceFor(model) * 100) / 100,
      metrics: model.metrics,
      training_source: model.training_source,
    });
  }
  if (!pointPredictions.length) return null;
  pointPredictions.sort((left, right) => right.risk_pct - left.risk_pct);
  const highest = pointPredictions[0];
  const averageRisk = pointPredictions.reduce((sum, item) => sum + item.risk_pct, 0) / pointPredictions.length;
  const confidence = pointPredictions.reduce((sum, item) => sum + item.confidence, 0) / pointPredictions.length;
  const device = modelRows[0];
  const result = db.prepare(`
    INSERT INTO ai_predictions
      (target_type, target_id, prediction_type, predicted_value, confidence, threshold_high, status, notes, model_id)
    VALUES ('device', ?, 'trained_fault_risk', ?, ?, ?, ?, ?, ?)
  `).run(
    device.device_id,
    highest.risk_pct,
    confidence,
    highest.threshold_high,
    highest.risk_pct >= 50 ? "warning" : "active",
    JSON.stringify({ average_risk: averageRisk, highest_point: highest.point_code, model_count: pointPredictions.length }),
    highest.model_id,
  );

  return {
    prediction_id: Number(result.lastInsertRowid),
    model_source: "trained_ridge_ar_v1",
    training_source: highest.training_source,
    device_code: device.device_code,
    device_name: device.device_name,
    fault_risk_pct: Math.round(highest.risk_pct),
    average_risk_pct: Math.round(averageRisk),
    confidence: Math.round(confidence * 100),
    highest_risk_point: highest.point_name,
    predicted_failure_hours: highest.predicted_failure_hours,
    alarm_threshold: Math.round(highest.threshold_high * 100) / 100,
    current_avg: Math.round(highest.current_value * 100) / 100,
    trend_direction: highest.next_prediction > highest.current_value ? "rising" : "falling",
    readings_analyzed: pointPredictions.length,
    recommendation: highest.risk_pct >= 70 ? "建议停机检查高风险测点" : highest.risk_pct >= 40 ? "加强高风险测点监控" : "模型判断运行稳定",
    point_predictions: pointPredictions,
  };
}

module.exports = { predictFaultWithModels, confidenceFor };
