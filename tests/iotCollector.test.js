"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Database = require("better-sqlite3");
const { spawnSync } = require("node:child_process");
const iotCollector = require("../services/iotCollector");
const { makeCollectorDb } = require("./helpers/iotCollectorDb");

const PROJECT_ROOT = path.resolve(__dirname, "..");

function makeAlarmDb() {
  const db = new Database(":memory:");
  db.exec(`
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

test("iot alarm insertion respects configurable cooldown", () => {
  const oldCooldown = process.env.IOT_ALARM_COOLDOWN_MINUTES;
  process.env.IOT_ALARM_COOLDOWN_MINUTES = "30";
  const db = makeAlarmDb();
  const insAlarm = db.prepare(
    "INSERT INTO iot_alarms (device_id, point_id, alarm_type, threshold_value, actual_value, message, severity) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const ids = [];
  const alarm = {
    deviceId: 1,
    pointId: 2,
    type: "high",
    threshold: 100,
    value: 101,
    message: "test",
    severity: "warning",
  };

  assert.equal(iotCollector.insertAlarmIfNeeded(db, insAlarm, ids, alarm), true);
  assert.equal(iotCollector.insertAlarmIfNeeded(db, insAlarm, ids, alarm), false);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM iot_alarms").get().c, 1);

  if (oldCooldown === undefined) delete process.env.IOT_ALARM_COOLDOWN_MINUTES;
  else process.env.IOT_ALARM_COOLDOWN_MINUTES = oldCooldown;
});

test("iot simulator can disable demo spikes", () => {
  const oldRate = process.env.IOT_SIM_ALARM_RATE;
  process.env.IOT_SIM_ALARM_RATE = "0";
  for (let i = 0; i < 50; i++) {
    const value = iotCollector.simulateModbusValue({ point_code: "pressure", alarm_low: 10, alarm_high: 100 }, 50);
    assert.ok(value >= 10);
    assert.ok(value <= 100);
  }
  if (oldRate === undefined) delete process.env.IOT_SIM_ALARM_RATE;
  else process.env.IOT_SIM_ALARM_RATE = oldRate;
});

test("iot alarm severity escalates only on meaningful excursion", () => {
  const point = { alarm_low: 0, alarm_high: 100 };
  assert.equal(iotCollector.classifyAlarmSeverity("high", 101, 100, point), "warning");
  assert.equal(iotCollector.classifyAlarmSeverity("high", 130, 100, point), "critical");
  assert.equal(iotCollector.classifyAlarmSeverity("low", -1, 0, point), "warning");
  assert.equal(iotCollector.classifyAlarmSeverity("low", -30, 0, point), "critical");
});

test("iot collector defaults to production mode", () => {
  const oldMode = process.env.IOT_MODE;
  delete process.env.IOT_MODE;
  assert.equal(iotCollector.getMode(), "production");
  process.env.IOT_MODE = "simulator";
  assert.equal(iotCollector.getMode(), "simulator");
  if (oldMode === undefined) delete process.env.IOT_MODE;
  else process.env.IOT_MODE = oldMode;
});

// P3 (2026-10-10): simulator 模式下 runCollector 每 5s 一行日志会把 mes.log 淹没。
// 默认必须静默，只有 IOT_VERBOSE=1 才输出。
//
// 2026-10-11: 日志改走 app/logger.js (pino 同步写 fd 1)，进程内 monkey-patch
// console.log 已经拦不到，所以这条用例放到子进程里跑、解析真实 stdout。
const CHILD_SCRIPT = [
  'const { makeCollectorDb } = require("./tests/helpers/iotCollectorDb");',
  "const db = makeCollectorDb();",
  'require("./services/iotCollector").runCollector(db);',
  'process.stderr.write("###READINGS=" + db.prepare("SELECT COUNT(*) c FROM iot_readings").get().c + "\\n");',
  "db.close();",
].join("\n");

function runCollectorInChild(verbose) {
  const env = { ...process.env, IOT_MODE: "simulator" };
  if (verbose === undefined) delete env.IOT_VERBOSE;
  else env.IOT_VERBOSE = verbose;

  const result = spawnSync(process.execPath, ["-e", CHILD_SCRIPT], {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    env,
  });
  assert.equal(result.status, 0, `child failed: ${result.stderr}`);
  const match = /###READINGS=(\d+)/.exec(result.stderr);
  assert.ok(match, `child did not report readings: ${result.stderr}`);
  return {
    readings: Number(match[1]),
    lines: result.stdout
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line)),
  };
}

test("periodic collection log stays silent unless IOT_VERBOSE is on", () => {
  const periodic = /^\[iotCollector\] Collected \d+ readings, \d+ alarms, \d+ devices online$/;

  const quiet = runCollectorInChild(undefined);
  assert.ok(quiet.readings > 0, "silencing the log must not stop readings from being written");
  assert.deepEqual(
    quiet.lines.filter((line) => periodic.test(String(line.msg))),
    [],
    "periodic collector log must be silent by default"
  );

  const loud = runCollectorInChild("1");
  const hits = loud.lines.filter((line) => periodic.test(String(line.msg)));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].module, "iotCollector");
  assert.equal(hits[0].level, "info");
  assert.equal(hits[0].service, "factory-mes");
});

test("isVerboseLogging accepts only common truthy spellings", () => {
  const old = process.env.IOT_VERBOSE;
  try {
    for (const value of ["1", "true", "TRUE", " yes ", "on"]) {
      process.env.IOT_VERBOSE = value;
      assert.equal(iotCollector.isVerboseLogging(), true, `expected true for ${JSON.stringify(value)}`);
    }
    for (const value of ["", "0", "false", "no", "off", "verbose", "2"]) {
      process.env.IOT_VERBOSE = value;
      assert.equal(iotCollector.isVerboseLogging(), false, `expected false for ${JSON.stringify(value)}`);
    }
  } finally {
    if (old === undefined) delete process.env.IOT_VERBOSE;
    else process.env.IOT_VERBOSE = old;
  }
});
