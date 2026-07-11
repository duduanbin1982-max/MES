"use strict";
// services/iotCollector.js
// MESA #5: IoT 数据采集器 — Modbus/OPC 模拟 + 实时入库 + WebSocket 推送
//   生产环境替换为 modbus-serial / node-opcua 真实采集
// Author: 三狗子 | MESA #5 Date: 2026-06-26
// Fix: 2026-06-26 - 修复设备全offline bug + 报警泛滥

const { emit, Events } = require("../app/ws/EventBus");

// 全局开关: 采集器是否运行
let collectorInterval = null;
let dbRef = null;

const DEFAULT_ALARM_COOLDOWN_MINUTES = 30;
const DEFAULT_SIM_ALARM_RATE = 0.0002;

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

// Modbus 寄存器模拟值生成器 (正弦波 + 随机噪声)
// 优先按点位阈值生成“正常区间”数据，避免演示模拟器 5s 周期制造报警风暴。
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

// 采集单个设备
function collectDevice(db, device) {
  const points = db
    .prepare("SELECT * FROM iot_data_points WHERE device_id = ? AND is_active = 1")
    .all(device.id);

  if (points.length === 0) return { readings: 0, alarms: [] };

  const insReading = db.prepare(
    "INSERT INTO iot_readings (device_id, point_id, value, quality, read_at) VALUES (?, ?, ?, 'good', datetime('now'))"
  );
  const insAlarm = db.prepare(
    "INSERT INTO iot_alarms (device_id, point_id, alarm_type, threshold_value, actual_value, message, severity) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );

  let readingCount = 0;
  const alarmIds = [];

  const tx = db.transaction(() => {
    for (const pt of points) {
      // 基于点位定义的 baseValue 动态生成 (从 point_code hash 计算)
      const codeHash = pt.point_code.split("").reduce((s, c) => s + c.charCodeAt(0), 0);
      const base = 50 + (codeHash % 50); // 50-100 范围的基值
      const value = simulateModbusValue(pt, base);
      
      const r = insReading.run(device.id, pt.id, value);
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
    console.error("[iotCollector] Transaction error:", e.message);
    return { readings: 0, alarms: [] };
  }

  return { readings: readingCount, alarms: alarmIds };
}

// 主采集循环
function runCollector(db) {
  const devices = db
    .prepare("SELECT * FROM iot_devices WHERE is_active = 1")
    .all();

  if (devices.length === 0) return;

  let totalReadings = 0;
  const allAlarms = [];
  const onlineDeviceIds = [];

  for (const device of devices) {
    try {
      // FIX: 移除随机离线逻辑. 改为始终在线 (生产环境由真实连接状态决定)
      const result = collectDevice(db, device);
      totalReadings += result.readings;
      allAlarms.push(...result.alarms);
      onlineDeviceIds.push(device.id);
    } catch (e) {
      console.error("[iotCollector] Device " + device.device_code + " error:", e.message);
    }
  }

  // R3 优化 (2026-07-10): 把循环内每设备的单条 UPDATE 提到循环外,
  // 改为基于在线 ID 列表的 IN-列表单次 UPDATE.
  // 原来 7 设备 × ~30ms/条 + fsync = P50 ~205ms -> 现 P50 应 < 50ms.
  if (onlineDeviceIds.length > 0) {
    try {
      const placeholders = onlineDeviceIds.map(() => "?").join(",");
      db.prepare(
        "UPDATE iot_devices SET status = 'online', last_seen_at = datetime('now'), updated_at = datetime('now') WHERE id IN (" + placeholders + ")"
      ).run(...onlineDeviceIds);
    } catch (e) {
      console.error("[iotCollector] Batch heartbeat UPDATE failed:", e.message);
    }
  }

  if (totalReadings > 0) {
    console.log("[iotCollector] Collected " + totalReadings + " readings, " + allAlarms.length + " alarms, " + onlineDeviceIds.length + " devices online");

    // WebSocket 推送: 仪表板汇总
    emit(Events.IOT_DASHBOARD, {
      active_devices: onlineDeviceIds.length,
      readings_collected: totalReadings,
      alarms_new: allAlarms.length,
    });

    // 逐个报警推送
    for (const alarm of allAlarms) {
      emit(Events.IOT_ALARM, alarm);
    }
  }
}

// 启动采集器
function start(db, intervalMs) {
  if (collectorInterval) stop();

  dbRef = db;
  const interval = intervalMs || 5000;

  // 标记所有设备 online (开发/演示模式)
  try {
    db.prepare(
      "UPDATE iot_devices SET status = 'online', last_seen_at = datetime('now') WHERE is_active = 1"
    ).run();
    console.log("[iotCollector] Marked all active devices as online");
  } catch (e) {
    // ignore
  }

  console.log("[iotCollector] Starting collector every " + interval + "ms");

  // 立即运行一次
  runCollector(db);

  // 定时运行
  collectorInterval = setInterval(() => runCollector(db), interval);
}

// 停止采集器
function stop() {
  if (collectorInterval) {
    clearInterval(collectorInterval);
    collectorInterval = null;
    console.log("[iotCollector] Stopped");
  }
}

// 手动触发单次采集
function triggerCollect(db) {
  if (!db) return { error: "DB not available" };
  runCollector(db);
  return { ok: true };
}

module.exports = { start, stop, triggerCollect, runCollector, simulateModbusValue, insertAlarmIfNeeded, getAlarmCooldownMinutes, getSimulatorAlarmRate, classifyAlarmSeverity };
