"use strict";
// services/process/params.js
// MESA #8: Process parameter management + trend + monitoring dashboard
const { ApiError } = require("../../app/errors");

function register(app, db) {
  const { wrap } = require("../../middleware/asyncHandler");
  const all = (sql, p) => db.prepare(sql).all(p || []);
  const get = (sql, p) => db.prepare(sql).get(p || []);
  const run = (sql, p) => db.prepare(sql).run(p || []);

  // CRUD: get params for a node
  app.get("/api/process_nodes/:id/params", wrap((req, res) => {
    res.json(all("SELECT pp.*, u.full_name as recorder_name FROM process_params pp LEFT JOIN users u ON pp.recorded_by = u.id WHERE process_node_id = ? ORDER BY recorded_at DESC LIMIT 500", [req.params.id]));
  }));

  // CRUD: add param reading
  app.post("/api/process_nodes/:id/params", wrap((req, res) => {
    const b = req.body || {};
    const r = run("INSERT INTO process_params (process_node_id, current_amp, voltage_v, speed_mm_min, temperature_c, pressure_mpa, feed_rate, custom_json, notes, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [req.params.id, b.current_amp, b.voltage_v, b.speed_mm_min, b.temperature_c, b.pressure_mpa, b.feed_rate, b.custom_json, b.notes, b.recorded_by]);
    res.json({ id: r.lastInsertRowid });
  }));

  // MESA #8: 过程参数趋势 (时间序列)
  app.get("/api/process_nodes/:id/params/trend", wrap((req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    const param = req.query.param;
    const rows = all("SELECT pp.*, u.full_name as recorder_name FROM process_params pp LEFT JOIN users u ON pp.recorded_by = u.id WHERE process_node_id = ? ORDER BY recorded_at ASC LIMIT ?", [req.params.id, limit]);
    if (param) {
      const times = [], values = [];
      for (const r of rows) {
        if (r[param] != null) {
          times.push(r.recorded_at);
          values.push(r[param]);
        }
      }
      return res.json({ param, times, values, count: values.length });
    }
    res.json(rows);
  }));

  // MESA #8: 过程参数规格设置
  app.put("/api/process_nodes/:id/params/specs", wrap((req, res) => {
    const { specs } = req.body;
    if (!specs) throw ApiError.validation("specs object required");
    const node = get("SELECT id FROM process_nodes WHERE id = ?", [req.params.id]);
    if (!node) throw ApiError.notFound("Process node not found");
    run("INSERT INTO process_params (process_node_id, recorded_by, custom_json) VALUES (?, 1, ?)", [req.params.id, JSON.stringify({ spc: specs })]);
    res.json({ success: true });
  }));

  // MESA #8: 过程监控仪表板
  app.get("/api/process/monitor", wrap((req, res) => {
    const { equipment_instance_id } = req.query;
    let nodeSql = "SELECT pn.id, pn.operation_name AS name, pn.node_type, pn.status, pn.equipment_instance_id, ei.instance_code FROM process_nodes pn LEFT JOIN equipment_instances ei ON pn.equipment_instance_id = ei.id WHERE pn.status IN ('in_progress','pending')";
    const p = [];
    if (equipment_instance_id) { nodeSql += " AND pn.equipment_instance_id = ?"; p.push(equipment_instance_id); }
    nodeSql += " ORDER BY pn.id LIMIT 100";
    const nodes = all(nodeSql, p);

    const result = [];
    for (const node of nodes) {
      const lastParam = db.prepare("SELECT * FROM process_params WHERE process_node_id = ? ORDER BY recorded_at DESC LIMIT 1").get(node.id);
      const paramCount = (db.prepare("SELECT COUNT(*) as c FROM process_params WHERE process_node_id = ?").get(node.id) || {}).c || 0;
      const spcAlert = (db.prepare("SELECT COUNT(*) as c FROM spc_alerts WHERE process_node_id = ? AND acknowledged = 0").get(node.id) || {}).c || 0;

      result.push({
        id: node.id, name: node.name, node_type: node.node_type, status: node.status,
        instance_code: node.instance_code,
        last_params: lastParam ? {
          current_amp: lastParam.current_amp, voltage_v: lastParam.voltage_v,
          speed_mm_min: lastParam.speed_mm_min, temperature_c: lastParam.temperature_c,
          pressure_mpa: lastParam.pressure_mpa, feed_rate: lastParam.feed_rate,
          recorded_at: lastParam.recorded_at,
        } : null,
        param_count: paramCount, spc_alerts: spcAlert,
      });
    }
    res.json({ nodes: result, total: result.length });
  }));

  // MESA #8: 参数偏差报警查询
  app.get("/api/process/deviations", wrap((req, res) => {
    const { limit } = req.query;
    const nodes = all("SELECT id FROM process_nodes LIMIT 200");
    const deviations = [];
    for (const node of nodes) {
      const spec = get("SELECT custom_json FROM process_params WHERE process_node_id = ? AND custom_json IS NOT NULL ORDER BY id DESC LIMIT 1", [node.id]);
      if (!spec) continue;
      let spcSpec = {};
      try {
        spcSpec = JSON.parse(spec.custom_json).spc || {};
      } catch (_error) {
        spcSpec = {};
      }
      if (Object.keys(spcSpec).length === 0) continue;

      const lastParam = db.prepare("SELECT * FROM process_params WHERE process_node_id = ? ORDER BY recorded_at DESC LIMIT 1").get(node.id);
      if (!lastParam) continue;

      for (const [param, limits] of Object.entries(spcSpec)) {
        const val = lastParam[param];
        if (val != null && (val < limits.lsl || val > limits.usl)) {
          const nodeInfo = get("SELECT operation_name FROM process_nodes WHERE id = ?", [node.id]);
          deviations.push({
            node_id: node.id, node_name: nodeInfo?.operation_name || "?",
            param, value: val, lsl: limits.lsl, usl: limits.usl,
            deviation: val < limits.lsl ? "low" : "high",
            amount: val < limits.lsl ? (limits.lsl - val) : (val - limits.usl),
            recorded_at: lastParam.recorded_at,
          });
        }
      }
    }
    deviations.sort((a, b) => b.amount - a.amount);
    res.json({ total: deviations.length, items: deviations.slice(0, limit || 50) });
  }));

  console.log("[process/params] Process params + monitor registered");
}

module.exports = { register };
