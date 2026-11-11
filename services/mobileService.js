"use strict";
// 2026-11-11 移动端设备绑定：PDA/手机与账号绑定，便于审计与设备级消息。
const { wrap } = require("../middleware/asyncHandler");
const { ApiError } = require("../app/errors");

function userIdOf(req) {
  return Number((req.user && (req.user.uid || req.user.id)) || 0) || null;
}

function register(app, db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mobile_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      device_name TEXT,
      platform TEXT,
      user_agent TEXT,
      bound_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at TEXT,
      UNIQUE(device_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_mobile_devices_user ON mobile_devices(user_id, revoked_at);
  `);
  const all = (sql, params = []) => db.prepare(sql).all(params);
  const get = (sql, params = []) => db.prepare(sql).get(params);
  const run = (sql, params = []) => db.prepare(sql).run(params);

  app.get("/api/mobile/devices", wrap((req, res) => {
    const userId = userIdOf(req);
    if (!userId) throw ApiError.unauthorized("未登录");
    const isAdmin = req.user?.role === "admin";
    const rows = isAdmin
      ? all("SELECT d.*, u.full_name, u.username FROM mobile_devices d LEFT JOIN users u ON u.id=d.user_id WHERE d.revoked_at IS NULL ORDER BY d.last_seen_at DESC")
      : all("SELECT * FROM mobile_devices WHERE user_id=? AND revoked_at IS NULL ORDER BY last_seen_at DESC", [userId]);
    res.json(rows);
  }));

  app.post("/api/mobile/devices/bind", wrap((req, res) => {
    const userId = userIdOf(req);
    if (!userId) throw ApiError.unauthorized("未登录");
    const deviceId = String(req.body?.device_id || "").trim();
    if (!deviceId) throw ApiError.validation("device_id 必填");
    const name = String(req.body?.device_name || "移动设备").trim().slice(0, 80);
    const platform = String(req.body?.platform || "").trim().slice(0, 80);
    const ua = String(req.headers["user-agent"] || "").slice(0, 300);
    const occupied = get("SELECT id, user_id FROM mobile_devices WHERE device_id=? AND revoked_at IS NULL AND user_id<>?", [deviceId, userId]);
    if (occupied) throw ApiError.conflict("该设备已绑定其他账号，请先在原账号解绑");
    const existing = get("SELECT id FROM mobile_devices WHERE device_id=? AND user_id=? AND revoked_at IS NULL", [deviceId, userId]);
    if (existing) {
      run("UPDATE mobile_devices SET device_name=?, platform=?, user_agent=?, last_seen_at=datetime('now') WHERE id=?", [name, platform, ua, existing.id]);
      return res.json({ ok: true, id: existing.id, already: true });
    }
    const result = run("INSERT INTO mobile_devices (device_id,user_id,device_name,platform,user_agent) VALUES (?,?,?,?,?)", [deviceId, userId, name, platform, ua]);
    res.json({ ok: true, id: result.lastInsertRowid });
  }));

  app.delete("/api/mobile/devices/:id", wrap((req, res) => {
    const userId = userIdOf(req);
    if (!userId) throw ApiError.unauthorized("未登录");
    const row = get("SELECT * FROM mobile_devices WHERE id=?", [Number(req.params.id)]);
    if (!row) throw ApiError.notFound("设备绑定不存在");
    if (row.user_id !== userId && req.user?.role !== "admin") throw ApiError.forbidden("只能解绑自己的设备");
    run("UPDATE mobile_devices SET revoked_at=datetime('now') WHERE id=?", [row.id]);
    res.json({ ok: true });
  }));

  app.post("/api/mobile/devices/heartbeat", wrap((req, res) => {
    const userId = userIdOf(req);
    const deviceId = String(req.body?.device_id || "").trim();
    if (userId && deviceId) run("UPDATE mobile_devices SET last_seen_at=datetime('now') WHERE device_id=? AND user_id=? AND revoked_at IS NULL", [deviceId, userId]);
    res.json({ ok: true });
  }));
}

module.exports = { register };
