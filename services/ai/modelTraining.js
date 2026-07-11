"use strict";

const crypto = require("node:crypto");
const { ApiError } = require("../../app/errors");
const { wrap } = require("../../middleware/asyncHandler");
const {
  assessThreshold,
  fitAutoregression,
  scoreForecast,
} = require("./modelCore");

function columnNames(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
}

function addColumn(db, table, name, definition) {
  if (!columnNames(db, table).has(name)) db.prepare(`ALTER TABLE ${table} ADD COLUMN ${definition}`).run();
}

function runMigration(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_code TEXT NOT NULL,
      model_type TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id INTEGER,
      device_id INTEGER,
      point_id INTEGER,
      algorithm TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'candidate',
      training_rows INTEGER NOT NULL DEFAULT 0,
      validation_rows INTEGER NOT NULL DEFAULT 0,
      train_from TEXT,
      train_to TEXT,
      feature_schema TEXT NOT NULL,
      parameters TEXT NOT NULL,
      metrics TEXT NOT NULL,
      data_quality TEXT,
      artifact_hash TEXT,
      trained_by INTEGER,
      trained_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(model_code, version)
    );

    CREATE TABLE IF NOT EXISTS ai_training_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id INTEGER,
      model_code TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      training_rows INTEGER NOT NULL DEFAULT 0,
      validation_rows INTEGER NOT NULL DEFAULT 0,
      mae REAL,
      rmse REAL,
      r2 REAL,
      skill_vs_baseline REAL,
      message TEXT,
      FOREIGN KEY (model_id) REFERENCES ai_models(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ai_models_target ON ai_models(device_id, point_id, status);
    CREATE INDEX IF NOT EXISTS idx_ai_training_runs_time ON ai_training_runs(started_at DESC);
  `);
  addColumn(db, "ai_predictions", "model_id", "model_id INTEGER");
  addColumn(db, "ai_models", "training_source", "training_source TEXT NOT NULL DEFAULT 'production'");
}

function safeCode(value) {
  return String(value || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function parseJson(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function modelRow(row) {
  return {
    ...row,
    feature_schema: parseJson(row.feature_schema, []),
    parameters: parseJson(row.parameters, {}),
    metrics: parseJson(row.metrics, {}),
    data_quality: parseJson(row.data_quality, {}),
  };
}

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
  const fitted = fitAutoregression(values, { minSamples: Number(options.min_samples || 48) });
  const thresholds = assessThreshold(fitted.parameters, Number(group.alarm_low), Number(group.alarm_high));
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
    const thresholds = assessThreshold(model.parameters, Number(model.alarm_low), Number(model.alarm_high));
    const scored = scoreForecast(model.parameters, history, thresholds, 24);
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

function register(app, db) {
  runMigration(db);

  app.get("/api/ai/models/readiness", wrap((_req, res) => {
    const groups = trainingGroups(db, { min_samples: 48 });
    const qualitySamples = db.prepare("SELECT COUNT(*) AS c FROM qc_inspections").get().c;
    const activeModels = db.prepare("SELECT COUNT(*) AS c FROM ai_models WHERE status = 'active'").get().c;
    const hourlySamples = db.prepare("SELECT COUNT(*) AS c FROM iot_reading_hourly WHERE avg_value IS NOT NULL").get().c;
    res.json({
      iot: { status: groups.length ? "ready" : "insufficient_data", trainable_series: groups.length, hourly_samples: hourlySamples, min_samples: 48 },
      quality: { status: qualitySamples >= 30 ? "ready" : "insufficient_data", samples: qualitySamples, min_samples: 30 },
      active_models: activeModels,
    });
  }));

  app.get("/api/ai/models", wrap((req, res) => {
    const includeRetired = req.query.include_retired === "1";
    const rows = db.prepare(`
      SELECT m.*, d.device_code, d.device_name, dp.point_code, dp.point_name, dp.unit,
             dp.alarm_low, dp.alarm_high
      FROM ai_models m
      LEFT JOIN iot_devices d ON d.id = m.device_id
      LEFT JOIN iot_data_points dp ON dp.id = m.point_id
      ${includeRetired ? "" : "WHERE m.status = 'active'"}
      ORDER BY m.trained_at DESC, m.id DESC
    `).all().map(modelRow);
    res.json({ items: rows });
  }));

  app.get("/api/ai/training-runs", wrap((_req, res) => {
    res.json({ items: db.prepare("SELECT * FROM ai_training_runs ORDER BY started_at DESC, id DESC LIMIT 200").all() });
  }));

  app.post("/api/ai/models/train", wrap((req, res) => {
    const result = trainModels(db, { ...req.body, trained_by: req.user?.id || null });
    if (!result.trained) throw ApiError.validation("没有达到训练门槛的 IoT 时序数据", { failures: result.failures });
    res.status(201).json(result);
  }));

  console.log("[aiModelTraining] Model training/versioning registered");
}

module.exports = {
  predictFaultWithModels,
  register,
  runMigration,
  trainModels,
};
