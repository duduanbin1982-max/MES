"use strict";
// tests/helpers/iotCollectorDb.js
// simulator 模式跑 runCollector 所需的最小表结构。
// 抽到 helper 是为了让 tests/iotCollector.test.js 能在子进程里建库
// （日志断言要看真实 stdout，而 pino 是同步写 fd 1，
//   在进程内 monkey-patch console.log 已经拦不到）。

const Database = require("better-sqlite3");

function makeCollectorDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE iot_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_code TEXT NOT NULL,
      device_name TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      status TEXT,
      last_seen_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE iot_data_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      point_code TEXT NOT NULL,
      point_name TEXT,
      unit TEXT,
      alarm_low REAL,
      alarm_high REAL,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE iot_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      point_id INTEGER NOT NULL,
      value REAL,
      quality TEXT,
      source TEXT,
      read_at TEXT
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
      source TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.prepare("INSERT INTO iot_devices (id, device_code, device_name) VALUES (1, 'DEV-1', '测试设备')").run();
  db.prepare(
    "INSERT INTO iot_data_points (device_id, point_code, point_name, unit, alarm_low, alarm_high) VALUES (1, 'pressure', '压力', 'kPa', 0, 100)"
  ).run();
  return db;
}

module.exports = { makeCollectorDb };
