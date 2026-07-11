"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const iotService = require("../services/iotService");
const lifecycle = require("../services/iotLifecycleService");

test("threshold validation rejects inverted and out-of-range limits", () => {
  assert.throws(() => iotService.validateThresholds({ alarm_low: 10, alarm_high: 5 }), /alarm_low/);
  assert.throws(() => iotService.validateThresholds({ min_value: 0, alarm_low: -1 }), /min_value/);
  assert.throws(() => iotService.validateThresholds({ max_value: 100, alarm_high: 101 }), /max_value/);
  assert.deepEqual(
    iotService.validateThresholds({ min_value: 0, alarm_low: 10, alarm_high: 90, max_value: 100 }),
    { min: 0, low: 10, high: 90, max: 100 },
  );
});

test("IoT migrations add source provenance columns", () => {
  const db = new Database(":memory:");
  iotService.runMigration(db);
  lifecycle.runMigration(db);
  const columns = (table) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
  assert.ok(columns("iot_readings").has("source"));
  assert.ok(columns("iot_alarms").has("source"));
  assert.ok(columns("iot_reading_hourly").has("source"));
  db.close();
});
