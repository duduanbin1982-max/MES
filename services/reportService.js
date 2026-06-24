// services/reportService.js
// P0-#1 拆 server.js: 里程碑/现场服务/全局看板/报表 (P2-#5)/ECO
// Author: 三狗子 | Date: 2026-06-23

function register(app, db) {
  const all = (sql, params = []) => db.prepare(sql).all(params);
  const get = (sql, params = []) => db.prepare(sql).get(params);
  const run = (sql, params = []) => db.prepare(sql).run(params);
  const wrap = (handler) => (req, res) => {
    try { handler(req, res); }
    catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
  };

app.get('/api/equipment_instances/:id/milestones', wrap((req, res) => res.json(all('SELECT * FROM instance_milestones WHERE equipment_instance_id = ? ORDER BY sequence', req.params.id))));

app.post('/api/equipment_instances/:id/milestones/auto-generate', wrap((req, res) => {
  const phases = [['S1','设计冻结',1],['S2','采购',2],['S3','自制件生产',3],['S4','部件预装',4],['S5','总装',5],['S6','厂内调试',6],['S7','拆解/包装/发运',7],['S8','现场组装',8],['S9','试掘进/验收',9],['S10','质保期',10]];
  const ins = db.prepare('INSERT INTO instance_milestones (equipment_instance_id, phase_code, phase_name, sequence, planned_start, status) VALUES (?, ?, ?, ?, ?, ?)');
  for (const [code, name, seq] of phases) ins.run(req.params.id, code, name, seq, '2026-07-01', 'pending');
  res.json({ count: phases.length });
}));

// ============================================================
// 现场服务
// ============================================================
app.get('/api/field_service', wrap((req, res) => res.json(all("SELECT fs.*, ei.instance_code, ei.instance_name FROM field_service fs LEFT JOIN equipment_instances ei ON fs.equipment_instance_id = ei.id ORDER BY fs.reported_date DESC"))));
app.post('/api/field_service', wrap((req, res) => {
  const { equipment_instance_id, service_type, title, description, priority } = req.body;
  if (!equipment_instance_id || !title) return res.status(400).json({ error: '必填' });
  const r = run("INSERT INTO field_service (equipment_instance_id, service_type, title, description, priority) VALUES (?, ?, ?, ?, ?)",
    [equipment_instance_id, service_type, title, description || null, priority || 'normal']);
  res.json({ id: r.lastInsertRowid });
}));

// ============================================================
// 全局看板
// ============================================================
app.get('/api/dashboard', wrap((req, res) => {
  res.json({
    equipment_types: get('SELECT count(*) c FROM equipment_types WHERE is_active = 1').c,
    equipment_models: get('SELECT count(*) c FROM equipment_models').c,
    instances: { total: get('SELECT count(*) c FROM equipment_instances').c, by_status: all('SELECT status, count(*) c FROM equipment_instances GROUP BY status') },
    work_orders: { total: get('SELECT count(*) c FROM work_orders').c, by_status: all('SELECT status, count(*) c FROM work_orders GROUP BY status') },
    process_nodes: { total: get('SELECT count(*) c FROM process_nodes').c, by_status: all('SELECT status, count(*) c FROM process_nodes GROUP BY status') },
    bom_total: get('SELECT count(*) c FROM instance_bom').c,
    key_components: get('SELECT count(*) c FROM key_components').c,
    long_leadtime: get('SELECT count(*) c FROM key_components WHERE lead_time_weeks >= 12').c
  });
}));


app.get('/api/reports/project_progress', wrap((req, res) => {
  const instances = all('SELECT * FROM equipment_instances ORDER BY created_at DESC');
  const report = instances.map((inst) => {
    const wo_stats = get("SELECT count(*) total, sum(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) completed FROM work_orders WHERE equipment_instance_id = ?", inst.id);
    const pn_stats = get("SELECT count(*) total, sum(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) completed, sum(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) in_progress, sum(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) blocked FROM process_nodes WHERE equipment_instance_id = ?", inst.id);
    const material_alerts = get("SELECT count(*) c FROM key_components WHERE material_id IN (SELECT DISTINCT material_id FROM instance_bom WHERE equipment_instance_id = ?)", inst.id) || { c: 0 };
    return {
      instance_code: inst.instance_code,
      instance_name: inst.instance_name,
      customer: inst.customer_name,
      status: inst.status,
      lifecycle: inst.lifecycle_stage,
      planned_start: inst.planned_start,
      planned_end: inst.planned_end,
      contract_amount: inst.contract_amount,
      work_orders: { total: wo_stats?.total || 0, completed: wo_stats?.completed || 0, progress_pct: wo_stats?.total ? Math.round(wo_stats.completed * 100 / wo_stats.total) : 0 },
      process_nodes: { total: pn_stats?.total || 0, completed: pn_stats?.completed || 0, in_progress: pn_stats?.in_progress || 0, blocked: pn_stats?.blocked || 0, progress_pct: pn_stats?.total ? Math.round(pn_stats.completed * 100 / pn_stats.total) : 0 }
    };
  });
  res.json({ count: report.length, projects: report });
}));


// ============================================================
// P2-#5 报表深化 (2026-06-22)
// ============================================================
app.get('/api/reports/equipment_status', wrap((req, res) => {
  const by_status = all("SELECT status, lifecycle_stage, count(*) as cnt FROM equipment_instances GROUP BY status, lifecycle_stage ORDER BY status, lifecycle_stage");
  const by_type = all("SELECT et.name_zh as type_name, count(*) as cnt FROM equipment_instances ei JOIN equipment_models em ON ei.equipment_model_id = em.id JOIN equipment_types et ON em.equipment_type_id = et.id GROUP BY et.name_zh ORDER BY cnt DESC");
  const totals = get("SELECT count(*) as total, sum(contract_amount) as total_amount FROM equipment_instances") || {};
  res.json({ totals, by_status_lifecycle: by_status, by_type });
}));

app.get('/api/reports/work_order_summary', wrap((req, res) => {
  const by_status = all("SELECT status, count(*) as cnt, sum(estimated_hours) as total_est_hours, sum(actual_hours) as total_actual_hours FROM work_orders GROUP BY status");
  const by_subsystem = all("SELECT es.name_zh as subsystem, count(*) as cnt, sum(CASE WHEN wo.status='completed' THEN 1 ELSE 0 END) as completed FROM work_orders wo LEFT JOIN equipment_subsystems es ON wo.subsystem_id = es.id GROUP BY es.name_zh ORDER BY cnt DESC");
  const overdue = all("SELECT wo.*, ei.instance_code FROM work_orders wo JOIN equipment_instances ei ON wo.equipment_instance_id = ei.id WHERE wo.status NOT IN ('completed','cancelled') AND wo.planned_end < date('now') ORDER BY wo.planned_end LIMIT 20");
  res.json({ by_status, by_subsystem, overdue_count: overdue.length, overdue });
}));

app.get('/api/reports/key_components_arrival', wrap((req, res) => {
  const items = all("SELECT kc.*, m.material_name, m.spec, m.default_supplier FROM key_components kc JOIN materials m ON kc.material_id = m.id ORDER BY kc.lead_time_weeks DESC");
  const summary = {
    total: items.length,
    high_risk: items.filter(i => i.lead_time_weeks >= 16).length,
    medium_risk: items.filter(i => i.lead_time_weeks >= 12 && i.lead_time_weeks < 16).length,
    total_lead_weeks: items.reduce((sum, i) => sum + (i.lead_time_weeks || 0), 0)
  };
  res.json({ summary, items });
}));



app.get('/api/equipment_instances/:id/eco', wrap((req, res) => {
  res.json(all('SELECT * FROM instance_eco WHERE equipment_instance_id = ? ORDER BY id DESC', req.params.id));
}));

app.post('/api/equipment_instances/:id/eco', wrap((req, res) => {
  const { eco_no, title, reason, affected_scope, effective_date, created_by } = req.body;
  if (!eco_no || !title) return res.status(400).json({ error: 'eco_no/title 必填' });
  const r = run("INSERT INTO instance_eco (equipment_instance_id, eco_no, title, reason, affected_scope, effective_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [req.params.id, eco_no, title, reason || null, affected_scope || null, effective_date || null, created_by || null]);
  res.json({ id: r.lastInsertRowid });
}));

app.put('/api/instance_eco/:id', wrap((req, res) => {
  const { status, effective_date, closed_date, reason, affected_scope } = req.body;
  const sets = []; const params = [];
  if (status !== undefined) { sets.push('status = ?'); params.push(status); }
  if (effective_date !== undefined) { sets.push('effective_date = ?'); params.push(effective_date); }
  if (closed_date !== undefined) { sets.push('closed_date = ?'); params.push(closed_date); }
  if (reason !== undefined) { sets.push('reason = ?'); params.push(reason); }
  if (affected_scope !== undefined) { sets.push('affected_scope = ?'); params.push(affected_scope); }
  if (!sets.length) return res.status(400).json({ error: '无可更新字段' });
  sets.push("updated_at = datetime('now')");
  params.push(req.params.id);
  const r = run(`UPDATE instance_eco SET ${sets.join(', ')} WHERE id = ?`, params);
  res.json({ changes: r.changes });
}));
}

module.exports = { register };
