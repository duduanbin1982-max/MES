// services/materialService.js
// P0-#1 拆 server.js: 物料/批次/库存/关键件/移动 (P2-#1 库存预警 + 物料追溯)
// Author: 三狗子 | Date: 2026-06-23

function register(app, db) {
  const all = (sql, params = []) => db.prepare(sql).all(params);
  const get = (sql, params = []) => db.prepare(sql).get(params);
  const run = (sql, params = []) => db.prepare(sql).run(params);
  const wrap = (handler) => (req, res) => {
    try { handler(req, res); }
    catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
  };

app.get('/api/material_lots', wrap((req, res) => {
  const { material_id } = req.query;
  let sql = "SELECT ml.*, m.material_name FROM material_lots ml JOIN materials m ON ml.material_id = m.id";
  const params = [];
  if (material_id) { sql += ' WHERE ml.material_id = ?'; params.push(material_id); }
  sql += ' ORDER BY ml.received_date DESC';
  res.json(all(sql, params));
}));

app.get('/api/inventory', wrap((req, res) => res.json(all("SELECT i.*, ml.lot_no, m.material_name FROM inventory i JOIN material_lots ml ON i.material_lot_id = ml.id JOIN materials m ON ml.material_id = m.id ORDER BY m.material_code"))));

// P2-#1 低库存预警 (聚合所有 lot 的 quantity，对比 materials.safety_stock)
app.get('/api/inventory/alerts', wrap((req, res) => {
  const rows = all(`SELECT m.id, m.material_code, m.material_name, m.spec, m.unit,
                           m.safety_stock, m.reorder_point,
                           COALESCE(SUM(CASE WHEN i.status='available' THEN i.quantity ELSE 0 END), 0) as available_qty,
                           COUNT(i.id) as lot_count
                    FROM materials m
                    LEFT JOIN material_lots ml ON ml.material_id = m.id
                    LEFT JOIN inventory i ON i.material_lot_id = ml.id
                    GROUP BY m.id
                    HAVING available_qty < m.safety_stock
                    ORDER BY (m.safety_stock - available_qty) DESC`);
  res.json({ count: rows.length, items: rows });
}));

// P2-#1 批次追溯：返回某 lot 的所有 movement 轨迹
app.get('/api/inventory/lot_trace', wrap((req, res) => {
  const { lot_id } = req.query;
  if (!lot_id) return res.status(400).json({ error: 'lot_id 必填' });
  const lot = get('SELECT ml.*, m.material_code, m.material_name FROM material_lots ml JOIN materials m ON ml.material_id = m.id WHERE ml.id = ?', lot_id);
  if (!lot) return res.status(404).json({ error: 'lot 不存在' });
  const movements = all('SELECT * FROM material_movements WHERE material_lot_id = ? ORDER BY created_at', lot_id);
  const inventory = all('SELECT * FROM inventory WHERE material_lot_id = ?', lot_id);
  res.json({ lot, movements, inventory });
}));

// ============================================================
// 物料 / 关键外购件
// ============================================================
app.get('/api/materials', wrap((req, res) => {
  const { is_key_component, is_self_made } = req.query;
  let sql = 'SELECT * FROM materials WHERE 1=1';
  if (is_key_component) sql += ' AND is_key_component = 1';
  if (is_self_made) sql += ' AND is_self_made = 1';
  sql += ' ORDER BY material_code';
  res.json(all(sql));
}));
app.get('/api/key_components', wrap((req, res) => res.json(all("SELECT kc.*, m.material_name FROM key_components kc JOIN materials m ON kc.material_id = m.id ORDER BY kc.lead_time_weeks DESC"))));
app.get('/api/key_components/long_leadtime', wrap((req, res) => res.json(all("SELECT kc.*, m.material_name FROM key_components kc JOIN materials m ON kc.material_id = m.id WHERE kc.lead_time_weeks >= 12 ORDER BY kc.lead_time_weeks DESC"))));

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
