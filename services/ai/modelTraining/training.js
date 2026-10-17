"use strict";
// Model training pipeline: query training groups, fit AR model per group, write ai_models + ai_training_runs.

const { ApiError } = require("../../../app/errors");
const crypto = require("node:crypto");
const { safeCode, modelRow } = require("./_helpers");

function trainingGroups(db, filters = {}) {
  const conditions = ["h.sample_count > 0", "h.avg_value IS NOT NULL", "dp.is_active = 1"];
  const parameters = [];
  const dataSource = filters.data_source || "production";
  if (dataSource === "simulator") {
    conditions.push("h.source = 'simulator'");
  } else {
    conditions.push("h.source <> 'simulator'");
  }
  if (filters.device_code) {
    conditions.push("d.device_code = ?");
    parameters.push(filters.device_code);
  }
  if (filters.point_code) {
    conditions.push("dp.point_code = ?");
    parameters.push(filters.point_code);
  }
  parameters.push(Math.max(24, Number(filters.min_samples || 48)));
  return db.prepare(`
    SELECT d.id AS device_id, d.device_code, d.device_name,
           dp.id AS point_id, dp.point_code, dp.point_name, dp.unit, dp.alarm_low, dp.alarm_high,
           COUNT(*) AS sample_count, MIN(h.bucket_hour) AS train_from, MAX(h.bucket_hour) AS train_to
    FROM iot_reading_hourly h
    JOIN iot_devices d ON d.id = h.device_id
    JOIN iot_data_points dp ON dp.id = h.point_id
    WHERE ${conditions.join(" AND ")}
    GROUP BY d.id, dp.id
    HAVING COUNT(*) >= ?
    ORDER BY d.device_code, dp.point_code
  `).all(...parameters);
}

function trainGroup(db, group, options = {}) {
  const sourceCondition = options.data_source === "simulator" ? "source = 'simulator'" : "source <> 'simulator'";
  const rows = db.prepare(`
    SELECT bucket_hour, avg_value
    FROM iot_reading_hourly
    WHERE device_id = ? AND point_id = ? AND ${sourceCondition} AND avg_value IS NOT NULL
    ORDER BY bucket_hour
  `).all(group.device_id, group.point_id);
  const values = rows.map((row) => Number(row.avg_value));
  const fitted = require("../modelCore").fitAutoregression(values, { minSamples: Number(options.min_samples || 48) });
  const thresholds = require("../modelCore").assessThreshold(fitted.parameters, Number(group.alarm_low), Number(group.alarm_high));
  const highExceedRatio = Number.isFinite(Number(group.alarm_high))
    ? values.filter((value) => value > Number(group.alarm_high)).length / values.length
    : null;
  const lowExceedRatio = Number.isFinite(Number(group.alarm_low))
    ? values.filter((value) => value < Number(group.alarm_low)).length / values.length
    : null;
  const dataQuality = {
    configured_alarm_low: group.alarm_low,
    configured_alarm_high: group.alarm_high,
    configured_high_exceed_ratio: highExceedRatio,
    configured_low_exceed_ratio: lowExceedRatio,
    calibration_status: thresholds.calibration_status,
    validation_status: fitted.metrics.skill_vs_baseline >= 0 ? "accepted" : "weak",
  };
  const modelCode = `iot_ar_${safeCode(group.device_code)}_${safeCode(group.point_code)}`;
  const version = db.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS version FROM ai_models WHERE model_code = ?").get(modelCode).version;
  const featureSchema = JSON.stringify(fitted.feature_schema);
  const parametersJson = JSON.stringify(fitted.parameters);
  const metricsJson = JSON.stringify(fitted.metrics);
  const qualityJson = JSON.stringify(dataQuality);
  const artifactHash = crypto.createHash("sha256").update(parametersJson).digest("hex");
  const status = "active";

  const transaction = db.transaction(() => {
    db.prepare("UPDATE ai_models SET status = 'retired' WHERE model_code = ? AND status = 'active'").run(modelCode);
    const result = db.prepare(`
      INSERT INTO ai_models
        (model_code, model_type, target_type, target_id, device_id, point_id, algorithm, version, status,
         training_rows, validation_rows, train_from, train_to, feature_schema, parameters, metrics,
         data_quality, artifact_hash, trained_by, training_source)
      VALUES (?, 'time_series', 'iot_point', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      modelCode,
      group.point_id,
      group.device_id,
      group.point_id,
      fitted.algorithm,
      version,
      status,
      fitted.training_rows,
      fitted.validation_rows,
      group.train_from,
      group.train_to,
      featureSchema,
      parametersJson,
      metricsJson,
      qualityJson,
      artifactHash,
      options.trained_by || null,
      options.data_source || "production",
    );
    db.prepare(`
      INSERT INTO ai_training_runs
        (model_id, model_code, status, completed_at, training_rows, validation_rows, mae, rmse, r2,
         skill_vs_baseline, message)
      VALUES (?, ?, 'completed', datetime('now'), ?, ?, ?, ?, ?, ?, ?)
    `).run(
      result.lastInsertRowid,
      modelCode,
      fitted.training_rows,
      fitted.validation_rows,
      fitted.metrics.mae,
      fitted.metrics.rmse,
      fitted.metrics.r2,
      fitted.metrics.skill_vs_baseline,
      dataQuality.calibration_status === "warning" ? "模型已训练；设备报警阈值需校准" : "训练和留出验证完成",
    );
    return Number(result.lastInsertRowid);
  });

  return modelRow(db.prepare(`
    SELECT m.*, d.device_code, d.device_name, dp.point_code, dp.point_name, dp.unit,
           dp.alarm_low, dp.alarm_high
    FROM ai_models m
    JOIN iot_devices d ON d.id = m.device_id
    JOIN iot_data_points dp ON dp.id = m.point_id
    WHERE m.id = ?
  `).get(transaction()));
}

function trainModels(db, options = {}) {
  const dataSource = options.data_source || "production";
  if (dataSource === "simulator" && String(process.env.IOT_MODE || "production").toLowerCase() !== "simulator") {
    throw ApiError.validation("生产模式禁止使用模拟数据训练模型");
  }
  options = { ...options, data_source: dataSource };
  const groups = trainingGroups(db, options);
  const models = [];
  const failures = [];
  for (const group of groups) {
    try {
      models.push(trainGroup(db, group, options));
    } catch (error) {
      failures.push({ device_code: group.device_code, point_code: group.point_code, error: error.message });
      db.prepare(`
        INSERT INTO ai_training_runs (model_code, status, completed_at, message)
        VALUES (?, 'failed', datetime('now'), ?)
      `).run(`iot_ar_${safeCode(group.device_code)}_${safeCode(group.point_code)}`, error.message);
    }
  }
  return { trained: models.length, failed: failures.length, models, failures };
}

module.exports = { trainingGroups, trainGroup, trainModels };
