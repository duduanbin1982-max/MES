"use strict";

const { ApiError } = require("../../app/errors");

let schedulerTimer = null;

function parseField(field, min, max) {
  const value = String(field || "").trim();
  if (value === "*") return () => true;
  const stepMatch = /^\*\/(\d+)$/.exec(value);
  if (stepMatch) {
    const step = Number(stepMatch[1]);
    if (!step || step > max - min + 1) throw ApiError.validation("Cron 步长非法: " + value);
    return (actual) => (actual - min) % step === 0;
  }
  const values = value.split(",").map(Number);
  if (!values.length || values.some((item) => !Number.isInteger(item) || item < min || item > max)) {
    throw ApiError.validation("Cron 字段非法: " + value);
  }
  return (actual) => values.includes(actual);
}

function compileCron(expression) {
  const fields = String(expression || "").trim().split(/\s+/);
  if (fields.length !== 5) throw ApiError.validation("Cron 必须是 5 段: 分 时 日 月 周");
  const matchers = [
    parseField(fields[0], 0, 59), parseField(fields[1], 0, 23), parseField(fields[2], 1, 31),
    parseField(fields[3], 1, 12), parseField(fields[4], 0, 6),
  ];
  return (date) => matchers[0](date.getMinutes()) && matchers[1](date.getHours()) &&
    matchers[2](date.getDate()) && matchers[3](date.getMonth() + 1) && matchers[4](date.getDay());
}

function cronMatches(expression, date = new Date()) {
  return compileCron(expression)(date);
}

function parseFilters(value) {
  try { return JSON.parse(value || "{}"); } catch (_error) { return {}; }
}

function executeScheduledReport(db, report, generateReport) {
  const history = db.prepare("INSERT INTO report_history (report_id, status) VALUES (?, 'running')").run(report.id);
  const historyId = Number(history.lastInsertRowid);
  try {
    const output = generateReport(report.report_type, parseFilters(report.filters));
    db.prepare("UPDATE report_history SET status='success', output_data=? WHERE id=?").run(JSON.stringify(output), historyId);
    db.prepare("UPDATE scheduled_reports SET last_run_at=datetime('now') WHERE id=?").run(report.id);
    return { history_id: historyId, status: "success", output };
  } catch (error) {
    db.prepare("UPDATE report_history SET status='failed', error_msg=? WHERE id=?").run(error.message, historyId);
    db.prepare("UPDATE scheduled_reports SET last_run_at=datetime('now') WHERE id=?").run(report.id);
    return { history_id: historyId, status: "failed", error: error.message };
  }
}

function runDueReports(db, generateReport, now = new Date()) {
  const minuteStart = now.toISOString().slice(0, 16).replace("T", " ");
  const reports = db.prepare("SELECT * FROM scheduled_reports WHERE is_active=1 AND schedule_cron IS NOT NULL").all();
  const results = [];
  for (const report of reports) {
    try {
      if (!cronMatches(report.schedule_cron, now)) continue;
      if (report.last_run_at && String(report.last_run_at).slice(0, 16) === minuteStart) continue;
      results.push({ report_id: report.id, ...executeScheduledReport(db, report, generateReport) });
    } catch (error) {
      results.push({ report_id: report.id, status: "failed", error: error.message });
    }
  }
  return results;
}

function startScheduler(db, generateReport) {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = setInterval(() => {
    const results = runDueReports(db, generateReport);
    if (results.length) console.log(`[reportScheduler] executed ${results.length} scheduled report(s)`);
  }, 60_000);
  schedulerTimer.unref?.();
}

module.exports = { compileCron, cronMatches, executeScheduledReport, runDueReports, startScheduler };
