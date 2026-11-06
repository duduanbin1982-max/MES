"use strict";
const { wrap } = require('../middleware/asyncHandler');
// services/spcService.js
// SPC Statistical Process Control API
//   Xbar-R / P-Chart / Cpk / Pareto
// Author: 三狗子 | Date: 2026-06-26
// 2026-11-07 审计修复: 入参校验 / 补全 xbar-r+cpk+pareto 端点 / ack 404+审计

const { xbarR, capability, wecoRules, A2, D2, D3, D4 } = require("../app/spc/engine");
const { ApiError } = require("../app/errors");
const audit = require("../app/audit");

const PARAM_COLS = ["current_amp", "voltage_v", "speed_mm_min", "temperature_c", "pressure_mpa", "feed_rate"];
const PARAM_LABELS = {
  current_amp: "电流 (A)", voltage_v: "电压 (V)", speed_mm_min: "速度 (mm/min)",
  temperature_c: "温度 (°C)", pressure_mpa: "压力 (MPa)", feed_rate: "进给率",
};

const MAX_MEASUREMENTS = 2000;
const MAX_SUBGROUPS = 200;
const MAX_LIMIT = 500;

function r3(value) { return Math.round(value * 1000) / 1000; }

function toFiniteNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseLimit(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > MAX_LIMIT) {
    throw ApiError.validation("limit 必须是 1.." + MAX_LIMIT + " 的整数");
  }
  return number;
}

function parseAcknowledged(value) {
  if (value === undefined || value === "") return null;
  const text = String(value).trim().toLowerCase();
  if (["0", "false", "no", "未确认"].includes(text)) return 0;
  if (["1", "true", "yes", "已确认"].includes(text)) return 1;
  throw ApiError.validation("acknowledged 只接受 0/1/true/false");
}

function parsePositiveInt(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw ApiError.validation(field + " 必须是正整数");
  return number;
}

function parseDays(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 3650) {
    throw ApiError.validation("days 必须是 1..3650 的整数");
  }
  return number;
}

function normalizeSpecs(uslRaw, lslRaw) {
  const usl = toFiniteNumber(uslRaw);
  const lsl = toFiniteNumber(lslRaw);
  if (uslRaw !== undefined && uslRaw !== null && uslRaw !== "" && usl === null) throw ApiError.validation("usl 必须是数字");
  if (lslRaw !== undefined && lslRaw !== null && lslRaw !== "" && lsl === null) throw ApiError.validation("lsl 必须是数字");
  if (usl !== null && lsl !== null && usl <= lsl) throw ApiError.validation("usl 必须大于 lsl");
  return { usl, lsl };
}

function normalizeMeasurements(raw) {
  if (!Array.isArray(raw)) throw ApiError.validation("measurements 必须是数值数组");
  if (raw.length < 2 || raw.length > MAX_MEASUREMENTS) {
    throw ApiError.validation("measurements 数量必须在 2.." + MAX_MEASUREMENTS + " 之间");
  }
  const values = raw.map(toFiniteNumber);
  if (values.some((value) => value === null)) throw ApiError.validation("measurements 中包含非数值");
  return values;
}

function normalizeSubgroups(raw) {
  if (!Array.isArray(raw)) throw ApiError.validation("subgroups 必须是子组数组");
  if (raw.length < 2 || raw.length > MAX_SUBGROUPS) {
    throw ApiError.validation("subgroups 数量必须在 2.." + MAX_SUBGROUPS + " 之间");
  }
  let total = 0;
  const groups = raw.map((item) => {
    if (!Array.isArray(item) || item.length < 2 || item.length > 50) {
      throw ApiError.validation("每个子组必须包含 2..50 个测量值");
    }
    const values = item.map(toFiniteNumber);
    if (values.some((value) => value === null)) throw ApiError.validation("子组中包含非数值");
    total += values.length;
    return values;
  });
  if (total > MAX_MEASUREMENTS) throw ApiError.validation("测量值总数超过 " + MAX_MEASUREMENTS);
  return groups;
}

function histogram(values, binCount) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (!(max > min)) return { bins: [r3(min)], counts: [values.length], bin_count: 1, bin_width: 0 };
  const width = (max - min) / binCount;
  const bins = [];
  const counts = new Array(binCount).fill(0);
  for (let index = 0; index < binCount; index += 1) bins.push(r3(min + width * index));
  for (const value of values) {
    const index = Math.min(binCount - 1, Math.max(0, Math.floor((value - min) / width)));
    counts[index] += 1;
  }
  return { bins, counts, bin_count: binCount, bin_width: r3(width) };
}

function defectCategory(notes) {
  const text = String(notes == null ? "" : notes).trim();
  if (!text) return "未注明";
  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text);
      const desc = parsed.defect_desc || parsed.defect_reason || parsed.defect_type;
      if (desc && String(desc).trim()) return String(desc).trim().slice(0, 60);
    } catch (_error) { /* 非 JSON, 按原文归类 */ }
  }
  return text.slice(0, 60);
}

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
    // 2026-11-05: filter non-numeric values to avoid NaN in control charts
    return rows.map((r) => Number(r.value)).filter((value) => Number.isFinite(value));
  }

  function getSpecLimits(nodeId, param) {
    // 2026-11-05: look back across rows (latest custom_json may not contain this param)
    const rows = all(
      "SELECT custom_json FROM process_params WHERE process_node_id = ? AND custom_json IS NOT NULL ORDER BY recorded_at DESC, id DESC LIMIT 50",
      [nodeId]
    );
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.custom_json);
        if (parsed && parsed.spc && parsed.spc[param]) return parsed.spc[param];
      } catch (_error) { /* skip bad json */ }
    }
    return { usl: null, lsl: null };
  }

  app.get("/api/spc/nodes-with-params", wrap((_req, res) => {
    const nodes = all(`
      SELECT
        pn.id,
        pn.operation_name,
        pn.equipment_instance_id,
        ei.instance_code,
        COUNT(pp.id) AS measurement_count,
        MAX(pp.recorded_at) AS latest_measurement_at
      FROM process_nodes pn
      JOIN process_params pp ON pp.process_node_id = pn.id
      LEFT JOIN equipment_instances ei ON ei.id = pn.equipment_instance_id
      WHERE pp.current_amp IS NOT NULL
         OR pp.voltage_v IS NOT NULL
         OR pp.speed_mm_min IS NOT NULL
         OR pp.temperature_c IS NOT NULL
         OR pp.pressure_mpa IS NOT NULL
         OR pp.feed_rate IS NOT NULL
      GROUP BY pn.id, pn.operation_name, pn.equipment_instance_id, ei.instance_code
      ORDER BY latest_measurement_at DESC, pn.id DESC
    `);
    res.json(nodes);
  }));

  // ====== Full SPC analysis ======
  app.get("/api/spc/analyze", wrap((req, res) => {
    const { process_node_id, param, subgroup_size } = req.query;
    if (!process_node_id || !param) throw ApiError.validation("process_node_id/param required");

    const nodeId = parsePositiveInt(process_node_id, "process_node_id");
    const node = get("SELECT * FROM process_nodes WHERE id = ?", nodeId);
    if (!node) throw ApiError.notFound("Process node not found");

    // 2026-11-07: 子组大小必须显式合法, 不再静默回退 (前端默认 5)
    let ss = 5;
    if (subgroup_size !== undefined && subgroup_size !== "") {
      ss = Number(subgroup_size);
      if (!Number.isInteger(ss) || ss < 2 || ss > 10) throw ApiError.validation("subgroup_size 必须是 2..10 的整数");
    }

    const values = getParamData(nodeId, param, 200);
    if (values.length < 5) return res.json({ error: "Insufficient data (need >= 5 measurements)", count: values.length });

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

  // ====== 手工 Xbar-R 计算 (前端 Tab2, 2026-11-07 补齐) ======
  app.post("/api/spc/xbar-r", wrap((req, res) => {
    const body = req.body || {};
    const groups = normalizeSubgroups(body.subgroups);
    const { usl, lsl } = normalizeSpecs(body.usl, body.lsl);

    const n = Math.min(groups[0].length, 10);
    const means = groups.map((values) => values.reduce((sum, value) => sum + value, 0) / values.length);
    const ranges = groups.map((values) => Math.max(...values) - Math.min(...values));
    const cl = means.reduce((sum, value) => sum + value, 0) / means.length;
    const meanRange = ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
    const ucl = cl + A2[n] * meanRange;
    const lcl = cl - A2[n] * meanRange;
    const flattened = groups.reduce((acc, values) => acc.concat(values), []);
    const alerts = wecoRules(groups.map((values, index) => ({ values, mean: means[index], range: ranges[index] })));
    const cap = capability(flattened, usl, lsl);

    res.json({
      count: groups.length,
      n,
      cl: r3(cl),
      ucl: r3(ucl),
      lcl: r3(lcl),
      grand_mean: r3(cl),
      mean_range: r3(meanRange),
      sigma: D2[n] ? r3(meanRange / D2[n]) : null,
      specs: { usl, lsl },
      xbar: { cl: r3(cl), ucl: r3(ucl), lcl: r3(lcl), usl, lsl },
      r_chart: { cl: r3(meanRange), ucl: r3(D4[n] * meanRange), lcl: r3(D3[n] * meanRange) },
      capability: cap && !cap.error ? cap : null,
      weco_alerts: alerts,
      weco_alert_count: alerts.length,
      subgroups: groups.map((values, index) => ({
        index: index + 1,
        size: values.length,
        values,
        mean: r3(means[index]),
        range: r3(ranges[index]),
        out_of_control: alerts.some((alert) => alert.point === index),
      })),
    });
  }));

  // ====== 手工 Cpk 计算 (前端 Tab3, 2026-11-07 补齐) ======
  app.post("/api/spc/cpk", wrap((req, res) => {
    const body = req.body || {};
    const values = normalizeMeasurements(body.measurements);
    const { usl, lsl } = normalizeSpecs(body.usl, body.lsl);
    if (usl === null && lsl === null) throw ApiError.validation("usl/lsl 至少提供一个");
    const cap = capability(values, usl, lsl);
    if (cap.error) throw ApiError.validation(cap.error);
    res.json(Object.assign({}, cap, { histogram: histogram(values, 10) }));
  }));

  // ====== Pareto 缺陷分析 (前端 Tab4, 2026-11-07 补齐) ======
  app.get("/api/spc/pareto", wrap((req, res) => {
    const instanceId = parsePositiveInt(req.query.equipment_instance_id, "equipment_instance_id");
    const days = parseDays(req.query.days, 30);
    const rows = all(
      "SELECT notes, result FROM qc_inspections WHERE equipment_instance_id = ? AND date(inspection_date) >= date('now', '-' || ? || ' days')",
      [instanceId, days]
    );
    const counter = new Map();
    for (const row of rows) {
      const result = String(row.result || "").trim().toLowerCase();
      if (!["fail", "failed", "ng", "不合格"].includes(result)) continue;
      const category = defectCategory(row.notes);
      counter.set(category, (counter.get(category) || 0) + 1);
    }
    const items = Array.from(counter.entries()).sort((a, b) => b[1] - a[1]);
    const total = items.reduce((sum, item) => sum + item[1], 0);
    let running = 0;
    const cumulative = items.map((item) => {
      running += item[1];
      return total ? Math.round((running / total) * 1000) / 10 : 0;
    });
    res.json({
      equipment_instance_id: instanceId,
      days,
      total,
      categories: items.map((item) => item[0]),
      counts: items.map((item) => item[1]),
      cumulative_pct: cumulative,
      source: "qc_inspections",
    });
  }));

  // ====== MESA #7: SPC Alerts (from spcMonitor) ======
  app.get("/api/spc/alerts", wrap((req, res) => {
    const acknowledged = parseAcknowledged(req.query.acknowledged);
    const limit = parseLimit(req.query.limit, 100);
    let sql = "SELECT * FROM spc_alerts WHERE 1=1";
    const p = [];
    if (acknowledged !== null) { sql += " AND acknowledged = ?"; p.push(acknowledged); }
    sql += " ORDER BY created_at DESC, id DESC LIMIT ?";
    p.push(limit);
    res.json(all(sql, p));
  }));

  app.put("/api/spc/alerts/:id/ack", wrap((req, res) => {
    const id = parsePositiveInt(req.params.id, "id");
    const before = get("SELECT id, process_node_id, param, rule_desc, acknowledged FROM spc_alerts WHERE id = ?", id);
    if (!before) throw ApiError.notFound("SPC 告警不存在");
    if (before.acknowledged) return res.json({ ok: true, id, acknowledged: 1, changed: false });
    run("UPDATE spc_alerts SET acknowledged = 1 WHERE id = ?", [id]);
    // 2026-11-07: 告警确认是质量数据变更, 必须留痕
    audit.record(db, req, {
      action: "spc.alert.ack",
      resource_type: "spc_alert",
      resource_id: id,
      before,
      after: { id, process_node_id: before.process_node_id, param: before.param, acknowledged: 1 },
      diff_summary: "SPC 告警确认: " + (before.param || "") + " @ node " + (before.process_node_id || ""),
    });
    res.json({ ok: true, id, acknowledged: 1, changed: true });
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
