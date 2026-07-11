"use strict";
const { ApiError } = require('../app/errors');
// services/iotService.js
// P2-2 IoT/SCADA Integration: Device registry + Data collection + Real-time monitoring
// Supports Modbus TCP / OPC UA stub + MQTT placeholder
const fs = require("fs");
const { wrap } = require('../middleware/asyncHandler');
const { emit, Events } = require('../app/ws/EventBus');
const path = require("path");

function columnNames(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
}

function addColumn(db, table, name, definition) {
  if (!columnNames(db, table).has(name)) db.prepare(`ALTER TABLE ${table} ADD COLUMN ${definition}`).run();
}

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

function runMigration(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS iot_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_code TEXT NOT NULL UNIQUE,
      device_name TEXT NOT NULL,
      device_type TEXT NOT NULL DEFAULT 'sensor',
      protocol TEXT NOT NULL DEFAULT 'modbus',
      connection_string TEXT,
      ip_address TEXT,
      port INTEGER,
      slave_id INTEGER,
      register_start INTEGER,
      register_count INTEGER,
      scan_interval_ms INTEGER NOT NULL DEFAULT 5000,
      equipment_id INTEGER,
      location TEXT,
      manufacturer TEXT,
      model TEXT,
      status TEXT NOT NULL DEFAULT 'offline',
      last_seen_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (equipment_id) REFERENCES equipment_instances(id)
    );
    CREATE TABLE IF NOT EXISTS iot_data_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      point_name TEXT NOT NULL,
      point_code TEXT NOT NULL,
      data_type TEXT NOT NULL DEFAULT 'float',
      unit TEXT,
      register_offset INTEGER,
      min_value REAL, max_value REAL,
      alarm_low REAL, alarm_high REAL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (device_id) REFERENCES iot_devices(id) ON DELETE CASCADE,
      UNIQUE(device_id, point_code)
    );
    CREATE TABLE IF NOT EXISTS iot_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      point_id INTEGER,
      value REAL,
      quality TEXT NOT NULL DEFAULT 'good',
      read_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (device_id) REFERENCES iot_devices(id),
      FOREIGN KEY (point_id) REFERENCES iot_data_points(id)
    );
    CREATE TABLE IF NOT EXISTS iot_alarms (
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (device_id) REFERENCES iot_devices(id),
      FOREIGN KEY (point_id) REFERENCES iot_data_points(id)
    );
    CREATE INDEX IF NOT EXISTS idx_iot_readings_device ON iot_readings(device_id, read_at);
    CREATE INDEX IF NOT EXISTS idx_iot_readings_point ON iot_readings(point_id, read_at);
    CREATE INDEX IF NOT EXISTS idx_iot_alarms_device ON iot_alarms(device_id, acknowledged);
    CREATE INDEX IF NOT EXISTS idx_iot_devices_status ON iot_devices(status);
  `);
  addColumn(db, "iot_readings", "source", "source TEXT NOT NULL DEFAULT 'external_adapter'");
  addColumn(db, "iot_alarms", "source", "source TEXT NOT NULL DEFAULT 'external_adapter'");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_iot_readings_source_time ON iot_readings(source, read_at);
    CREATE INDEX IF NOT EXISTS idx_iot_alarms_source_time ON iot_alarms(source, created_at);
  `);
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
    res.json(all(sql, p));
  }));

  app.get("/api/iot/devices/:id", wrap((req, res) => {
    const row = get("SELECT d.*, ei.instance_code FROM iot_devices d LEFT JOIN equipment_instances ei ON d.equipment_id=ei.id WHERE d.id=?", [req.params.id]);
    if (!row) throw ApiError.notFound("Device not found")
    const points = all("SELECT * FROM iot_data_points WHERE device_id=? ORDER BY id", [req.params.id]);
    res.json(Object.assign({}, row, { points }));
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
  const { all, get, run, wrap } = makeHelpers(db);

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
    res.json({
      devices: { online: onlineCount, total: totalCount, offline: totalCount - onlineCount },
      readings_24h: readings24h,
      unack_alarms: unackAlarms,
      recent_alarms: recentAlarms
    });
  }));
}

function register(app, db) {
  runMigration(db);
  registerDevices(app, db);
  registerPoints(app, db);
  registerReadings(app, db);
  registerAlarms(app, db);
  registerDashboard(app, db);
  console.log("[iotService] IoT/SCADA integration registered (Devices + Readings + Alarms + Dashboard)");

  // ====== MESA #5: 人工数据录入 ======
  app.post("/api/iot/manual-entry", wrap((req, res) => {
    var reading = req.body;
    if (!reading.device_code && !reading.equipment_instance_id) reading.equipment_instance_id = null;
    var r = db.prepare(
      "INSERT INTO iot_readings (device_id, point_id, value, quality, source, read_at, point_code, unit, equipment_instance_id, operator_id, notes) VALUES (?, ?, ?, 'manual', 'manual', datetime('now'), ?, ?, ?, ?, ?)"
    ).run(
      reading.device_id || null, reading.point_id || null, reading.value,
      reading.point_code || 'manual', reading.unit || null, reading.equipment_instance_id || null,
      reading.operator_id || (req.user ? req.user.sub : 1), reading.notes || null
    );
    
    // Check alarm thresholds
    var alarm = db.prepare(
      "SELECT * FROM iot_alarm_rules WHERE device_id = ? AND point_code = ? AND is_active = 1 AND min_value IS NOT NULL AND max_value IS NOT NULL"
    ).get(reading.device_id || 0, reading.point_code || 'manual');
    if (alarm) {
      var v = parseFloat(reading.value);
      if (v < alarm.min_value || v > alarm.max_value) {
        db.prepare(
          "INSERT INTO iot_alarms (device_id, point_id, alarm_type, threshold_value, actual_value, message, severity, source) VALUES (?, NULL, 'threshold', ?, ?, ?, ?, 'manual')"
        ).run(alarm.device_id, v < alarm.min_value ? alarm.min_value : alarm.max_value, v,
          (v < alarm.min_value ? '低于' : '超出') + '阈值: ' + v + ' (' + alarm.min_value + '~' + alarm.max_value + ')',
          v < alarm.min_value ? 'warning' : 'critical');
      }
    }
    
    emit(Events.IOT_READING, { device_id: reading.device_id, point_code: reading.point_code, value: reading.value });
    res.json({ id: r.lastInsertRowid });
  }));

  // 扫码快速录入: scan code -> auto-fill context
  app.post("/api/iot/scan-entry", wrap((req, res) => {
    var code = req.body.code;
    if (!code) throw ApiError.validation("code required");
    
    // Look up work order
    var wo = db.prepare(
      "SELECT wo.*, ei.instance_code, ei.instance_name FROM work_orders wo LEFT JOIN equipment_instances ei ON wo.equipment_instance_id = ei.id WHERE wo.wo_code = ?"
    ).get(code);
    if (wo) {
      res.json({ type: 'work_order', context: wo, fields: ['hours_worked', 'quantity_completed', 'defect_quantity', 'temperature', 'pressure', 'notes'] });
      return;
    }
    
    // Look up equipment
    var eq = db.prepare(
      "SELECT * FROM equipment_instances WHERE instance_code = ? OR id = ?"
    ).get(code, isNaN(code) ? -1 : parseInt(code));
    if (eq) {
      res.json({ type: 'equipment', context: eq, fields: ['temperature', 'vibration', 'rpm', 'pressure', 'current', 'notes'] });
      return;
    }
    
    res.json({ type: 'unknown', message: '无法识别扫码内容' });
  }));

  // ====== Modbus TCP 真实采集接口 ======
  app.post("/api/iot/modbus/read", wrap((req, res) => {
    var body = req.body;
    if (!body.device_id && !body.ip) throw ApiError.validation("device_id or ip required");
    
    var device = body.device_id 
      ? db.prepare("SELECT * FROM iot_devices WHERE id = ?").get(body.device_id)
      : { ip_address: body.ip, port: body.port || 502, slave_id: body.slave_id || 1 };
    
    if (!device) throw ApiError.notFound("设备不存在");
    
    // For real Modbus TCP, use modbus-serial package
    // Here we provide the interface and store readings from external adapter
    var readings = body.readings || [];
    var inserted = 0;
    
    var insert = db.prepare(
      "INSERT INTO iot_readings (device_id, point_code, value, unit, quality, source, read_at) VALUES (?, ?, ?, ?, 'good', 'modbus_gateway', datetime('now'))"
    );
    
    var tx = db.transaction(function() {
      for (var i = 0; i < readings.length; i++) {
        var r = readings[i];
        insert.run(device.id || body.device_id, r.point_code || ('register_' + (r.address || i)), r.value, r.unit || null);
        inserted++;
      }
    });
    tx();
    
    // Update device last_seen
    if (device.id) {
      db.prepare("UPDATE iot_devices SET last_seen_at = datetime('now'), status = 'online' WHERE id = ?").run(device.id);
    }
    
    res.json({ inserted: inserted, device: device.ip_address || device.device_code });
  }));

  // 手动标记设备在线状态
  app.post("/api/iot/devices/:id/heartbeat", wrap((req, res) => {
    db.prepare("UPDATE iot_devices SET last_seen_at = datetime('now'), status = 'online' WHERE id = ?").run(req.params.id);
    emit(Events.IOT_HEARTBEAT, { device_id: parseInt(req.params.id) });
    res.json({ ok: true });
  }));

}

module.exports = { register, runMigration, validateThresholds };
