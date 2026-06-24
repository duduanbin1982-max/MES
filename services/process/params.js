// services/processParams.js

'use strict';

function register(app, db) {
  const wrap = h => (req, res) => { try { h(req, res); } catch (e) { res.status(500).json({ error: e.message }); } };
  const all = (sql, p) => db.prepare(sql).all(p);
  const run = (sql, p) => db.prepare(sql).run(p);

  app.get('/api/process_nodes/:id/params', wrap((req, res) => {
    res.json(all("SELECT pp.*, u.full_name as recorder_name FROM process_params pp LEFT JOIN users u ON pp.recorded_by = u.id WHERE process_node_id = ? ORDER BY recorded_at DESC", req.params.id));
  }));

  app.post('/api/process_nodes/:id/params', wrap((req, res) => {
    const b = req.body || {};
    const r = run("INSERT INTO process_params (process_node_id, current_amp, voltage_v, speed_mm_min, temperature_c, pressure_mpa, feed_rate, custom_json, notes, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [req.params.id, b.current_amp, b.voltage_v, b.speed_mm_min, b.temperature_c, b.pressure_mpa, b.feed_rate, b.custom_json, b.notes, b.recorded_by]);
    res.json({ id: r.lastInsertRowid });
  }));
}

module.exports = { register };
