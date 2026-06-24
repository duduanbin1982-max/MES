"use strict";
// services/process/node/nodeParams.js
// 工艺参数管理 (2 个端点)
//   GET  /api/process_nodes/:id/params
//   POST /api/process_nodes/:id/params
// 注: 实际参数存储在 process_params 表 (与 process_node 多对一)
// Author: 三狗子 | Date: 2026-06-24

const { all, get, run, wrap } = require("./_helpers");

function register(app, db) {
app.get('/api/process_nodes/:id/params', wrap((req, res) => {
  res.json(all( db, 'SELECT pp.*, u.full_name as recorder_name FROM process_params pp LEFT JOIN users u ON pp.recorded_by = u.id WHERE process_node_id = ? ORDER BY recorded_at DESC', req.params.id));
}));

app.post('/api/process_nodes/:id/params', wrap((req, res) => {
  const { current_amp, voltage_v, speed_mm_min, temperature_c, pressure_mpa, feed_rate, custom_json, notes, recorded_by } = req.body;
  const r = run( db, "INSERT INTO process_params (process_node_id, current_amp, voltage_v, speed_mm_min, temperature_c, pressure_mpa, feed_rate, custom_json, notes, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [req.params.id, current_amp||null, voltage_v||null, speed_mm_min||null, temperature_c||null, pressure_mpa||null, feed_rate||null, custom_json||null, notes||null, recorded_by||null]);
  res.json({ id: r.lastInsertRowid });
}));

}

module.exports = { register };
