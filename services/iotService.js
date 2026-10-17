"use strict";
const { ApiError } = require('../app/errors');
// services/iotService.js
// P2-2 IoT/SCADA Integration: Device registry + Data collection + Real-time monitoring
// Supports Modbus TCP / OPC UA stub + MQTT placeholder
require("fs");
require('../middleware/asyncHandler');
require("path");
const { registerIngestionRoutes } = require("./iot/ingestionRoutes");
const { runMigration } = require("./iot/schema");

const logger = require("../app/logger").createLogger("iotService");

function validateThresholds(input) {
  const low = input.alarm_low === null || input.alarm_low === undefined || input.alarm_low === "" ? null : Number(input.alarm_low);
  const high = input.alarm_high === null || input.alarm_high === undefined || input.alarm_high === "" ? null : Number(input.alarm_high);
  const min = input.min_value === null || input.min_value === undefined || input.min_value === "" ? null : Number(input.min_value);
  const max = input.max_value === null || input.max_value === undefined || input.max_value === "" ? null : Number(input.max_value);
  if ([low, high, min, max].some((value) => value !== null && !Number.isFinite(value))) {
    throw ApiError.validation("点位上下限必须是有效数字");
  }
  if (low !== null && high !== null && low >= high) throw ApiError.validation("alarm_low 必须小于 alarm_high");
  if (min !== null && max !== null && min >= max) throw ApiError.validation("min_value 必须小于 max_value");
  if (min !== null && low !== null && low < min) throw ApiError.validation("alarm_low 不能小于 min_value");
  if (max !== null && high !== null && high > max) throw ApiError.validation("alarm_high 不能大于 max_value");
  return { low, high, min, max };
}

function deviceReadiness(device, pointCount = 0, addressedPointCount = pointCount) {
  const protocol = String(device.protocol || "").toLowerCase();
  let connectionReady;
  if (protocol === "modbus") connectionReady = Boolean(device.ip_address && Number(device.port) > 0);
  else connectionReady = Boolean(device.connection_string);
  const pointsReady = Number(pointCount) > 0 && (protocol !== "modbus" || Number(addressedPointCount) === Number(pointCount));
  return {
    configured: connectionReady && pointsReady,
    connection_ready: connectionReady,
    point_count: Number(pointCount),
    addressed_point_count: Number(addressedPointCount),
    missing: [!connectionReady ? "connection" : null, Number(pointCount) <= 0 ? "data_points" : null,
      protocol === "modbus" && Number(addressedPointCount) !== Number(pointCount) ? "register_offsets" : null].filter(Boolean),
  };
}

function hasRecentOpenAlarm(db, deviceId, pointId, alarmType) {
  if (!pointId) return false;
  return !!db.prepare(`
    SELECT id FROM iot_alarms
    WHERE device_id = ? AND point_id = ? AND alarm_type = ? AND acknowledged = 0
      AND created_at >= datetime('now', '-5 minutes')
    LIMIT 1
  `).get(deviceId, pointId, alarmType);
}

function makeHelpers(db) {
  return {
    all: (sql, p) => db.prepare(sql).all(...(p||[])),
    get: (sql, p) => db.prepare(sql).get(...(p||[])),
    run: (sql, p) => db.prepare(sql).run(...(p||[])),
    wrap: (fn) => (req, res, next) => { try { fn(req,res,next); } catch(e) { res.status(e.status||500).json({error:e.message}); } }
  };
}

// === Device CRUD ===
function registerDevices(app, db) {
  const { all, get, run, wrap } = makeHelpers(db);

  app.get("/api/iot/devices", wrap((req, res) => {
    const { status, type, equipment_id } = req.query;
    let sql = "SELECT d.*, ei.instance_code FROM iot_devices d LEFT JOIN equipment_instances ei ON d.equipment_id=ei.id WHERE 1=1";
    const p = [];
    if (status) { sql += " AND d.status=?"; p.push(status); }
    if (type) { sql += " AND d.device_type=?"; p.push(type); }
    if (equipment_id) { sql += " AND d.equipment_id=?"; p.push(equipment_id); }
    sql += " ORDER BY d.id";
    res.json(all(sql, p).map((device) => {
      const pointStats = db.prepare("SELECT COUNT(*) AS c, SUM(CASE WHEN register_offset IS NOT NULL THEN 1 ELSE 0 END) AS addressed FROM iot_data_points WHERE device_id=? AND is_active=1").get(device.id);
      return { ...device, readiness: deviceReadiness(device, pointStats.c, pointStats.addressed || 0) };
    }));
  }));

  app.get("/api/iot/devices/:id", wrap((req, res) => {
    const row = get("SELECT d.*, ei.instance_code FROM iot_devices d LEFT JOIN equipment_instances ei ON d.equipment_id=ei.id WHERE d.id=?", [req.params.id]);
    if (!row) throw ApiError.notFound("Device not found")
    const points = all("SELECT * FROM iot_data_points WHERE device_id=? ORDER BY id", [req.params.id]);
    const activePoints = points.filter((point) => point.is_active);
    res.json(Object.assign({}, row, { readiness: deviceReadiness(row, activePoints.length, activePoints.filter((point) => point.register_offset !== null).length), points }));
  }));

  app.post("/api/iot/devices", wrap((req, res) => {
    const { device_code, device_name, device_type, protocol, ip_address, port, slave_id, register_start, register_count, scan_interval_ms, equipment_id, location } = req.body;
    if (!device_code || !device_name) throw ApiError.validation("device_code and device_name required")
    const r = run("INSERT INTO iot_devices (device_code,device_name,device_type,protocol,ip_address,port,slave_id,register_start,register_count,scan_interval_ms,equipment_id,location) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [device_code, device_name, device_type||"sensor", protocol||"modbus", ip_address||null, port||null, slave_id||null, register_start||null, register_count||null, scan_interval_ms||5000, equipment_id||null, location||null]);
    res.json({ id: r.lastInsertRowid, device_code });
  }));

  app.put("/api/iot/devices/:id", wrap((req, res) => {
    const { device_name, ip_address, port, scan_interval_ms, equipment_id, location, is_active } = req.body;
    run("UPDATE iot_devices SET device_name=COALESCE(?,device_name), ip_address=COALESCE(?,ip_address), port=COALESCE(?,port), scan_interval_ms=COALESCE(?,scan_interval_ms), equipment_id=COALESCE(?,equipment_id), location=COALESCE(?,location), is_active=COALESCE(?,is_active), updated_at=datetime('now') WHERE id=?",
      [device_name||null, ip_address||null, port||null, scan_interval_ms||null, equipment_id||null, location||null, is_active!==undefined?is_active:null, req.params.id]);
    res.json({ success: true });
  }));

  app.patch("/api/iot/devices/:id/status", wrap((req, res) => {
    const { status } = req.body;
    if (!status) throw ApiError.validation("status required")
    run("UPDATE iot_devices SET status=?, last_seen_at=CASE WHEN ?='online' THEN datetime('now') ELSE last_seen_at END, updated_at=datetime('now') WHERE id=?",
      [status, status, req.params.id]);
    res.json({ success: true });
  }));
}

// === Data Points ===
function registerPoints(app, db) {
  const { all, get, run, wrap } = makeHelpers(db);

  app.get("/api/iot/devices/:id/points", wrap((req, res) => {
    res.json(all("SELECT * FROM iot_data_points WHERE device_id=? ORDER BY id", [req.params.id]));
  }));

  app.post("/api/iot/devices/:id/points", wrap((req, res) => {
    const { point_name, point_code, data_type, unit, register_offset, min_value, max_value, alarm_low, alarm_high } = req.body;
    if (!point_name || !point_code) throw ApiError.validation("point_name and point_code required")
    const thresholds = validateThresholds({ min_value, max_value, alarm_low, alarm_high });
    const r = run("INSERT INTO iot_data_points (device_id,point_name,point_code,data_type,unit,register_offset,min_value,max_value,alarm_low,alarm_high) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [req.params.id, point_name, point_code, data_type||"float", unit||null, register_offset||null, thresholds.min, thresholds.max, thresholds.low, thresholds.high]);
    res.json({ id: r.lastInsertRowid, point_code });
  }));

  app.patch("/api/iot/points/:id", wrap((req, res) => {
    const current = get("SELECT * FROM iot_data_points WHERE id=?", [req.params.id]);
    if (!current) throw ApiError.notFound("Point not found");
    const merged = { ...current, ...req.body };
    const thresholds = validateThresholds(merged);
    run(`UPDATE iot_data_points SET point_name=?, unit=?, min_value=?, max_value=?, alarm_low=?, alarm_high=?, is_active=? WHERE id=?`, [
      merged.point_name, merged.unit || null, thresholds.min, thresholds.max, thresholds.low, thresholds.high,
      merged.is_active === undefined ? current.is_active : Number(Boolean(merged.is_active)), req.params.id,
    ]);
    res.json(get("SELECT * FROM iot_data_points WHERE id=?", [req.params.id]));
  }));
}

// === Readings (data ingestion) ===
function registerReadings(app, db) {
  const { all, get, run, wrap } = makeHelpers(db);

  // Simulated: push a reading (in production this comes from Modbus/OPC collector)
  app.post("/api/iot/readings", wrap((req, res) => {
    const { device_code, points } = req.body;
    if (!device_code || !points) throw ApiError.validation("device_code and points required")

    const dev = get("SELECT id FROM iot_devices WHERE device_code=?", [device_code]);
    if (!dev) throw ApiError.notFound("Device not found: " + device_code);

    let count = 0;
    const alarmIds = [];
    const insReading = db.prepare("INSERT INTO iot_readings (device_id,point_id,value,quality,source,read_at) VALUES (?,?,?,'good','external_adapter',datetime('now'))");
    const insAlarm = db.prepare("INSERT INTO iot_alarms (device_id,point_id,alarm_type,threshold_value,actual_value,message,severity,source) VALUES (?,?,?,?,?,?,?,'external_adapter')");

    const tx = db.transaction(() => {
      for (const p of points) {
        const pt = get("SELECT id, alarm_low, alarm_high, point_name, unit FROM iot_data_points WHERE device_id=? AND point_code=?", [dev.id, p.code]);
        const ptId = pt ? pt.id : null;
        insReading.run(dev.id, ptId, p.value);

        // Alarm check
        const low = pt ? Number(pt.alarm_low) : NaN;
        const high = pt ? Number(pt.alarm_high) : NaN;
        const validHigh = Number.isFinite(high) && high > 0;
        const validLow = Number.isFinite(low) && low >= 0 && (!validHigh || low < high);
        if (pt && validLow && p.value < low && !hasRecentOpenAlarm(db, dev.id, ptId, "low")) {
          const r = insAlarm.run(dev.id, ptId, "low", low, p.value,
            pt.point_name + "=" + p.value + (pt.unit || "") + " 低于下限 " + low, "warning");
          alarmIds.push(r.lastInsertRowid);
        }
        if (pt && validHigh && p.value > high && !hasRecentOpenAlarm(db, dev.id, ptId, "high")) {
          const r = insAlarm.run(dev.id, ptId, "high", high, p.value,
            pt.point_name + "=" + p.value + (pt.unit || "") + " 超上限 " + high, "critical");
          alarmIds.push(r.lastInsertRowid);
        }
        count++;
      }
      run("UPDATE iot_devices SET status='online', last_seen_at=datetime('now'), updated_at=datetime('now') WHERE id=?", [dev.id]);
    });
    tx();

    res.json({ ingested: count, device_id: dev.id, alarms_triggered: alarmIds.length });
  }));

  app.get("/api/iot/readings", wrap((req, res) => {
    const { device_id, point_id, hours } = req.query;
    const h = parseInt(hours) || 24;
    let sql = "SELECT r.*, d.device_code, dp.point_name, dp.unit FROM iot_readings r JOIN iot_devices d ON r.device_id=d.id LEFT JOIN iot_data_points dp ON r.point_id=dp.id WHERE r.read_at >= datetime('now','-" + h + " hours')";
    const p = [];
    if (device_id) { sql += " AND r.device_id=?"; p.push(device_id); }
    if (point_id) { sql += " AND r.point_id=?"; p.push(point_id); }
    sql += " ORDER BY r.read_at DESC LIMIT 2000";
    res.json(all(sql, p));
  }));

  app.get("/api/iot/readings/latest", wrap((req, res) => {
    res.json(all(
      "SELECT d.id AS device_id, d.device_code, d.device_name, d.status, r.value, r.read_at, dp.point_name, dp.unit FROM iot_devices d LEFT JOIN (SELECT device_id, MAX(id) AS max_id FROM iot_readings GROUP BY device_id) latest ON d.id=latest.device_id LEFT JOIN iot_readings r ON r.id=latest.max_id LEFT JOIN iot_data_points dp ON r.point_id=dp.id WHERE d.is_active=1 ORDER BY d.id"
    ));
  }));
}

// === Alarms ===
function registerAlarms(app, db) {
  const { all, run, wrap } = makeHelpers(db);

  app.get("/api/iot/alarms", wrap((req, res) => {
    const { device_id, acknowledged, severity } = req.query;
    let sql = "SELECT a.*, d.device_code, d.device_name, dp.point_name FROM iot_alarms a JOIN iot_devices d ON a.device_id=d.id LEFT JOIN iot_data_points dp ON a.point_id=dp.id WHERE 1=1";
    const p = [];
    if (device_id) { sql += " AND a.device_id=?"; p.push(device_id); }
    if (acknowledged !== undefined) { sql += " AND a.acknowledged=?"; p.push(acknowledged); }
    if (severity) { sql += " AND a.severity=?"; p.push(severity); }
    sql += " ORDER BY a.created_at DESC LIMIT 200";
    res.json(all(sql, p));
  }));

  app.patch("/api/iot/alarms/:id/ack", wrap((req, res) => {
    const userId = (req.user && req.user.sub) || null;
    run("UPDATE iot_alarms SET acknowledged=1, acknowledged_by=?, acknowledged_at=datetime('now') WHERE id=?", [userId, req.params.id]);
    res.json({ success: true });
  }));
}

// === Dashboard ===
function registerDashboard(app, db) {
  const { all, wrap } = makeHelpers(db);

  app.get("/api/iot/dashboard", wrap((req, res) => {
    const onlineCount = db.prepare("SELECT COUNT(*) AS c FROM iot_devices WHERE status='online'").get().c;
    const totalCount = db.prepare("SELECT COUNT(*) AS c FROM iot_devices WHERE is_active=1").get().c;
    const unackAlarms = db.prepare("SELECT COUNT(*) AS c FROM iot_alarms WHERE acknowledged=0").get().c;
    const readings24h = db.prepare("SELECT COUNT(*) AS c FROM iot_readings WHERE read_at >= datetime('now','-24 hours')").get().c;
    const recentAlarms = all("SELECT a.*, d.device_code, dp.point_name FROM iot_alarms a JOIN iot_devices d ON a.device_id=d.id LEFT JOIN iot_data_points dp ON a.point_id=dp.id WHERE a.acknowledged=0 ORDER BY a.created_at DESC LIMIT 10");
    const configured = db.prepare(`SELECT COUNT(*) AS c FROM iot_devices d
      WHERE d.is_active=1
        AND ((d.protocol='modbus' AND d.ip_address IS NOT NULL AND d.ip_address<>'' AND d.port>0)
          OR (d.protocol<>'modbus' AND d.connection_string IS NOT NULL AND d.connection_string<>''))
        AND EXISTS (SELECT 1 FROM iot_data_points dp WHERE dp.device_id=d.id AND dp.is_active=1)
        AND (d.protocol<>'modbus' OR NOT EXISTS (SELECT 1 FROM iot_data_points dp WHERE dp.device_id=d.id AND dp.is_active=1 AND dp.register_offset IS NULL))`).get().c;
    res.json({
      mode: String(process.env.IOT_MODE || "production").toLowerCase(),
      devices: { online: onlineCount, total: totalCount, offline: totalCount - onlineCount },
      configured_devices: configured,
      readings_24h: readings24h,
      unack_alarms: unackAlarms,
      recent_alarms: recentAlarms
    });
  }));

  app.get("/api/iot/readiness", wrap((_req, res) => {
    const devices = all("SELECT * FROM iot_devices WHERE is_active=1 ORDER BY device_code").map((device) => {
      const stats = db.prepare("SELECT COUNT(*) AS c, SUM(CASE WHEN register_offset IS NOT NULL THEN 1 ELSE 0 END) AS addressed FROM iot_data_points WHERE device_id=? AND is_active=1").get(device.id);
      return { id: device.id, device_code: device.device_code, device_name: device.device_name, ...deviceReadiness(device, stats.c, stats.addressed || 0) };
    });
    res.json({ mode: String(process.env.IOT_MODE || "production").toLowerCase(), ready: devices.filter((item) => item.configured).length, total: devices.length, devices });
  }));
}

function register(app, db) {
  runMigration(db);
  registerDevices(app, db);
  registerPoints(app, db);
  registerReadings(app, db);
  registerAlarms(app, db);
  registerDashboard(app, db);
  registerIngestionRoutes(app, db, { deviceReadiness });
  logger.info("[iotService] IoT/SCADA integration registered (Devices + Readings + Alarms + Dashboard)");

}

module.exports = { deviceReadiness, register, runMigration, validateThresholds };
