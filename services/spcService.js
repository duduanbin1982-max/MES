"use strict";
const { wrap } = require('../middleware/asyncHandler');
// services/spcService.js
// SPC Statistical Process Control API
//   Xbar-R / P-Chart / Cpk / Pareto
// Author: 三狗子 | Date: 2026-06-26

const { xbarR, capability, wecoRules } = require("../app/spc/engine");
const { ApiError } = require("../app/errors");

const PARAM_COLS = ["current_amp", "voltage_v", "speed_mm_min", "temperature_c", "pressure_mpa", "feed_rate"];
const PARAM_LABELS = {
  current_amp: "电流 (A)", voltage_v: "电压 (V)", speed_mm_min: "速度 (mm/min)",
  temperature_c: "温度 (°C)", pressure_mpa: "压力 (MPa)", feed_rate: "进给率",
};

function register(app, db) {
  const all = (sql, p = []) => db.prepare(sql).all(p);
  const get = (sql, p = []) => db.prepare(sql).get(p);
  const run = (sql, p = []) => db.prepare(sql).run(p);

  function getParamData(nodeId, param, limit) {
    if (!PARAM_COLS.includes(param)) throw Object.assign(new Error("无效参数: " + param), { status: 400 });
    const rows = all(
      `SELECT ${param} AS value, recorded_at
       FROM process_params
       WHERE process_node_id = ? AND ${param} IS NOT NULL
       ORDER BY recorded_at
       LIMIT ?`,
      [nodeId, limit || 200]
    );
    return rows.map((r) => r.value);
  }

  function getSpecLimits(nodeId, param) {
    const row = get(
      "SELECT custom_json FROM process_params WHERE process_node_id = ? AND custom_json IS NOT NULL ORDER BY id DESC LIMIT 1",
      nodeId
    );
    if (!row) return { usl: null, lsl: null };
    try {
      const j = JSON.parse(row.custom_json);
      if (j.spc && j.spc[param]) return j.spc[param];
    } catch (_e) {}
    return { usl: null, lsl: null };
  }

  // ====== Full SPC analysis ======
  app.get("/api/spc/analyze", wrap((req, res) => {
    const { process_node_id, param, subgroup_size } = req.query;
    if (!process_node_id || !param) throw ApiError.validation("process_node_id/param required")

    const nodeId = Number(process_node_id);
    const node = get("SELECT * FROM process_nodes WHERE id = ?", nodeId);
    if (!node) throw ApiError.notFound("Process node not found")

    const values = getParamData(nodeId, param, 200);
    if (values.length < 5) return res.json({ error: "Insufficient data (need >= 5 measurements)", count: values.length });

    const ss = parseInt(subgroup_size) || 5;
    const { usl, lsl } = getSpecLimits(nodeId, param);
    const xr = xbarR(values, ss, usl, lsl);
    if (xr.error) return res.json({ error: xr.error, count: values.length });

    const cap = capability(values, usl, lsl);
    const alerts = wecoRules(xr.subgroups);

    res.json({
      process_node: { id: node.id, operation_name: node.operation_name, equipment_instance_id: node.equipment_instance_id },
      parameter: { code: param, label: PARAM_LABELS[param] || param },
      data_count: values.length,
      subgroup_size: xr.n,
      subgroup_count: xr.count,
      specs: { usl, lsl },
      xbar: xr.xbar,
      r_chart: xr.r,
      capability: cap,
      weco_alerts: alerts,
      weco_alert_count: alerts.length,
      subgroups: xr.subgroups.map((g, i) => ({
        index: i + 1,
        size: g.values.length,
        values: g.values,
        mean: g.mean,
        range: g.range,
        outOfControl: alerts.some((a) => Math.abs(a.point - i) <= 0),
      })),
    });
  }));
  // ====== MESA #7: SPC Alerts (from spcMonitor) ======
  app.get("/api/spc/alerts", wrap((req, res) => {
    const { acknowledged, limit } = req.query;
    let sql = "SELECT * FROM spc_alerts WHERE 1=1";
    const p = [];
    if (acknowledged !== undefined) { sql += " AND acknowledged = ?"; p.push(acknowledged); }
    sql += " ORDER BY created_at DESC LIMIT ?";
    p.push(limit || 100);
    res.json(all(sql, p));
  }));

  app.put("/api/spc/alerts/:id/ack", wrap((req, res) => {
    run("UPDATE spc_alerts SET acknowledged = 1 WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  }));

  // SPC 综合仪表板
  app.get("/api/spc/dashboard", wrap((req, res) => {
    const totalAlerts = get("SELECT COUNT(*) as c FROM spc_alerts")?.c || 0;
    const unackAlerts = get("SELECT COUNT(*) as c FROM spc_alerts WHERE acknowledged = 0")?.c || 0;
    const recentAlerts = all("SELECT * FROM spc_alerts ORDER BY created_at DESC LIMIT 5");
    const nodeCount = get("SELECT COUNT(DISTINCT process_node_id) as c FROM process_params WHERE recorded_at > datetime('now', '-24 hours')")?.c || 0;
    res.json({
      total_alerts: totalAlerts,
      unacknowledged: unackAlerts,
      recent_alerts: recentAlerts,
      monitored_nodes_24h: nodeCount,
    });
  }));

}

module.exports = { register };
