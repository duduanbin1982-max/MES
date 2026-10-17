"use strict";
// services/iotLifecycleService.js
// P0-2: IoT readings/alarms lifecycle governance.
// Keeps raw high-frequency data bounded while preserving hour-level trends.

require("../app/errors");
const { wrap } = require("../middleware/asyncHandler");

const logger = require("../app/logger").createLogger("iotLifecycleService");

const DEFAULT_RAW_READING_DAYS = Number(process.env.IOT_RAW_READING_RETENTION_DAYS || 7);
const DEFAULT_ACKED_ALARM_DAYS = Number(process.env.IOT_ACKED_ALARM_RETENTION_DAYS || 30);
const DEFAULT_BATCH_LIMIT = Number(process.env.IOT_LIFECYCLE_BATCH_LIMIT || 200000);
const DEFAULT_RUN_INTERVAL_HOURS = Number(process.env.IOT_LIFECYCLE_INTERVAL_HOURS || 24);
let lifecycleTimer = null;

function positiveInt(value, fallback, max = 3650) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function runMigration(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS iot_reading_hourly (
      bucket_hour TEXT NOT NULL,
      device_id INTEGER NOT NULL,
      point_id INTEGER,
      point_code TEXT,
      unit TEXT,
      quality TEXT,
      sample_count INTEGER NOT NULL DEFAULT 0,
      min_value REAL,
      max_value REAL,
      avg_value REAL,
      first_read_at TEXT,
      last_read_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (bucket_hour, device_id, point_id, point_code, quality)
    );
    CREATE INDEX IF NOT EXISTS idx_iot_reading_hourly_bucket ON iot_reading_hourly(bucket_hour);
    CREATE INDEX IF NOT EXISTS idx_iot_reading_hourly_device ON iot_reading_hourly(device_id, bucket_hour);
    CREATE TABLE IF NOT EXISTS iot_lifecycle_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      raw_reading_retention_days INTEGER NOT NULL,
      acked_alarm_retention_days INTEGER NOT NULL,
      cutoff_readings TEXT NOT NULL,
      cutoff_alarms TEXT NOT NULL,
      aggregated_rows INTEGER NOT NULL DEFAULT 0,
      deleted_readings INTEGER NOT NULL DEFAULT 0,
      deleted_alarms INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'running',
      error TEXT
    );
  `);
  const hourlyColumns = new Set(db.prepare("PRAGMA table_info(iot_reading_hourly)").all().map((column) => column.name));
  if (!hourlyColumns.has("source")) db.prepare("ALTER TABLE iot_reading_hourly ADD COLUMN source TEXT NOT NULL DEFAULT 'external_adapter'").run();
  const readingColumns = new Set(db.prepare("PRAGMA table_info(iot_readings)").all().map((column) => column.name));
  if (!readingColumns.has("source")) db.prepare("ALTER TABLE iot_readings ADD COLUMN source TEXT NOT NULL DEFAULT 'external_adapter'").run();
  const alarmColumns = new Set(db.prepare("PRAGMA table_info(iot_alarms)").all().map((column) => column.name));
  if (!alarmColumns.has("source")) db.prepare("ALTER TABLE iot_alarms ADD COLUMN source TEXT NOT NULL DEFAULT 'external_adapter'").run();
}

function getCutoffs(db, options = {}) {
  const rawDays = positiveInt(options.rawReadingDays, DEFAULT_RAW_READING_DAYS);
  const alarmDays = positiveInt(options.ackedAlarmDays, DEFAULT_ACKED_ALARM_DAYS);
  const readingCutoff = db
    .prepare("SELECT datetime('now', ?) AS cutoff")
    .get("-" + rawDays + " days").cutoff;
  const alarmCutoff = db
    .prepare("SELECT datetime('now', ?) AS cutoff")
    .get("-" + alarmDays + " days").cutoff;
  return { rawDays, alarmDays, readingCutoff, alarmCutoff };
}

function aggregateReadings(db, cutoff) {
  const result = db.prepare(`
    INSERT INTO iot_reading_hourly (
      bucket_hour, device_id, point_id, point_code, unit, quality,
      source, sample_count, min_value, max_value, avg_value, first_read_at, last_read_at,
      created_at, updated_at
    )
    SELECT
      strftime('%Y-%m-%d %H:00:00', r.read_at) AS bucket_hour,
      r.device_id,
      r.point_id,
      COALESCE(r.point_code, dp.point_code, CAST(r.point_id AS TEXT), 'unknown') AS point_code,
      COALESCE(r.unit, dp.unit) AS unit,
      r.quality,
      r.source,
      COUNT(*) AS sample_count,
      MIN(r.value) AS min_value,
      MAX(r.value) AS max_value,
      AVG(r.value) AS avg_value,
      MIN(r.read_at) AS first_read_at,
      MAX(r.read_at) AS last_read_at,
      datetime('now'),
      datetime('now')
    FROM iot_readings r
    LEFT JOIN iot_data_points dp ON dp.id = r.point_id
    WHERE r.read_at < ?
    GROUP BY
      strftime('%Y-%m-%d %H:00:00', r.read_at),
      r.device_id,
      r.point_id,
      COALESCE(r.point_code, dp.point_code, CAST(r.point_id AS TEXT), 'unknown'),
      COALESCE(r.unit, dp.unit),
      r.quality,
      r.source
    ON CONFLICT(bucket_hour, device_id, point_id, point_code, quality) DO UPDATE SET
      sample_count = excluded.sample_count,
      min_value = excluded.min_value,
      max_value = excluded.max_value,
      avg_value = excluded.avg_value,
      first_read_at = excluded.first_read_at,
      last_read_at = excluded.last_read_at,
      unit = excluded.unit,
      source = excluded.source,
      updated_at = datetime('now')
  `).run(cutoff);
  return result.changes || 0;
}

function deleteInBatches(db, sql, params, batchLimit) {
  let deleted = 0;
  while (true) {
    const result = db.prepare(sql).run(...params, batchLimit);
    deleted += result.changes || 0;
    if (!result.changes || result.changes < batchLimit) break;
  }
  return deleted;
}

function runLifecycle(db, options = {}) {
  runMigration(db);
  const { rawDays, alarmDays, readingCutoff, alarmCutoff } = getCutoffs(db, options);
  const batchLimit = positiveInt(options.batchLimit, DEFAULT_BATCH_LIMIT, 1000000);
  const run = db.prepare(`
    INSERT INTO iot_lifecycle_runs
      (raw_reading_retention_days, acked_alarm_retention_days, cutoff_readings, cutoff_alarms)
    VALUES (?, ?, ?, ?)
  `).run(rawDays, alarmDays, readingCutoff, alarmCutoff);
  const runId = Number(run.lastInsertRowid);

  try {
    const summary = db.transaction(() => {
      const aggregatedRows = aggregateReadings(db, readingCutoff);
      const deletedReadings = deleteInBatches(
        db,
        "DELETE FROM iot_readings WHERE id IN (SELECT id FROM iot_readings WHERE read_at < ? LIMIT ?)",
        [readingCutoff],
        batchLimit
      );
      const deletedAlarms = deleteInBatches(
        db,
        "DELETE FROM iot_alarms WHERE id IN (SELECT id FROM iot_alarms WHERE acknowledged=1 AND created_at < ? LIMIT ?)",
        [alarmCutoff],
        batchLimit
      );
      db.prepare(`
        UPDATE iot_lifecycle_runs
        SET finished_at=datetime('now'), aggregated_rows=?, deleted_readings=?,
            deleted_alarms=?, status='success'
        WHERE id=?
      `).run(aggregatedRows, deletedReadings, deletedAlarms, runId);
      return { aggregatedRows, deletedReadings, deletedAlarms };
    })();

    return {
      run_id: runId,
      status: "success",
      raw_reading_retention_days: rawDays,
      acked_alarm_retention_days: alarmDays,
      cutoff_readings: readingCutoff,
      cutoff_alarms: alarmCutoff,
      ...summary,
    };
  } catch (error) {
    db.prepare(`
      UPDATE iot_lifecycle_runs
      SET finished_at=datetime('now'), status='failed', error=?
      WHERE id=?
    `).run(error.message, runId);
    throw error;
  }
}

function getLifecycleStatus(db) {
  runMigration(db);
  const counts = {
    raw_readings: db.prepare("SELECT COUNT(*) AS c FROM iot_readings").get().c,
    hourly_rows: db.prepare("SELECT COUNT(*) AS c FROM iot_reading_hourly").get().c,
    alarms: db.prepare("SELECT COUNT(*) AS c FROM iot_alarms").get().c,
    open_alarms: db.prepare("SELECT COUNT(*) AS c FROM iot_alarms WHERE acknowledged=0").get().c,
  };
  const ranges = {
    raw_first: db.prepare("SELECT MIN(read_at) AS v FROM iot_readings").get().v,
    raw_last: db.prepare("SELECT MAX(read_at) AS v FROM iot_readings").get().v,
    hourly_first: db.prepare("SELECT MIN(bucket_hour) AS v FROM iot_reading_hourly").get().v,
    hourly_last: db.prepare("SELECT MAX(bucket_hour) AS v FROM iot_reading_hourly").get().v,
  };
  const lastRun = db.prepare("SELECT * FROM iot_lifecycle_runs ORDER BY id DESC LIMIT 1").get() || null;
  return { counts, ranges, last_run: lastRun };
}

function register(app, db) {
  runMigration(db);

  app.get("/api/iot/lifecycle/status", wrap((req, res) => {
    res.json(getLifecycleStatus(db));
  }));

  app.post("/api/iot/lifecycle/run", wrap((req, res) => {
    const options = {
      rawReadingDays: req.body && req.body.raw_reading_retention_days,
      ackedAlarmDays: req.body && req.body.acked_alarm_retention_days,
      batchLimit: req.body && req.body.batch_limit,
    };
    res.json(runLifecycle(db, options));
  }));

  app.get("/api/iot/readings/hourly", wrap((req, res) => {
    const hours = positiveInt(req.query.hours, 168, 24 * 366);
    const params = ["-" + hours + " hours"];
    let sql = `
      SELECT h.*, d.device_code, d.device_name, dp.point_name
      FROM iot_reading_hourly h
      LEFT JOIN iot_devices d ON d.id=h.device_id
      LEFT JOIN iot_data_points dp ON dp.id=h.point_id
      WHERE h.bucket_hour >= datetime('now', ?)
    `;
    if (req.query.device_id) {
      sql += " AND h.device_id=?";
      params.push(req.query.device_id);
    }
    if (req.query.point_id) {
      sql += " AND h.point_id=?";
      params.push(req.query.point_id);
    }
    sql += " ORDER BY h.bucket_hour DESC, h.device_id, h.point_code LIMIT 5000";
    res.json(db.prepare(sql).all(...params));
  }));

  logger.info("[iotLifecycleService] IoT lifecycle governance registered");
}

function start(db, intervalHours = DEFAULT_RUN_INTERVAL_HOURS) {
  if (lifecycleTimer) clearInterval(lifecycleTimer);
  const hours = positiveInt(intervalHours, 24, 168);
  lifecycleTimer = setInterval(() => {
    try {
      const result = runLifecycle(db);
      logger.info(`[iotLifecycleService] scheduled run deleted ${result.deletedReadings} readings and ${result.deletedAlarms} alarms`);
    } catch (error) {
      logger.error("[iotLifecycleService] scheduled run failed:", error.message);
    }
  }, hours * 60 * 60 * 1000);
  lifecycleTimer.unref?.();
  return hours;
}

module.exports = {
  runMigration,
  runLifecycle,
  getLifecycleStatus,
  register,
  start,
};
