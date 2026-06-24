// services/materialMovement.js
// Material Movement routes (P0 补 404 端点)

'use strict';

function register(app, db) {
  const wrap = h => (req, res) => { try { h(req, res); } catch (e) { res.status(500).json({ error: e.message }); } };
  const all = (sql, p) => db.prepare(sql).all(p);
  const run = (sql, p) => db.prepare(sql).run(p);

  app.get('/api/material_movements', wrap((req, res) => {
    const { material_lot_id, work_order_id, project_id, movement_type } = req.query;
    let sql = 'SELECT mm.*, ml.lot_no, m.material_name FROM material_movements mm JOIN material_lots ml ON mm.material_lot_id = ml.id JOIN materials m ON ml.material_id = m.id WHERE 1=1';
    const params = [];
    if (material_lot_id) { sql += ' AND mm.material_lot_id = ?'; params.push(material_lot_id); }
    if (work_order_id) { sql += ' AND mm.work_order_id = ?'; params.push(work_order_id); }
    if (project_id) { sql += ' AND mm.project_id = ?'; params.push(project_id); }
    if (movement_type) { sql += ' AND mm.movement_type = ?'; params.push(movement_type); }
    sql += ' ORDER BY mm.created_at DESC';
    res.json(all(sql, params));
  }));

  app.post('/api/material_movements', wrap((req, res) => {
    const { material_lot_id, movement_type, quantity, unit, from_location, to_location, work_order_id, project_id, operator_id, notes } = req.body;
    if (!material_lot_id || !movement_type || quantity === undefined) return res.status(400).json({ error: 'material_lot_id/movement_type/quantity 必填' });
    const r = run("INSERT INTO material_movements (material_lot_id, movement_type, quantity, unit, from_location, to_location, work_order_id, project_id, operator_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [material_lot_id, movement_type, quantity, unit || null, from_location || null, to_location || null, work_order_id || null, project_id || null, operator_id || null, notes || null]);
    res.json({ id: r.lastInsertRowid });
  }));
}

module.exports = { register };
