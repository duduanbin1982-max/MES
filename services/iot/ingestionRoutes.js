"use strict";

const { ApiError } = require("../../app/errors");
const { wrap } = require("../../middleware/asyncHandler");
const { emit, Events } = require("../../app/ws/EventBus");

function registerManualEntry(app, db) {
  app.post("/api/iot/manual-entry", wrap((req, res) => {
    const reading = req.body;
    if (!reading.device_code && !reading.equipment_instance_id) reading.equipment_instance_id = null;
    const result = db.prepare(
      "INSERT INTO iot_readings (device_id, point_id, value, quality, source, read_at, point_code, unit, equipment_instance_id, operator_id, notes) VALUES (?, ?, ?, 'manual', 'manual', datetime('now'), ?, ?, ?, ?, ?)"
    ).run(
      reading.device_id || null, reading.point_id || null, reading.value,
      reading.point_code || "manual", reading.unit || null, reading.equipment_instance_id || null,
      reading.operator_id || (req.user ? req.user.sub : 1), reading.notes || null
    );
    const threshold = db.prepare(
      "SELECT * FROM iot_data_points WHERE device_id = ? AND point_code = ? AND is_active = 1 AND min_value IS NOT NULL AND max_value IS NOT NULL"
    ).get(reading.device_id || 0, reading.point_code || "manual");
    if (threshold) {
      const value = Number.parseFloat(reading.value);
      if (value < threshold.min_value || value > threshold.max_value) {
        db.prepare(
          "INSERT INTO iot_alarms (device_id, point_id, alarm_type, threshold_value, actual_value, message, severity, source) VALUES (?, NULL, 'threshold', ?, ?, ?, ?, 'manual')"
        ).run(
          threshold.device_id,
          value < threshold.min_value ? threshold.min_value : threshold.max_value,
          value,
          `${value < threshold.min_value ? "低于" : "超出"}阈值: ${value} (${threshold.min_value}~${threshold.max_value})`,
          value < threshold.min_value ? "warning" : "critical"
        );
      }
    }
    emit(Events.IOT_READING, { device_id: reading.device_id, point_code: reading.point_code, value: reading.value });
    res.json({ id: result.lastInsertRowid });
  }));
}

function registerScanEntry(app, db) {
  app.post("/api/iot/scan-entry", wrap((req, res) => {
    const code = req.body.code;
    if (!code) throw ApiError.validation("code required");
    const workOrder = db.prepare(
      "SELECT wo.*, ei.instance_code, ei.instance_name FROM work_orders wo LEFT JOIN equipment_instances ei ON wo.equipment_instance_id = ei.id WHERE wo.wo_code = ?"
    ).get(code);
    if (workOrder) {
      res.json({ type: "work_order", context: workOrder, fields: ["hours_worked", "quantity_completed", "defect_quantity", "temperature", "pressure", "notes"] });
      return;
    }
    const equipment = db.prepare("SELECT * FROM equipment_instances WHERE instance_code = ? OR id = ?")
      .get(code, Number.isNaN(Number(code)) ? -1 : Number.parseInt(code, 10));
    if (equipment) {
      res.json({ type: "equipment", context: equipment, fields: ["temperature", "vibration", "rpm", "pressure", "current", "notes"] });
      return;
    }
    res.json({ type: "unknown", message: "无法识别扫码内容" });
  }));
}

function registerGatewayEntry(app, db) {
  app.post("/api/iot/modbus/read", wrap((req, res) => {
    const body = req.body;
    if (!body.device_id && !body.ip) throw ApiError.validation("device_id or ip required");
    const device = body.device_id
      ? db.prepare("SELECT * FROM iot_devices WHERE id = ?").get(body.device_id)
      : { ip_address: body.ip, port: body.port || 502, slave_id: body.slave_id || 1 };
    if (!device) throw ApiError.notFound("设备不存在");
    const insert = db.prepare("INSERT INTO iot_readings (device_id, point_code, value, unit, quality, source, read_at) VALUES (?, ?, ?, ?, 'good', 'modbus_gateway', datetime('now'))");
    const readings = body.readings || [];
    const storeReadings = db.transaction(() => {
      readings.forEach((reading, index) => {
        insert.run(device.id || body.device_id, reading.point_code || `register_${reading.address || index}`, reading.value, reading.unit || null);
      });
    });
    storeReadings();
    if (device.id) db.prepare("UPDATE iot_devices SET last_seen_at = datetime('now'), status = 'online' WHERE id = ?").run(device.id);
    res.json({ inserted: readings.length, device: device.ip_address || device.device_code });
  }));
}

function registerHeartbeat(app, db, deviceReadiness) {
  app.post("/api/iot/devices/:id/heartbeat", wrap((req, res) => {
    const device = db.prepare("SELECT * FROM iot_devices WHERE id=?").get(req.params.id);
    if (!device) throw ApiError.notFound("设备不存在");
    const stats = db.prepare("SELECT COUNT(*) AS c, SUM(CASE WHEN register_offset IS NOT NULL THEN 1 ELSE 0 END) AS addressed FROM iot_data_points WHERE device_id=? AND is_active=1").get(device.id);
    if (String(process.env.IOT_MODE || "production").toLowerCase() === "production" && !deviceReadiness(device, stats.c, stats.addressed || 0).configured) {
      throw ApiError.validation("设备连接参数或数据点未配置完成，不能标记在线");
    }
    db.prepare("UPDATE iot_devices SET last_seen_at = datetime('now'), status = 'online' WHERE id = ?").run(req.params.id);
    emit(Events.IOT_HEARTBEAT, { device_id: Number.parseInt(req.params.id, 10) });
    res.json({ ok: true });
  }));
}

function registerIngestionRoutes(app, db, { deviceReadiness }) {
  registerManualEntry(app, db);
  registerScanEntry(app, db);
  registerGatewayEntry(app, db);
  registerHeartbeat(app, db, deviceReadiness);
}

module.exports = { registerGatewayEntry, registerHeartbeat, registerIngestionRoutes, registerManualEntry, registerScanEntry };
