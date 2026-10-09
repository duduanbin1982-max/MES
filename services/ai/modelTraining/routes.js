"use strict";
// AI model routes: readiness, list, training-runs, train.

const { wrap } = require("../../../middleware/asyncHandler");
const { trainModels, trainingGroups } = require("./training");
const { runMigration } = require("./schema");
const { modelRow } = require("./_helpers");
const { ApiError } = require("../../../app/errors");

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
    const baseRows = db.prepare(`
      SELECT m.*, d.device_code, d.device_name, dp.point_code, dp.point_name, dp.unit,
             dp.alarm_low, dp.alarm_high
      FROM ai_models m
      LEFT JOIN iot_devices d ON d.id = m.device_id
      LEFT JOIN iot_data_points dp ON dp.id = m.point_id
      ${includeRetired ? "" : "WHERE m.status = 'active'"}
      ORDER BY m.trained_at DESC, m.id DESC
    `).all();
    res.json({ items: baseRows.map(modelRow) });
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

module.exports = { register };
