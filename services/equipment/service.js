const { ApiError } = require('../../app/errors');
const { wrap } = require('../../middleware/asyncHandler');
// services/equipmentService.js
// P0-#1 拆 server.js: 整机/型号/子系统/工位/设备实时状态 (P2-#3 设备看板)
// Author: 三狗子 | Date: 2026-06-23

function register(app, db) {
  const all = (sql, params = []) => db.prepare(sql).all(params);
  const get = (sql, params = []) => db.prepare(sql).get(params);
  const run = (sql, params = []) => db.prepare(sql).run(params);

  const LIFE_CYCLE = [
    { value: 'design', label: '设计中' },
    { value: 'procurement', label: '采购中' },
    { value: 'manufacturing', label: '制造中' },
    { value: 'assembly', label: '总装中' },
    { value: 'commissioning', label: '调试中' },
    { value: 'acceptance', label: '验收中' },
    { value: 'delivered', label: '交付' },
    { value: 'operation', label: '运维' },
    { value: 'archived', label: '归档' },
  ];
  const LIFE_VALUES = new Set(LIFE_CYCLE.map(x => x.value));
  const DEFAULT_MILESTONES = [
    ['S1', '设计冻结', 10],
    ['S2', '长周期采购', 20],
    ['S3', '部件制造', 30],
    ['S4', '总装', 40],
    ['S5', '联调测试', 50],
    ['S6', '客户验收', 60],
    ['S7', '交付发运', 70],
    ['S8', '运维移交', 80],
  ];
  const DEFAULT_DOC_FOLDERS = ['合同', 'BOM', '图纸', '工艺', '质检', '验收', '运维'];

  function tableColumns(table) {
    return new Set(db.prepare('PRAGMA table_info(' + table + ')').all().map(c => c.name));
  }

  function hasTable(table) {
    return !!get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", table);
  }

  function addColumn(table, column, ddl) {
    const cols = tableColumns(table);
    if (!cols.has(column)) run('ALTER TABLE ' + table + ' ADD COLUMN ' + ddl);
  }

  function initEquipmentInstanceEnhancements() {
    addColumn('equipment_instances', 'project_no', 'project_no TEXT');
    addColumn('equipment_instances', 'archive_status', "archive_status TEXT DEFAULT 'active'");
    addColumn('equipment_instances', 'archived_at', 'archived_at TEXT');
    addColumn('equipment_instances', 'archived_by', 'archived_by INTEGER');
    addColumn('equipment_instances', 'frozen_at', 'frozen_at TEXT');
    addColumn('equipment_instances', 'frozen_by', 'frozen_by INTEGER');
    addColumn('equipment_instances', 'freeze_snapshot', 'freeze_snapshot TEXT');
    db.exec(`CREATE TABLE IF NOT EXISTS equipment_instance_lifecycle_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_instance_id INTEGER NOT NULL,
      from_stage TEXT,
      to_stage TEXT NOT NULL,
      reason TEXT,
      changed_by INTEGER,
      changed_at TEXT DEFAULT (datetime('now'))
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS equipment_instance_milestones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      phase_code TEXT NOT NULL,
      phase_name TEXT NOT NULL,
      sequence INTEGER DEFAULT 0,
      planned_start TEXT,
      planned_end TEXT,
      actual_start TEXT,
      actual_end TEXT,
      status TEXT DEFAULT 'pending',
      notes TEXT
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_equipment_instance_milestones_instance ON equipment_instance_milestones(project_id)');
    db.exec(`CREATE TABLE IF NOT EXISTS document_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_instance_id INTEGER NOT NULL,
      folder_name TEXT NOT NULL,
      folder_type TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(equipment_instance_id, folder_name)
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_document_folders_instance ON document_folders(equipment_instance_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_equipment_instances_project_no ON equipment_instances(project_no)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_equipment_instances_archive_status ON equipment_instances(archive_status)');
  }

  initEquipmentInstanceEnhancements();

  function cleanCodeToken(value) {
    return String(value || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '')
      .slice(0, 8);
  }

  function nextInstanceCode(customer, year) {
    const y = String(year || new Date().getFullYear()).replace(/\D/g, '').slice(0, 4) || String(new Date().getFullYear());
    const customerToken = cleanCodeToken(customer);
    const prefix = customerToken ? `TBM-${customerToken}-${y}` : `TBM-${y}`;
    const row = get(
      "SELECT instance_code FROM equipment_instances WHERE instance_code LIKE ? ORDER BY id DESC LIMIT 1",
      [`${prefix}-%`]
    );
    const last = row?.instance_code?.match(/-(\d{3,})$/);
    const seq = String(last ? Number(last[1]) + 1 : 1).padStart(3, '0');
    return `${prefix}-${seq}`;
  }

  function ensureNotFrozen(id) {
    const inst = get('SELECT archive_status, frozen_at FROM equipment_instances WHERE id = ?', id);
    if (!inst) throw ApiError.notFound('装备实例不存在');
    if (inst.archive_status === 'archived' || inst.frozen_at) {
      throw ApiError.validation('该装备实例已冻结/归档，禁止修改历史基线');
    }
    return inst;
  }

  function createDefaultMilestones(instanceId, plannedStart, plannedEnd) {
    const existing = get('SELECT COUNT(*) c FROM equipment_instance_milestones WHERE project_id = ?', instanceId).c;
    if (existing > 0) return;
    const stmt = db.prepare('INSERT INTO equipment_instance_milestones (project_id, phase_code, phase_name, sequence, planned_start, planned_end, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const [code, name, seq] of DEFAULT_MILESTONES) {
      stmt.run(instanceId, code, name, seq, plannedStart || null, plannedEnd || null, seq === 10 ? 'active' : 'pending', '实例创建向导自动生成');
    }
  }

  function createBomShell(instanceId, instanceCode, instanceName) {
    if (!hasTable('instance_bom')) return;
    const existing = get('SELECT COUNT(*) c FROM instance_bom WHERE equipment_instance_id = ?', instanceId).c;
    if (existing > 0) return;
    run(
      "INSERT INTO instance_bom (equipment_instance_id, parent_id, tier, version, part_number, quantity, unit, category, is_phantom, notes) VALUES (?, NULL, 0, 'A0', ?, 1, '台', '总装成品', 0, ?)",
      [instanceId, instanceCode, instanceName || '总装成品 BOM 空壳']
    );
  }

  function createDocFolders(instanceId) {
    const stmt = db.prepare('INSERT OR IGNORE INTO document_folders (equipment_instance_id, folder_name, folder_type) VALUES (?, ?, ?)');
    for (const folder of DEFAULT_DOC_FOLDERS) stmt.run(instanceId, folder, folder);
  }

  function copyMilestones(templateId, instanceId, plannedStart, plannedEnd) {
    const rows = all('SELECT * FROM equipment_instance_milestones WHERE project_id = ? ORDER BY sequence, id', templateId);
    if (rows.length === 0) return createDefaultMilestones(instanceId, plannedStart, plannedEnd);
    const stmt = db.prepare('INSERT INTO equipment_instance_milestones (project_id, phase_code, phase_name, sequence, planned_start, planned_end, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const row of rows) {
      stmt.run(instanceId, row.phase_code, row.phase_name, row.sequence, plannedStart || row.planned_start || null, plannedEnd || row.planned_end || null, row.sequence === 10 ? 'active' : 'pending', `从模板实例 #${templateId} 复制`);
    }
  }

  function copyBom(templateId, instanceId) {
    if (!hasTable('instance_bom')) return;
    const rows = all('SELECT * FROM instance_bom WHERE equipment_instance_id = ? ORDER BY tier, parent_id, id', templateId);
    if (rows.length === 0) return;
    const cols = tableColumns('instance_bom');
    const copyCols = [
      'equipment_instance_id', 'parent_id', 'tier', 'version', 'eco_id', 'effective_from', 'effective_to',
      'material_id', 'part_number', 'quantity', 'unit', 'scrap_factor', 'category', 'material_grade',
      'surface_treatment', 'brand_recommend', 'brand_grade', 'is_alternative', 'alternative_group',
      'alternative_priority', 'operation_id', 'is_phantom', 'is_key_component', 'is_wear_part',
      'storage_location', 'unit_price', 'weight', 'notes', 'created_by'
    ].filter(c => cols.has(c));
    const placeholders = copyCols.map(() => '?').join(', ');
    const stmt = db.prepare(`INSERT INTO instance_bom (${copyCols.join(', ')}) VALUES (${placeholders})`);
    const idMap = new Map();
    for (const row of rows) {
      const values = copyCols.map(col => {
        if (col === 'equipment_instance_id') return instanceId;
        if (col === 'parent_id') return row.parent_id ? (idMap.get(row.parent_id) || null) : null;
        if (col === 'notes') return row.notes || `从模板实例 #${templateId} 复制`;
        return row[col];
      });
      const result = stmt.run(values);
      idMap.set(row.id, result.lastInsertRowid);
    }
  }

  function copyProcessNodes(templateId, instanceId) {
    if (!hasTable('process_nodes')) return;
    const rows = all('SELECT * FROM process_nodes WHERE equipment_instance_id = ? ORDER BY parent_id, sequence, id', templateId);
    if (rows.length === 0) return;
    const cols = tableColumns('process_nodes');
    const copyCols = [
      'equipment_instance_id', 'parent_id', 'bom_node_id', 'operation_name', 'operation_type', 'sequence',
      'estimated_hours', 'required_workstation_id', 'required_skill', 'required_materials', 'is_milestone',
      'phase_code', 'status', 'planned_start', 'planned_end', 'planned_cost', 'auto_unblock', 'sort_order',
      'notes', 'assigned_to', 'subsystem_id'
    ].filter(c => cols.has(c));
    const placeholders = copyCols.map(() => '?').join(', ');
    const stmt = db.prepare(`INSERT INTO process_nodes (${copyCols.join(', ')}) VALUES (${placeholders})`);
    const idMap = new Map();
    for (const row of rows) {
      const values = copyCols.map(col => {
        if (col === 'equipment_instance_id') return instanceId;
        if (col === 'parent_id') return row.parent_id ? (idMap.get(row.parent_id) || null) : null;
        if (col === 'status') return 'ready';
        if (col === 'notes') return row.notes || `从模板实例 #${templateId} 复制`;
        return row[col];
      });
      const result = stmt.run(values);
      idMap.set(row.id, result.lastInsertRowid);
    }
  }

  const createInstanceTx = db.transaction((body, userId) => {
    const {
      instance_code,
      instance_name,
      equipment_model_id,
      customer_name,
      customer_contact,
      site_location,
      contract_no,
      contract_amount,
      start_date,
      planned_start,
      planned_end,
      serial_no,
      notes,
      project_no,
      template_instance_id,
      generate_milestones = true,
      create_bom_shell = true,
      create_doc_dirs = true,
      copy_template_bom = false,
      copy_template_process = false,
      copy_template_milestones = false,
    } = body;
    const code = instance_code || nextInstanceCode(customer_name, planned_start?.slice(0, 4));
    if (!code || !customer_name) throw ApiError.validation('instance_code/customer_name 必填');
    const lifecycle = 'design';
    const r = run(
      "INSERT INTO equipment_instances (instance_code, instance_name, equipment_model_id, customer_name, customer_contact, site_location, contract_no, contract_amount, start_date, planned_start, planned_end, serial_no, status, lifecycle_stage, project_no, archive_status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [code, instance_name || code, equipment_model_id || null, customer_name, customer_contact || null, site_location || null, contract_no || null, contract_amount || null, start_date || null, planned_start || null, planned_end || null, serial_no || null, lifecycle, lifecycle, project_no || null, 'active', notes || null]
    );
    const instanceId = r.lastInsertRowid;
    if (template_instance_id) {
      if (copy_template_milestones) copyMilestones(template_instance_id, instanceId, planned_start, planned_end);
      else if (generate_milestones) createDefaultMilestones(instanceId, planned_start, planned_end);
      if (copy_template_bom) copyBom(template_instance_id, instanceId);
      else if (create_bom_shell) createBomShell(instanceId, code, instance_name || code);
      if (copy_template_process) copyProcessNodes(template_instance_id, instanceId);
    } else {
      if (generate_milestones) createDefaultMilestones(instanceId, planned_start, planned_end);
      if (create_bom_shell) createBomShell(instanceId, code, instance_name || code);
    }
    if (create_doc_dirs) createDocFolders(instanceId);
    run('INSERT INTO equipment_instance_lifecycle_logs (equipment_instance_id, from_stage, to_stage, reason, changed_by) VALUES (?, NULL, ?, ?, ?)', [instanceId, lifecycle, '实例创建向导初始化', userId || null]);
    return { id: instanceId, code, lifecycle };
  });

  function countOrZero(sql, params = []) {
    try { return get(sql, params)?.c || 0; } catch (_e) { return 0; }
  }

  function sumOrZero(sql, params = []) {
    try { return get(sql, params)?.v || 0; } catch (_e) { return 0; }
  }

  function buildOverview(id) {
    const inst = get("SELECT ei.*, em.model_code, em.model_name, em.diameter_mm, et.name_zh as type_name FROM equipment_instances ei LEFT JOIN equipment_models em ON ei.equipment_model_id = em.id LEFT JOIN equipment_types et ON em.equipment_type_id = et.id WHERE ei.id = ?", id);
    if (!inst) throw ApiError.notFound('装备实例不存在');
    const wo = get("SELECT count(*) total, sum(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending, sum(CASE WHEN status='in_progress' THEN 1 ELSE 0 END) in_progress, sum(CASE WHEN status='completed' THEN 1 ELSE 0 END) completed, sum(CASE WHEN status IN ('issue','rework') THEN 1 ELSE 0 END) issue FROM work_orders WHERE equipment_instance_id = ?", id) || {};
    const qc = get("SELECT count(*) total, sum(CASE WHEN result='pass' THEN 1 ELSE 0 END) passed, sum(CASE WHEN result!='pass' THEN 1 ELSE 0 END) failed FROM qc_inspections WHERE equipment_instance_id = ?", id) || {};
    const shortages = get("SELECT count(*) total, sum(CASE WHEN status IN ('open','following') THEN 1 ELSE 0 END) open FROM shortage_cases WHERE equipment_instance_id = ?", id) || {};
    const ncr = get("SELECT count(*) total, sum(CASE WHEN closed_at IS NULL THEN 1 ELSE 0 END) open FROM ncr_reports WHERE equipment_instance_id = ?", id) || {};
    const purchase = get("SELECT count(*) total, sum(CASE WHEN status NOT IN ('closed','completed','cancelled') THEN 1 ELSE 0 END) open FROM purchase_orders WHERE equipment_instance_id = ?", id) || {};
    const milestones = all('SELECT * FROM equipment_instance_milestones WHERE project_id = ? ORDER BY sequence, id', id);
    const lifecycleLogs = all('SELECT * FROM equipment_instance_lifecycle_logs WHERE equipment_instance_id = ? ORDER BY id DESC LIMIT 20', id);
    const materialCost = sumOrZero("SELECT SUM(COALESCE(unit_price,0) * COALESCE(quantity,0)) v FROM instance_bom WHERE equipment_instance_id = ?", [id]);
    const ledgerCost = sumOrZero("SELECT SUM(COALESCE(debit_amount,0) - COALESCE(credit_amount,0)) v FROM erp_cost_ledger WHERE equipment_instance_id = ?", [id]);
    const risks = [];
    if ((shortages.open || 0) > 0) risks.push({ type: 'shortage', level: 'high', title: `缺料未闭环 ${shortages.open} 项` });
    if ((ncr.open || 0) > 0) risks.push({ type: 'quality', level: 'high', title: `NCR 未闭环 ${ncr.open} 项` });
    if ((wo.issue || 0) > 0) risks.push({ type: 'work_order', level: 'medium', title: `异常/返工工单 ${wo.issue} 项` });
    if ((purchase.open || 0) > 0) risks.push({ type: 'purchase', level: 'medium', title: `采购未关闭 ${purchase.open} 单` });
    if (inst.planned_end && !['delivered', 'operation', 'archived'].includes(inst.lifecycle_stage) && new Date(inst.planned_end) < new Date()) {
      risks.push({ type: 'schedule', level: 'high', title: '计划交付日期已逾期' });
    }
    return {
      instance: inst,
      lifecycle: LIFE_CYCLE,
      lifecycle_logs: lifecycleLogs,
      milestones,
      cards: {
        bom: { total: countOrZero('SELECT COUNT(*) c FROM instance_bom WHERE equipment_instance_id = ?', [id]), key_components: countOrZero('SELECT COUNT(*) c FROM instance_bom WHERE equipment_instance_id = ? AND COALESCE(is_key_component,0)=1', [id]) },
        documents: { total: countOrZero('SELECT COUNT(*) c FROM documents WHERE equipment_instance_id = ?', [id]), folders: countOrZero('SELECT COUNT(*) c FROM document_folders WHERE equipment_instance_id = ?', [id]) },
        purchase,
        kit: shortages,
        work_orders: wo,
        quality: { inspections: qc, ncr },
        cost: { material_estimate: materialCost, ledger_cost: ledgerCost, total: materialCost + ledgerCost },
        risks: { total: risks.length, items: risks },
      },
      freeze: {
        archive_status: inst.archive_status || 'active',
        frozen_at: inst.frozen_at,
        archived_at: inst.archived_at,
        snapshot: inst.freeze_snapshot ? JSON.parse(inst.freeze_snapshot) : null,
      }
    };
  }

// ============================================================
// ============================================================
app.get('/api/equipment_instances/code-preview', wrap((req, res) => {
  res.json({ code: nextInstanceCode(req.query.customer, req.query.year), rule: 'TBM-[客户缩写]-YYYY-###' });
}));

app.get('/api/equipment_instances/lifecycle-options', wrap((req, res) => {
  res.json(LIFE_CYCLE);
}));

app.get('/api/equipment_instances', wrap((req, res) => {
  const { status, customer, equipment_type_id } = req.query;
  let sql = "SELECT ei.*, em.model_code, em.model_name, et.name_zh as type_name FROM equipment_instances ei LEFT JOIN equipment_models em ON ei.equipment_model_id = em.id LEFT JOIN equipment_types et ON em.equipment_type_id = et.id WHERE 1=1";
  const params = [];
  if (status) { sql += ' AND (ei.status = ? OR ei.lifecycle_stage = ?)'; params.push(status, status); }
  if (customer) { sql += ' AND ei.customer_name LIKE ?'; params.push('%' + customer + '%'); }
  if (equipment_type_id) { sql += ' AND em.equipment_type_id = ?'; params.push(equipment_type_id); }
  sql += ' ORDER BY ei.created_at DESC';
  res.json(all(sql, params));
}));

app.get('/api/equipment_instances/:id', wrap((req, res) => {
  const row = get("SELECT ei.*, em.model_code, em.model_name, em.diameter_mm, et.name_zh as type_name FROM equipment_instances ei LEFT JOIN equipment_models em ON ei.equipment_model_id = em.id LEFT JOIN equipment_types et ON em.equipment_type_id = et.id WHERE ei.id = ?", req.params.id);
  if (!row) throw ApiError.notFound('not found')
  res.json(row);
}));

app.post('/api/equipment_instances', wrap((req, res) => {
  const result = createInstanceTx(req.body || {}, req.user?.sub || req.user?.id || null);
  res.json({ id: result.id, message: '整机实例已创建', instance_code: result.code, lifecycle_stage: result.lifecycle });
}));

app.put('/api/equipment_instances/:id', wrap((req, res) => {
  ensureNotFrozen(req.params.id);
  const fields = ['instance_name', 'equipment_model_id', 'customer_name', 'customer_contact', 'site_location', 'contract_no', 'contract_amount', 'start_date', 'planned_start', 'planned_end', 'actual_start', 'actual_end', 'status', 'lifecycle_stage', 'progress_pct', 'serial_no', 'project_no', 'notes'];
  const updates = [];
  const values = [];
  for (const f of fields) if (req.body[f] !== undefined) { updates.push(f + ' = ?'); values.push(req.body[f]); }
  if (updates.length === 0) throw ApiError.validation('no fields')
  updates.push("updated_at = datetime('now')");
  values.push(req.params.id);
  const r = run('UPDATE equipment_instances SET ' + updates.join(', ') + ' WHERE id = ?', values);
  res.json({ changes: r.changes });
}));

app.delete('/api/equipment_instances/:id', wrap((req, res) => {
  ensureNotFrozen(req.params.id);
  const r = run('DELETE FROM equipment_instances WHERE id = ?', req.params.id);
  res.json({ changes: r.changes });
}));

app.get('/api/equipment_instances/:id/dashboard', wrap((req, res) => {
  const inst = get("SELECT ei.*, em.model_code, em.model_name, et.name_zh as type_name FROM equipment_instances ei LEFT JOIN equipment_models em ON ei.equipment_model_id = em.id LEFT JOIN equipment_types et ON em.equipment_type_id = et.id WHERE ei.id = ?", req.params.id);
  if (!inst) throw ApiError.notFound('not found')
  const wo_stats = get("SELECT count(*) as total, sum(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending, sum(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress, sum(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed, sum(CASE WHEN status = 'issue' THEN 1 ELSE 0 END) as issue FROM work_orders WHERE equipment_instance_id = ?", req.params.id);
  const pn_stats = get("SELECT count(*) as total, sum(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) as ready, sum(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress, sum(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed FROM process_nodes WHERE equipment_instance_id = ?", req.params.id);
  const milestones = all('SELECT * FROM equipment_instance_milestones WHERE project_id = ? ORDER BY sequence, id', req.params.id);
  res.json({ instance: inst, work_orders: wo_stats, process_nodes: pn_stats, milestones, bom_count: get('SELECT count(*) c FROM instance_bom WHERE equipment_instance_id = ?', req.params.id).c });
}));

app.get('/api/equipment_instances/:id/overview', wrap((req, res) => {
  res.json(buildOverview(req.params.id));
}));

app.post('/api/equipment_instances/:id/lifecycle', wrap((req, res) => {
  ensureNotFrozen(req.params.id);
  const toStage = req.body.lifecycle_stage || req.body.status;
  if (!LIFE_VALUES.has(toStage)) throw ApiError.validation('生命周期状态不合法');
  const inst = get('SELECT lifecycle_stage FROM equipment_instances WHERE id = ?', req.params.id);
  const fromStage = inst.lifecycle_stage;
  run("UPDATE equipment_instances SET lifecycle_stage = ?, status = ?, updated_at = datetime('now') WHERE id = ?", [toStage, toStage, req.params.id]);
  run('INSERT INTO equipment_instance_lifecycle_logs (equipment_instance_id, from_stage, to_stage, reason, changed_by) VALUES (?, ?, ?, ?, ?)', [req.params.id, fromStage, toStage, req.body.reason || null, req.user?.sub || req.user?.id || null]);
  res.json({ id: Number(req.params.id), from_stage: fromStage, to_stage: toStage });
}));

app.post('/api/equipment_instances/:id/freeze', wrap((req, res) => {
  const inst = get('SELECT * FROM equipment_instances WHERE id = ?', req.params.id);
  if (!inst) throw ApiError.notFound('装备实例不存在');
  const overview = buildOverview(req.params.id);
  const snapshot = {
    frozen_reason: req.body.reason || '交付后冻结基线',
    frozen_at: new Date().toISOString(),
    lifecycle_stage: inst.lifecycle_stage,
    counts: overview.cards,
    milestones: overview.milestones.map(m => ({ phase_code: m.phase_code, phase_name: m.phase_name, status: m.status, planned_start: m.planned_start, planned_end: m.planned_end })),
  };
  run("UPDATE equipment_instances SET archive_status = 'frozen', frozen_at = COALESCE(frozen_at, datetime('now')), frozen_by = COALESCE(frozen_by, ?), freeze_snapshot = ?, updated_at = datetime('now') WHERE id = ?", [req.user?.sub || req.user?.id || null, JSON.stringify(snapshot), req.params.id]);
  res.json({ id: Number(req.params.id), archive_status: 'frozen', snapshot });
}));

app.post('/api/equipment_instances/:id/archive', wrap((req, res) => {
  const inst = get('SELECT * FROM equipment_instances WHERE id = ?', req.params.id);
  if (!inst) throw ApiError.notFound('装备实例不存在');
  if (!inst.frozen_at) {
    const overview = buildOverview(req.params.id);
    run("UPDATE equipment_instances SET frozen_at = datetime('now'), frozen_by = ?, freeze_snapshot = ? WHERE id = ?", [req.user?.sub || req.user?.id || null, JSON.stringify({ archived_with_freeze: true, counts: overview.cards }), req.params.id]);
  }
  run("UPDATE equipment_instances SET archive_status = 'archived', lifecycle_stage = 'archived', status = 'archived', archived_at = datetime('now'), archived_by = ?, updated_at = datetime('now') WHERE id = ?", [req.user?.sub || req.user?.id || null, req.params.id]);
  res.json({ id: Number(req.params.id), archive_status: 'archived', lifecycle_stage: 'archived' });
}));

// ============================================================
// 装备类型 / 型号 / 子系统 / 工位
// ============================================================
app.get('/api/equipment_types', wrap((req, res) => res.json(all('SELECT * FROM equipment_types WHERE is_active = 1 ORDER BY id'))));
app.get('/api/equipment_types/:id', wrap((req, res) => {
  const r = get('SELECT * FROM equipment_types WHERE id = ?', req.params.id);
  if (!r) throw ApiError.notFound('not found')
  res.json(r);
}));
app.get('/api/equipment_models', wrap((req, res) => {
  const { equipment_type_id } = req.query;
  let sql = "SELECT em.*, et.name_zh as type_name FROM equipment_models em LEFT JOIN equipment_types et ON em.equipment_type_id = et.id WHERE 1=1";
  const params = [];
  if (equipment_type_id) { sql += ' AND em.equipment_type_id = ?'; params.push(equipment_type_id); }
  sql += ' ORDER BY em.id';
  res.json(all(sql, params));
}));
app.get('/api/equipment_subsystems', wrap((req, res) => {
  const { equipment_type_id } = req.query;
  let sql = 'SELECT * FROM equipment_subsystems WHERE 1=1';
  const params = [];
  if (equipment_type_id) { sql += ' AND equipment_type_id = ?'; params.push(equipment_type_id); }
  sql += ' ORDER BY sequence';
  res.json(all(sql, params));
}));
app.get('/api/workstations', wrap((req, res) => res.json(all('SELECT * FROM workstations ORDER BY id'))));
app.get('/api/equipment', wrap((req, res) => res.json(all('SELECT * FROM equipment ORDER BY id'))));

// P2-#3 设备实时状态看板
app.get('/api/equipment/live_status', wrap((req, res) => {
  const equipment_total = get("SELECT COUNT(*) c FROM equipment") || { c: 0 };
  const equipment_idle = get("SELECT COUNT(*) c FROM equipment WHERE id NOT IN (SELECT workstation_id FROM work_orders WHERE status='in_progress' AND workstation_id IS NOT NULL)") || { c: 0 };
  const wo_in_progress = get("SELECT COUNT(*) c FROM work_orders WHERE status='in_progress'") || { c: 0 };
  const pn_in_progress = get("SELECT COUNT(*) c FROM process_nodes WHERE status='in_progress'") || { c: 0 };
  const by_subsystem = all("SELECT es.name_zh as subsystem, COUNT(DISTINCT pn.id) as in_progress_nodes FROM equipment_subsystems es LEFT JOIN process_nodes pn ON pn.equipment_instance_id IN (SELECT id FROM equipment_instances) WHERE pn.status='in_progress' GROUP BY es.id ORDER BY in_progress_nodes DESC");
  const recent_starts = all("SELECT wo.*, ei.instance_code, ei.instance_name FROM work_orders wo JOIN equipment_instances ei ON wo.equipment_instance_id = ei.id WHERE wo.status='in_progress' ORDER BY wo.actual_start DESC LIMIT 10");
  const utilization = equipment_total.c ? Math.round((equipment_total.c - equipment_idle.c) * 100 / equipment_total.c) : 0;
  res.json({ equipment_total: equipment_total.c, equipment_busy: equipment_total.c - equipment_idle.c, equipment_idle: equipment_idle.c, utilization, wo_in_progress: wo_in_progress.c, pn_in_progress: pn_in_progress.c, by_subsystem, recent_starts });
}));


}

module.exports = { register };
