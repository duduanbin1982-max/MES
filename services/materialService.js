// services/materialService.js
// P0-#1 拆 server.js: 物料/批次/库存/关键件/移动 (P2-#1 库存预警 + 物料追溯)
// P0-#2 修 inventory 账面 bug: movement 事务同步 inventory.quantity
//   receive: quantity += |qty| (upsert)
//   issue:   quantity -= |qty| (校验 available)
//   transfer: from 扣 -> to 增
//   adjust:  quantity = |qty| (盘点)
// Author: 三狗子 | Date: 2026-06-23

function register(app, db) {
  const all = (sql, params = []) => db.prepare(sql).all(params);
  const get = (sql, params = []) => db.prepare(sql).get(params);
  const run = (sql, params = []) => db.prepare(sql).run(params);
  const wrap = (handler) => (req, res) => {
    try { handler(req, res); }
    catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
  };

  // ============================================================
  // 物料批次
  // ============================================================
  app.get('/api/material_lots', wrap((req, res) => {
    const { material_id } = req.query;
    let sql = "SELECT ml.*, m.material_name FROM material_lots ml JOIN materials m ON ml.material_id = m.id";
    const params = [];
    if (material_id) { sql += ' WHERE ml.material_id = ?'; params.push(material_id); }
    sql += ' ORDER BY ml.received_date DESC';
    res.json(all(sql, params));
  }));

  // ============================================================
  // 库存
  // ============================================================
    // P0-#3 一键入库: 建 lot + 初始 inventory + 写 receive movement, 事务内
  //   后续 P1-#4 采购模块做好后, 收货可带 PO 单号 + 自动写 key_component_prices
  app.post('/api/material_lots/receive', wrap((req, res) => {
    const { material_id, lot_no, supplier, heat_no, certificate_no, quantity, unit, location, notes } = req.body;
    if (!material_id || !lot_no || !quantity) return res.status(400).json({ error: 'material_id/lot_no/quantity 必填' });

    const mat = get('SELECT id, unit FROM materials WHERE id = ?', material_id);
    if (!mat) return res.status(404).json({ error: '物料不存在' });

    const dup = get('SELECT id FROM material_lots WHERE lot_no = ?', lot_no);
    if (dup) return res.status(400).json({ error: 'lot_no 已存在: ' + lot_no });

    const loc = location || '主仓库-A-01';
    const u = unit || mat.unit || 'pcs';

    const tx = db.transaction(() => {
      const r = run(
        "INSERT INTO material_lots (material_id, lot_no, supplier, heat_no, certificate_no, received_date, quantity, unit, quality_status, notes) VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?, 'pending', ?)",
        [material_id, lot_no, supplier || null, heat_no || null, certificate_no || null, quantity, u, notes || null]
      );
      const lotId = r.lastInsertRowid;
      run("INSERT INTO inventory (material_lot_id, location, quantity, unit, status) VALUES (?, ?, ?, ?, 'available')", [lotId, loc, quantity, u]);
      run(
        "INSERT INTO material_movements (material_lot_id, movement_type, quantity, unit, to_location, notes) VALUES (?, 'receive', ?, ?, ?, ?)",
        [lotId, quantity, u, loc, '一键入库: ' + (notes || '')]
      );
      return { id: lotId };
    });

    try {
      const result = tx();
      res.json(result);
    } catch (e) {
      const status = e.status || 500;
      res.status(status).json({ error: e.message });
    }
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

  // P2-#1 批次追溯
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

  // ============================================================
  // 物料移动 + 库存账面同步 (P0-#2 修)
  // ============================================================
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

  // P0-#2 事务化: movement + inventory.quantity 同步
  app.post('/api/material_movements', wrap((req, res) => {
    const { material_lot_id, movement_type, quantity, unit, from_location, to_location, work_order_id, project_id, operator_id, notes } = req.body;
    if (!material_lot_id || !movement_type || quantity === undefined) return res.status(400).json({ error: 'material_lot_id/movement_type/quantity 必填' });
    if (!['receive', 'issue', 'return', 'transfer', 'adjust'].includes(movement_type)) return res.status(400).json({ error: 'movement_type 非法' });

    const lot = get('SELECT id, material_id FROM material_lots WHERE id = ?', material_lot_id);
    if (!lot) return res.status(404).json({ error: 'lot 不存在' });

    const defaultLocation = '主仓库-A-01';
    const tx = db.transaction(() => {
      // 1) 写 movement 行 (quantity 取绝对值, 让 receive/issue 物理一致)
      const absQty = Math.abs(Number(quantity));
      const r = run(
        "INSERT INTO material_movements (material_lot_id, movement_type, quantity, unit, from_location, to_location, work_order_id, project_id, operator_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [material_lot_id, movement_type, absQty, unit || null, from_location || null, to_location || null, work_order_id || null, project_id || null, operator_id || null, notes || null]
      );
      const movementId = r.lastInsertRowid;

      // 2) 同步 inventory.quantity
      if (movement_type === 'receive') {
        const loc = to_location || defaultLocation;
        const existing = get('SELECT id, quantity FROM inventory WHERE material_lot_id = ? AND location = ?', [material_lot_id, loc]);
        if (existing) {
          run('UPDATE inventory SET quantity = quantity + ?, status = ?, last_updated = datetime(\'now\') WHERE id = ?', [absQty, 'available', existing.id]);
        } else {
          run("INSERT INTO inventory (material_lot_id, location, quantity, unit, status) VALUES (?, ?, ?, ?, 'available')", [material_lot_id, loc, absQty, unit || null]);
        }
      } else if (movement_type === 'issue') {
        const loc = from_location || defaultLocation;
        const inv = get('SELECT id, quantity FROM inventory WHERE material_lot_id = ? AND location = ?', [material_lot_id, loc]);
        if (!inv) { const e = new Error('lot ' + material_lot_id + ' @ ' + loc + ' 无库存, 不能出库'); e.status = 400; throw e; }
        if (inv.quantity < absQty) { const e = new Error('库存不足: 现有 ' + inv.quantity + ', 要出 ' + absQty); e.status = 400; throw e; }
        run('UPDATE inventory SET quantity = quantity - ?, last_updated = datetime(\'now\') WHERE id = ?', [absQty, inv.id]);
      } else if (movement_type === 'transfer') {
        if (!from_location || !to_location) { const e = new Error('transfer 必须带 from_location + to_location'); e.status = 400; throw e; }
        const from = get('SELECT id, quantity FROM inventory WHERE material_lot_id = ? AND location = ?', [material_lot_id, from_location]);
        if (!from || from.quantity < absQty) { const e = new Error('源库位库存不足'); e.status = 400; throw e; }
        run('UPDATE inventory SET quantity = quantity - ?, last_updated = datetime(\'now\') WHERE id = ?', [absQty, from.id]);
        const to = get('SELECT id, quantity FROM inventory WHERE material_lot_id = ? AND location = ?', [material_lot_id, to_location]);
        if (to) {
          run('UPDATE inventory SET quantity = quantity + ?, last_updated = datetime(\'now\') WHERE id = ?', [absQty, to.id]);
        } else {
          run("INSERT INTO inventory (material_lot_id, location, quantity, unit, status) VALUES (?, ?, ?, ?, 'available')", [material_lot_id, to_location, absQty, unit || null]);
        }
      } else if (movement_type === 'adjust') {
        const loc = to_location || from_location || defaultLocation;
        const existing = get('SELECT id FROM inventory WHERE material_lot_id = ? AND location = ?', [material_lot_id, loc]);
        if (existing) {
          run('UPDATE inventory SET quantity = ?, status = ?, last_updated = datetime(\'now\') WHERE id = ?', [absQty, 'available', existing.id]);
        } else {
          run("INSERT INTO inventory (material_lot_id, location, quantity, unit, status) VALUES (?, ?, ?, ?, 'available')", [material_lot_id, loc, absQty, unit || null]);
        }
      } else if (movement_type === 'return') {
        // return 走 from -> to 同样, 等同 transfer 但语义是退料
        const loc = to_location || defaultLocation;
        const existing = get('SELECT id, quantity FROM inventory WHERE material_lot_id = ? AND location = ?', [material_lot_id, loc]);
        if (existing) {
          run('UPDATE inventory SET quantity = quantity + ?, status = ?, last_updated = datetime(\'now\') WHERE id = ?', [absQty, 'available', existing.id]);
        } else {
          run("INSERT INTO inventory (material_lot_id, location, quantity, unit, status) VALUES (?, ?, ?, ?, 'available')", [material_lot_id, loc, absQty, unit || null]);
        }
      }

      return { id: movementId };
    });

    try {
      const result = tx();
      res.json(result);
    } catch (e) {
      const status = e.status || 500;
      res.status(status).json({ error: e.message });
    }
  }));
  // P1-#5 库存预留 (work_order 锁定一批 lot)
  //   业务: 调度器预测"实际可用库存"时, allocated 也算 available 但要锁定
  //   schema: inventory.status 已有 allocated 字段, 但此前无端点用
  app.post('/api/inventory/allocate', wrap((req, res) => {
    const { material_lot_id, work_order_id, quantity } = req.body;
    if (!material_lot_id || !work_order_id || !quantity) return res.status(400).json({ error: 'material_lot_id/work_order_id/quantity 必填' });
    const q = Number(quantity);
    if (q <= 0) return res.status(400).json({ error: 'quantity 必须 > 0' });

    const tx = db.transaction(() => {
      const inv = get("SELECT id, quantity, status, location FROM inventory WHERE material_lot_id = ? AND status = 'available'", material_lot_id);
      if (!inv) { const e = new Error('lot ' + material_lot_id + ' 无 available 库存'); e.status = 400; throw e; }
      if (inv.quantity < q) { const e = new Error('available 不足: 现有 ' + inv.quantity + ', 要预留 ' + q); e.status = 400; throw e; }

      // 拆成两行: available 减, allocated 加 (同 lot 同 location)
      run("UPDATE inventory SET quantity = quantity - ?, last_updated = datetime('now') WHERE id = ?", [q, inv.id]);
      const existingAlloc = get("SELECT id, quantity FROM inventory WHERE material_lot_id = ? AND location = ? AND status = 'allocated'", [material_lot_id, inv.location]);
      if (existingAlloc) {
        run("UPDATE inventory SET quantity = quantity + ?, last_updated = datetime('now') WHERE id = ?", [q, existingAlloc.id]);
      } else {
        run("INSERT INTO inventory (material_lot_id, location, quantity, unit, status) SELECT material_lot_id, location, ?, unit, 'allocated' FROM inventory WHERE id = ?", [q, inv.id]);
      }
      // 记 movement (work_order 关联)
      run("INSERT INTO material_movements (material_lot_id, movement_type, quantity, unit, from_location, to_location, work_order_id, notes) SELECT material_lot_id, 'transfer', ?, unit, location, location, ?, '预留: ' || ? FROM inventory WHERE id = ?",
        [q, work_order_id, 'work_order ' + work_order_id, inv.id]);
      return { ok: true, lot_id: material_lot_id, allocated_qty: q, location: inv.location };
    });
    try {
      res.json(tx());
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  }));

  // 释放预留 (allocated -> available)
  app.post('/api/inventory/release', wrap((req, res) => {
    const { material_lot_id, work_order_id, quantity } = req.body;
    if (!material_lot_id || !work_order_id || !quantity) return res.status(400).json({ error: 'material_lot_id/work_order_id/quantity 必填' });
    const q = Number(quantity);
    if (q <= 0) return res.status(400).json({ error: 'quantity 必须 > 0' });

    const tx = db.transaction(() => {
      // 找该 work_order 的预留
      const alloc = get("SELECT id, quantity, location FROM inventory WHERE material_lot_id = ? AND status = 'allocated'", material_lot_id);
      if (!alloc) { const e = new Error('lot ' + material_lot_id + ' 无 allocated 库存'); e.status = 400; throw e; }
      if (alloc.quantity < q) { const e = new Error('allocated 不足: 现有 ' + alloc.quantity + ', 要释放 ' + q); e.status = 400; throw e; }

      run("UPDATE inventory SET quantity = quantity - ?, last_updated = datetime('now') WHERE id = ?", [q, alloc.id]);
      const existingAvail = get("SELECT id, quantity FROM inventory WHERE material_lot_id = ? AND location = ? AND status = 'available'", [material_lot_id, alloc.location]);
      if (existingAvail) {
        run("UPDATE inventory SET quantity = quantity + ?, status = 'available', last_updated = datetime('now') WHERE id = ?", [q, existingAvail.id]);
      } else {
        run("INSERT INTO inventory (material_lot_id, location, quantity, unit, status) SELECT material_lot_id, location, ?, unit, 'available' FROM inventory WHERE id = ?", [q, alloc.id]);
      }
      run("INSERT INTO material_movements (material_lot_id, movement_type, quantity, unit, from_location, to_location, work_order_id, notes) SELECT material_lot_id, 'transfer', ?, unit, location, location, ?, '释放: ' || ? FROM inventory WHERE id = ?",
        [q, work_order_id, 'work_order ' + work_order_id, alloc.id]);
      return { ok: true, lot_id: material_lot_id, released_qty: q, location: alloc.location };
    });
    try {
      res.json(tx());
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  }));

  // P2-7 工单→批次反向追溯
  app.get('/api/work_orders/:id/lots', wrap((req, res) => {
    const woId = req.params.id;
    const wo = get('SELECT id, wo_code FROM work_orders WHERE id = ?', woId);
    if (!wo) return res.status(404).json({ error: '工单不存在' });
    const rows = all(`SELECT ml.id as lot_id, ml.lot_no, m.material_code, m.material_name, m.spec,
                             mm.movement_type, mm.quantity, mm.unit, mm.from_location, mm.to_location,
                             mm.created_at, mm.notes
                      FROM material_movements mm
                      JOIN material_lots ml ON mm.material_lot_id = ml.id
                      JOIN materials m ON ml.material_id = m.id
                      WHERE mm.work_order_id = ?
                      ORDER BY mm.created_at`, woId);
    const summary = {};
    rows.forEach(r => { summary[r.lot_no] = (summary[r.lot_no] || 0) + r.quantity; });
    res.json({ work_order: wo, movements: rows, lot_summary: summary });
  }));

  // P2-8 呆滞料预警 (90 天无 movement)
  app.get('/api/inventory/stagnant', wrap((req, res) => {
    const days = parseInt(req.query.days) || 90;
    const rows = all(`SELECT ml.id as lot_id, ml.lot_no, m.material_code, m.material_name, m.spec,
                             ml.supplier, ml.received_date,
                             i.quantity, i.unit, i.location, i.status, i.last_updated,
                             (julianday('now') - julianday(COALESCE(MAX(mm.created_at), ml.received_date))) as idle_days
                      FROM material_lots ml
                      JOIN materials m ON ml.material_id = m.id
                      LEFT JOIN inventory i ON i.material_lot_id = ml.id
                      LEFT JOIN material_movements mm ON mm.material_lot_id = ml.id
                      WHERE (i.status IS NULL OR i.status IN ('available', 'allocated'))
                        AND (i.quantity IS NULL OR i.quantity > 0)
                      GROUP BY ml.id
                      HAVING idle_days >= ?
                      ORDER BY idle_days DESC`, days);
    res.json({ count: rows.length, days, items: rows });
  }));

}

module.exports = { register };
