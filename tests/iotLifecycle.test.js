"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const lifecycle = require("../services/iotLifecycleService");

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE iot_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_code TEXT,
      device_name TEXT
    );
    CREATE TABLE iot_data_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER,
      point_code TEXT,
      point_name TEXT,
      unit TEXT
    );
    CREATE TABLE iot_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      point_id INTEGER,
      value REAL,
      quality TEXT NOT NULL DEFAULT 'good',
      read_at TEXT NOT NULL DEFAULT (datetime('now')),
      point_code TEXT,
      unit TEXT
    );
    CREATE TABLE iot_alarms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      point_id INTEGER,
      alarm_type TEXT NOT NULL,
      threshold_value REAL,
      actual_value REAL,
      message TEXT,
      severity TEXT NOT NULL DEFAULT 'warning',
      acknowledged INTEGER NOT NULL DEFAULT 0,
      acknowledged_by INTEGER,
      acknowledged_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

test("iot lifecycle aggregates old readings and keeps recent raw data", () => {
  const db = makeDb();
  lifecycle.runMigration(db);
  db.prepare("INSERT INTO iot_devices (id, device_code, device_name) VALUES (1, 'D1', 'Device 1')").run();
  db.prepare("INSERT INTO iot_data_points (id, device_id, point_code, point_name) VALUES (1, 1, 'temp', '温度')").run();

  const insertReading = db.prepare(`
    INSERT INTO iot_readings (device_id, point_id, point_code, unit, value, quality, read_at)
    VALUES (1, 1, 'temp', '℃', ?, 'good', ?)
  `);
  insertReading.run(10, "2026-01-01 00:10:00");
  insertReading.run(20, "2026-01-01 00:20:00");
  insertReading.run(30, db.prepare("SELECT datetime('now') AS t").get().t);

  const result = lifecycle.runLifecycle(db, { rawReadingDays: 7, ackedAlarmDays: 30, batchLimit: 10 });
  assert.equal(result.status, "success");
  assert.equal(result.deletedReadings, 2);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM iot_readings").get().c, 1);

  const hourly = db.prepare("SELECT * FROM iot_reading_hourly WHERE point_code='temp'").get();
  assert.equal(hourly.sample_count, 2);
  assert.equal(hourly.min_value, 10);
  assert.equal(hourly.max_value, 20);
  assert.equal(hourly.avg_value, 15);
  assert.equal(hourly.source, "external_adapter");
});

test("iot lifecycle deletes only acknowledged old alarms", () => {
  const db = makeDb();
  lifecycle.runMigration(db);
  const insertAlarm = db.prepare(`
    INSERT INTO iot_alarms (device_id, point_id, alarm_type, severity, acknowledged, created_at)
    VALUES (1, 1, 'high', 'critical', ?, ?)
  `);
  insertAlarm.run(1, "2026-01-01 00:00:00");
  insertAlarm.run(0, "2026-01-01 00:00:00");

  const result = lifecycle.runLifecycle(db, { rawReadingDays: 7, ackedAlarmDays: 30, batchLimit: 10 });
  assert.equal(result.deletedAlarms, 1);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM iot_alarms").get().c, 1);
  assert.equal(db.prepare("SELECT acknowledged FROM iot_alarms").get().acknowledged, 0);
});

test("iot lifecycle status reports raw and hourly ranges", () => {
  const db = makeDb();
  lifecycle.runMigration(db);
  const status = lifecycle.getLifecycleStatus(db);
  assert.deepEqual(Object.keys(status.counts).sort(), ["alarms", "hourly_rows", "open_alarms", "raw_readings"]);
  assert.equal(status.counts.raw_readings, 0);
  assert.equal(status.counts.hourly_rows, 0);
});
