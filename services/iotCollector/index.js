"use strict";
// services/iotCollector.js
// MESA #5: IoT 数据采集器 — Modbus/OPC 模拟 + 实时入库 + WebSocket 推送
//   生产环境替换为 modbus-serial / node-opcua 真实采集
// Author: 三狗子 | MESA #5 Date: 2026-06-26
// Fix: 2026-06-26 - 修复设备全offline bug + 报警泛滥

const { emit, Events } = require("../../app/ws/EventBus");


const { DEFAULT_ALARM_COOLDOWN_MINUTES, DEFAULT_SIM_ALARM_RATE, classifyAlarmSeverity, collectDevice, getAlarmCooldownMinutes, getMode, getSimulatorAlarmRate, insertAlarmIfNeeded, isVerboseLogging, logVerbose, logger, readPositiveNumberEnv, simulateModbusValue } = require("./_helpers");

// 全局开关: 采集器是否运行
let collectorInterval = null;
let dbRef = null;












// 周期性日志降噪 (2026-10-10 brooks-sweep P3)
// simulator 模式下 runCollector 每 5s 打印一行 "Collected ... readings"，
// 一天约 1.7 万行会淹没 logs/mes.log，也拖慢 append 写盘。
// 默认静默；需要排障时设 IOT_VERBOSE=1 打开（另一道闸门是全局 LOG_LEVEL）。
// 启动/停止/模式切换等一次性日志不走这里，仍然始终输出。


// 2026-10-11: 走统一 logger，但保留 IOT_VERBOSE 这道模块级闸门
// (LOG_LEVEL 管全局，IOT_VERBOSE 只管这一条周期性日志)。




// Modbus 寄存器模拟值生成器 (正弦波 + 随机噪声)
// 优先按点位阈值生成“正常区间”数据，避免演示模拟器 5s 周期制造报警风暴。




// 采集单个设备


// 主采集循环
function runCollector(db) {
  if (getMode() !== "simulator") return { skipped: true, reason: "IOT_MODE is production" };
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
      logger.error("[iotCollector] Device " + device.device_code + " error:", e.message);
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
      logger.error("[iotCollector] Batch heartbeat UPDATE failed:", e.message);
    }
  }

  if (totalReadings > 0) {
    logVerbose("[iotCollector] Collected " + totalReadings + " readings, " + allAlarms.length + " alarms, " + onlineDeviceIds.length + " devices online");

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

  if (getMode() !== "simulator") {
    logger.info("[iotCollector] Production mode: simulator is disabled");
    return false;
  }

  dbRef = db;
  const interval = intervalMs || 5000;

  // 标记所有设备 online (开发/演示模式)
  try {
    db.prepare(
      "UPDATE iot_devices SET status = 'online', last_seen_at = datetime('now') WHERE is_active = 1"
    ).run();
    logger.info("[iotCollector] Marked all active devices as online");
  } catch (e) {
    // ignore
  }

  logger.info("[iotCollector] Starting collector every " + interval + "ms");

  // 立即运行一次
  runCollector(db);

  // 定时运行
  collectorInterval = setInterval(() => runCollector(db), interval);
  return true;
}

// 停止采集器
function stop() {
  if (collectorInterval) {
    clearInterval(collectorInterval);
    collectorInterval = null;
    logger.info("[iotCollector] Stopped");
  }
}

// 手动触发单次采集
function triggerCollect(db) {
  if (!db) return { error: "DB not available" };
  runCollector(db);
  return { ok: true };
}

module.exports = { start, stop, triggerCollect, runCollector, simulateModbusValue, insertAlarmIfNeeded, getAlarmCooldownMinutes, getSimulatorAlarmRate, classifyAlarmSeverity, getMode, isVerboseLogging, logVerbose };
