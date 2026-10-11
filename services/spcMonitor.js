"use strict";
// services/spcMonitor.js
// MESA #7: SPC 实时监控 — 自动分析工艺参数，WECO 规则触发报警
//   利用 IoT 采集器的 process_params 数据，定时运行 SPC 分析
// Author: 三狗子 | MESA #7 Date: 2026-06-26

const { xbarR, capability, wecoRules } = require("../app/spc/engine");
const { emit, Events } = require("../app/ws/EventBus");

const logger = require("../app/logger").createLogger("spcMonitor");

const PARAM_COLS = ["current_amp", "voltage_v", "speed_mm_min", "temperature_c", "pressure_mpa", "feed_rate"];
const PARAM_LABELS = {
  current_amp: "电流(A)", voltage_v: "电压(V)", speed_mm_min: "速度(mm/min)",
  temperature_c: "温度(°C)", pressure_mpa: "压力(MPa)", feed_rate: "进给率",
};

let monitorInterval = null;

function analyzeNode(db, node) {
  const results = [];
  
  for (const param of PARAM_COLS) {
    const rows = db.prepare(
      `SELECT ${param} AS value FROM process_params WHERE process_node_id = ? AND ${param} IS NOT NULL ORDER BY recorded_at DESC LIMIT 200`
    ).all(node.id);
    
    const values = rows.map(r => r.value);
    if (values.length < 15) continue;

    // Get spec limits
    let usl = null, lsl = null;
    const specRow = db.prepare(
      "SELECT custom_json FROM process_params WHERE process_node_id = ? AND custom_json IS NOT NULL ORDER BY id DESC LIMIT 1"
    ).get(node.id);
    if (specRow) {
      try {
        const j = JSON.parse(specRow.custom_json);
        if (j.spc && j.spc[param]) {
          usl = j.spc[param].usl;
          lsl = j.spc[param].lsl;
        }
      } catch (_error) {
        usl = null;
        lsl = null;
      }
    }

    const xr = xbarR(values, 5, usl, lsl);
    if (xr.error) continue;

    const cap = capability(values, usl, lsl);
    const alerts = wecoRules(xr.subgroups);

    // WECO 规则报警
    if (alerts.length > 0) {
      const alertDesc = alerts.map(a => a.desc).join("; ");
      logger.info("[spcMonitor] ALERT:", node.operation_name, param, alertDesc);
      
      // 检查这个组合在最近 5 分钟内是否已经报过
      const recentAlert = db.prepare(
        "SELECT id FROM spc_alerts WHERE process_node_id = ? AND param = ? AND created_at > datetime('now', '-5 minutes')"
      ).get(node.id, param);
      
      if (!recentAlert) {
        db.prepare(
          "INSERT INTO spc_alerts (process_node_id, param, rule_desc, cpk, node_name) VALUES (?, ?, ?, ?, ?)"
        ).run(node.id, param, alertDesc, cap.cpk || null, node.operation_name || "未知工序");
        
        emit(Events.SPC_ALERT, {
          process_node_id: node.id,
          node_name: node.operation_name,
          param: param,
          param_label: PARAM_LABELS[param] || param,
          rule_desc: alertDesc,
          cpk: cap.cpk,
          instance_id: node.equipment_instance_id,
        });
      }
    }

    // Cpk < 1.0 预警
    if (cap.cpk !== null && cap.cpk !== undefined && cap.cpk < 1.0) {
      results.push({
        node_id: node.id,
        node_name: node.operation_name,
        param,
        param_label: PARAM_LABELS[param] || param,
        cpk: Math.round(cap.cpk * 100) / 100,
        status: cap.cpk < 0.67 ? "critical" : "warning",
      });
    }
  }
  
  return results;
}

function runMonitor(db) {
  // 获取最近 2 小时内有数据更新的 process_nodes
  const nodes = db.prepare(
    `SELECT DISTINCT pn.id, pn.operation_name, pn.equipment_instance_id
     FROM process_nodes pn
     JOIN process_params pp ON pp.process_node_id = pn.id
     WHERE pp.recorded_at > datetime('now', '-2 hours')
     LIMIT 50`
  ).all();

  if (nodes.length === 0) return;

  let totalCpkWarnings = 0;
  for (const node of nodes) {
    try {
      const warnings = analyzeNode(db, node);
      totalCpkWarnings += warnings.length;
    } catch (e) {
      logger.warn('[spcMonitor] 节点分析失败:', node.id, e.message);
    }
  }

  if (totalCpkWarnings > 0) {
    emit(Events.SPC_DASHBOARD, { cpk_warnings: totalCpkWarnings, nodes_checked: nodes.length });
  }
}

function start(db, intervalMs) {
  if (monitorInterval) stop();
  
  // Ensure spc_alerts table
  db.exec(`CREATE TABLE IF NOT EXISTS spc_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    process_node_id INTEGER,
    param TEXT,
    rule_desc TEXT,
    cpk REAL,
    node_name TEXT,
    acknowledged INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  
  logger.info("[spcMonitor] Starting SPC monitor every " + (intervalMs || 30000) + "ms");
  monitorInterval = setInterval(() => runMonitor(db), intervalMs || 30000);
}

function stop() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    logger.info("[spcMonitor] Stopped");
  }
}

module.exports = { start, stop, runMonitor };
