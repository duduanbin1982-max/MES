"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { compileCron, cronMatches, executeScheduledReport, runDueReports } = require("../services/reportService/scheduler");

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE scheduled_reports (id INTEGER PRIMARY KEY, report_name TEXT, report_type TEXT, schedule_cron TEXT, filters TEXT, is_active INTEGER, last_run_at TEXT);
    CREATE TABLE report_history (id INTEGER PRIMARY KEY, report_id INTEGER, run_at TEXT DEFAULT (datetime('now')), status TEXT, output_data TEXT, error_msg TEXT);
  `);
  return db;
}

test("five-field cron validates and matches", () => {
  assert.equal(cronMatches("30 8 * * 1", new Date(2026, 6, 13, 8, 30)), true);
  assert.equal(cronMatches("*/15 * * * *", new Date(2026, 6, 13, 8, 30)), true);
  assert.equal(cronMatches("*/15 * * * *", new Date(2026, 6, 13, 8, 31)), false);
  assert.throws(() => compileCron("0 8 * *"), /5/);
  assert.throws(() => compileCron("90 8 * * *"), /非法/);
});

test("manual execution writes successful history", () => {
  const db = makeDb();
  db.prepare("INSERT INTO scheduled_reports VALUES (1, '日报', 'production_daily', '0 8 * * *', '{}', 1, NULL)").run();
  const report = db.prepare("SELECT * FROM scheduled_reports WHERE id=1").get();
  const result = executeScheduledReport(db, report, () => ({ rows: [{ ok: 1 }] }));
  assert.equal(result.status, "success");
  assert.equal(db.prepare("SELECT status FROM report_history").get().status, "success");
  assert.ok(db.prepare("SELECT last_run_at FROM scheduled_reports").get().last_run_at);
});

test("due runner skips nonmatching schedules", () => {
  const db = makeDb();
  db.prepare("INSERT INTO scheduled_reports VALUES (1, '日报', 'production_daily', '0 8 * * *', '{}', 1, NULL)").run();
  assert.equal(runDueReports(db, () => ({}), new Date(2026, 6, 13, 9, 0)).length, 0);
  assert.equal(runDueReports(db, () => ({}), new Date(2026, 6, 13, 8, 0)).length, 1);
});
