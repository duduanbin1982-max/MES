"use strict";
// services/attendanceService.js
// MESA #6: Worker attendance/clock-in/clock-out tracking
const { ApiError } = require("../app/errors");
const { wrap } = require("../middleware/asyncHandler");

const logger = require("../app/logger").createLogger("attendanceService");

function runMigration(db) {
  db.exec("CREATE TABLE IF NOT EXISTS worker_attendance (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, attendance_date TEXT NOT NULL, clock_in TEXT, clock_out TEXT, hours_worked REAL, status TEXT NOT NULL DEFAULT 'present', workstation_id INTEGER, notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (user_id) REFERENCES users(id), UNIQUE(user_id, attendance_date))");
  db.exec("CREATE INDEX IF NOT EXISTS idx_attendance_user ON worker_attendance(user_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_attendance_date ON worker_attendance(attendance_date)");
}

function makeHelpers(db) {
  return {
    all: (sql, p) => db.prepare(sql).all(...(p || [])),
    get: (sql, p) => db.prepare(sql).get(...(p || [])),
    run: (sql, p) => db.prepare(sql).run(...(p || [])),
  };
}

function register(app, db) {
  runMigration(db);
  const { all, get, run } = makeHelpers(db);

  app.post("/api/labor/attendance/clock-in", wrap((req, res) => {
    const uid = req.body.user_id || req.user?.sub;
    if (!uid) throw ApiError.validation("user_id required");
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    const existing = get("SELECT id FROM worker_attendance WHERE user_id = ? AND attendance_date = ?", [uid, today]);
    if (existing) {
      run("UPDATE worker_attendance SET clock_in = ?, status = 'present', workstation_id = COALESCE(?, workstation_id) WHERE id = ?", [now, req.body.workstation_id || null, existing.id]);
      res.json({ id: existing.id, action: "updated", clock_in: now });
    } else {
      const r = run("INSERT INTO worker_attendance (user_id, attendance_date, clock_in, status, workstation_id, notes) VALUES (?,?,?,'present',?,?)", [uid, today, now, req.body.workstation_id || null, req.body.notes || null]);
      res.json({ id: r.lastInsertRowid, action: "created", clock_in: now });
    }
    run("UPDATE users SET availability = 'online' WHERE id = ?", [uid]);
  }));

  app.post("/api/labor/attendance/clock-out", wrap((req, res) => {
    const uid = req.body.user_id || req.user?.sub;
    if (!uid) throw ApiError.validation("user_id required");
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    const record = get("SELECT * FROM worker_attendance WHERE user_id = ? AND attendance_date = ?", [uid, today]);
    if (!record) throw ApiError.notFound("Today not clocked in");
    const hours = record.clock_in ? Math.round((new Date(now).getTime() - new Date(record.clock_in).getTime()) / 3600000 * 10) / 10 : 0;
    run("UPDATE worker_attendance SET clock_out = ?, hours_worked = ?, notes = COALESCE(?, notes) WHERE id = ?", [now, hours, req.body.notes || null, record.id]);
    res.json({ id: record.id, clock_out: now, hours_worked: hours });
  }));

  app.get("/api/labor/attendance/today", wrap((req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const rows = all("SELECT a.*, u.full_name, u.role_code FROM worker_attendance a JOIN users u ON a.user_id = u.id WHERE a.attendance_date = ? ORDER BY a.clock_in DESC", [today]);
    res.json({ date: today, total: rows.length, present: rows.filter(r => r.status === "present").length, records: rows });
  }));

  app.get("/api/labor/attendance/summary", wrap((req, res) => {
    const { from, to, user_id } = req.query;
    if (!from || !to) throw ApiError.validation("from and to required");
    let sql = "SELECT a.*, u.full_name, u.role_code FROM worker_attendance a JOIN users u ON a.user_id = u.id WHERE a.attendance_date BETWEEN ? AND ?";
    const p = [from, to];
    if (user_id) { sql += " AND a.user_id = ?"; p.push(user_id); }
    sql += " ORDER BY a.attendance_date DESC, a.clock_in DESC";
    const rows = all(sql, p);
    const userStats = {};
    for (const r of rows) {
      if (!userStats[r.user_id]) userStats[r.user_id] = { user_id: r.user_id, full_name: r.full_name, days: 0, total_hours: 0 };
      if (r.status === "present") userStats[r.user_id].days++;
      userStats[r.user_id].total_hours += r.hours_worked || 0;
    }
    res.json({ from, to, total: rows.length, user_stats: Object.values(userStats), records: rows });
  }));

  logger.info("[attendanceService] Attendance tracking registered");
}

module.exports = { register, runMigration };
