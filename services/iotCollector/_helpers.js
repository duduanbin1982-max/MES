"use strict";
// 从 services/iotCollector.js 搬出的纯声明（不引用模块可变状态）



const logger = require("../../app/logger").createLogger("iotCollector");

const DEFAULT_ALARM_COOLDOWN_MINUTES = 30;

const DEFAULT_SIM_ALARM_RATE = 0.0002;

function getMode() {
  const mode = String(process.env.IOT_MODE || "production").trim().toLowerCase();
  return mode === "simulator" ? "simulator" : "production";
}

function readPositiveNumberEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function getAlarmCooldownMinutes() {
  const minutes = readPositiveNumberEnv("IOT_ALARM_COOLDOWN_MINUTES", DEFAULT_ALARM_COOLDOWN_MINUTES);
  return Math.max(1, Math.min(1440, Math.round(minutes)));
}

function getSimulatorAlarmRate() {
  const rate = readPositiveNumberEnv("IOT_SIM_ALARM_RATE", DEFAULT_SIM_ALARM_RATE);
  return Math.max(0, Math.min(1, rate));
}

function isVerboseLogging() {
  const raw = String(process.env.IOT_VERBOSE || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function logVerbose(...args) {
  if (isVerboseLogging()) logger.info(...args);
}

function classifyAlarmSeverity(type, value, threshold, point) {
  const low = Number(point && point.alarm_low);
  const high = Number(point && point.alarm_high);
  let span = 1;
  if (Number.isFinite(low) && Number.isFinite(high) && high > low) {
    span = high - low;
  } else if (Number.isFinite(threshold) && threshold !== 0) {
    span = Math.abs(threshold);
  }

  const distance = type === "low" ? threshold - value : value - threshold;
  const ratio = distance / Math.max(span, 1);
  return ratio >= 0.2 ? "critical" : "warning";
}

function simulateModbusValue(point, fallbackBaseValue = 50) {
  const pointCode = point.point_code || "";
  const t = Date.now() / 1000;
  const codeHash = pointCode.split("").reduce((s, c) => s + c.charCodeAt(0), 0);
  const freq = 0.05 + (codeHash % 10) * 0.01;
  const high = Number(point.alarm_high);
  const lowRaw = Number(point.alarm_low);
  const hasHigh = Number.isFinite(high) && high > 0;
  const hasLow = Number.isFinite(lowRaw) && lowRaw >= 0 && (!hasHigh || lowRaw < high);

  if (hasHigh) {
    const low = hasLow ? lowRaw : 0;
    const span = Math.max(high - low, Math.max(Math.abs(high) * 0.2, 1));
    const center = low + span * 0.55;
    const amp = Math.max(span * 0.08, 0.2);
    const noise = (Math.random() - 0.5) * amp * 0.3;
    let value = center + Math.sin(t * freq) * amp + noise;

    // 极低概率制造真实演示报警，而不是每次采集都报警。
    if (getSimulatorAlarmRate() > 0 && Math.random() < getSimulatorAlarmRate()) value = high + Math.max(span * 0.05, 0.5);
    return Math.round(value * 100) / 100;
  }

  const amp = 5 + (codeHash % 20);
  const noise = (Math.random() - 0.5) * 3;
  const value = fallbackBaseValue + Math.sin(t * freq) * amp + noise;
  return Math.round(value * 100) / 100;
}

function insertAlarmIfNeeded(db, insAlarm, alarmIds, alarm) {
  const cooldownModifier = "-" + getAlarmCooldownMinutes() + " minutes";
  const recent = db.prepare(`
    SELECT id FROM iot_alarms
    WHERE device_id = ? AND point_id = ? AND alarm_type = ? AND acknowledged = 0
      AND created_at >= datetime('now', ?)
    LIMIT 1
  `).get(alarm.deviceId, alarm.pointId, alarm.type, cooldownModifier);
  if (recent) return false;

  const row = insAlarm.run(
    alarm.deviceId,
    alarm.pointId,
    alarm.type,
    alarm.threshold,
    alarm.value,
    alarm.message,
    alarm.severity || "critical"
  );
  alarmIds.push({
    id: Number(row.lastInsertRowid),
    point_name: alarm.pointName,
    value: alarm.value,
    threshold: alarm.threshold,
    type: alarm.type,
  });
  return true;
}

function collectDevice(db, device) {
  const points = db
    .prepare("SELECT * FROM iot_data_points WHERE device_id = ? AND is_active = 1")
    .all(device.id);

  if (points.length === 0) return { readings: 0, alarms: [] };

  const insReading = db.prepare(
    "INSERT INTO iot_readings (device_id, point_id, value, quality, source, read_at) VALUES (?, ?, ?, 'simulated', 'simulator', datetime('now'))"
  );
  const insAlarm = db.prepare(
    "INSERT INTO iot_alarms (device_id, point_id, alarm_type, threshold_value, actual_value, message, severity, source) VALUES (?, ?, ?, ?, ?, ?, ?, 'simulator')"
  );

  let readingCount = 0;
  const alarmIds = [];

  const tx = db.transaction(() => {
    for (const pt of points) {
      // 基于点位定义的 baseValue 动态生成 (从 point_code hash 计算)
      const codeHash = pt.point_code.split("").reduce((s, c) => s + c.charCodeAt(0), 0);
      const base = 50 + (codeHash % 50); // 50-100 范围的基值
      const value = simulateModbusValue(pt, base);
      
insReading.run(device.id, pt.id, value);
      readingCount++;
      
      // 检查报警。低阈值必须低于高阈值；同一点位同类未确认报警按冷却窗口去重。
      const low = Number(pt.alarm_low);
      const high = Number(pt.alarm_high);
      const validHigh = Number.isFinite(high) && high > 0;
      const validLow = Number.isFinite(low) && low >= 0 && (!validHigh || low < high);
      if (validLow && value < low) {
        insertAlarmIfNeeded(db, insAlarm, alarmIds, {
          deviceId: device.id,
          pointId: pt.id,
          type: "low",
          threshold: low,
          value,
          pointName: pt.point_name,
          message: device.device_name + " " + pt.point_name + " 低于下限 " + low + " " + (pt.unit || ""),
          severity: classifyAlarmSeverity("low", value, low, pt),
        });
      }
      if (validHigh && value > high) {
        insertAlarmIfNeeded(db, insAlarm, alarmIds, {
          deviceId: device.id,
          pointId: pt.id,
          type: "high",
          threshold: high,
          value,
          pointName: pt.point_name,
          message: device.device_name + " " + pt.point_name + " 高于上限 " + high + " " + (pt.unit || ""),
          severity: classifyAlarmSeverity("high", value, high, pt),
        });
      }
    }
  });

  try {
    tx();
  } catch (e) {
    logger.error("[iotCollector] Transaction error:", e.message);
    return { readings: 0, alarms: [] };
  }

  return { readings: readingCount, alarms: alarmIds };
}

module.exports = { DEFAULT_ALARM_COOLDOWN_MINUTES, DEFAULT_SIM_ALARM_RATE, classifyAlarmSeverity, collectDevice, getAlarmCooldownMinutes, getMode, getSimulatorAlarmRate, insertAlarmIfNeeded, isVerboseLogging, logVerbose, logger, readPositiveNumberEnv, simulateModbusValue };
