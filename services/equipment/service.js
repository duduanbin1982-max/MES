const { ApiError } = require('../../app/errors');
const { wrap } = require('../../middleware/asyncHandler');
const {
  LIFE_CYCLE,
  DEFAULT_MILESTONES,
  DEFAULT_DOC_FOLDERS,
  TEMPLATE_SCOPE_OPTIONS,
  EMPTY_TEMPLATE_SCOPE,
  INSTANCE_TEMPLATE_SCOPE,
} = require('./catalog');
const { initEquipmentInstanceEnhancements } = require('./schema');
const { createEquipmentOverview } = require('./overview');
const { registerLifecycleRoutes } = require('./lifecycleRoutes');
// services/equipmentService.js
// P0-#1 拆 server.js: 整机/型号/子系统/工位/设备实时状态 (P2-#3 设备看板)
// Author: 三狗子 | Date: 2026-06-23

function register(app, db) {
  const all = (sql, params = []) => db.prepare(sql).all(params);
  const get = (sql, params = []) => db.prepare(sql).get(params);
  const run = (sql, params = []) => db.prepare(sql).run(params);


  initEquipmentInstanceEnhancements(db);

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

  function nextTemplateCode(category) {
    const y = String(new Date().getFullYear());
    const categoryToken = cleanCodeToken(category || 'TBM') || 'TBM';
    const prefix = `TPL-${categoryToken}-${y}`;
    const row = get(
      "SELECT template_code FROM equipment_instance_templates WHERE template_code LIKE ? ORDER BY id DESC LIMIT 1",
      [`${prefix}-%`]
    );
    const last = row?.template_code?.match(/-(\d{3,})$/);
    const seq = String(last ? Number(last[1]) + 1 : 1).padStart(3, '0');
    return `${prefix}-${seq}`;
  }

  function normalizeCopyScope(value, fallback = EMPTY_TEMPLATE_SCOPE) {
    let parsed = value;
    if (typeof value === 'string') {
      try { parsed = JSON.parse(value); } catch (_error) { parsed = {}; }
    }
    if (Array.isArray(parsed)) {
      parsed = parsed.reduce((acc, key) => {
        acc[key] = true;
        return acc;
      }, {});
    }
    const source = parsed && typeof parsed === 'object' ? parsed : {};
    const result = {};
    for (const option of TEMPLATE_SCOPE_OPTIONS) {
      result[option.key] = source[option.key] === undefined ? !!fallback[option.key] : !!source[option.key];
    }
    return result;
  }

  function scopeKeys(scope) {
    return TEMPLATE_SCOPE_OPTIONS.filter((option) => scope[option.key]).map((option) => option.key);
  }

  function templateRow(row) {
    if (!row) return null;
    const copyScope = normalizeCopyScope(row.copy_scope, row.source_instance_id ? INSTANCE_TEMPLATE_SCOPE : EMPTY_TEMPLATE_SCOPE);
    return {
      ...row,
      copy_scope: copyScope,
      copy_scope_keys: scopeKeys(copyScope),
    };
  }

  function getTemplate(templateId) {
    if (!templateId) return null;
    const row = get(`
      SELECT t.*, ei.instance_code AS source_instance_code, ei.instance_name AS source_instance_name
      FROM equipment_instance_templates t
      LEFT JOIN equipment_instances ei ON ei.id = t.source_instance_id
      WHERE t.id = ?
    `, templateId);
    if (!row) throw ApiError.notFound('项目装备模板不存在');
    return templateRow(row);
  }

  function ensureNotFrozen(id) {
    const inst = get('SELECT archive_status, frozen_at FROM equipment_instances WHERE id = ?', id);
    if (!inst) throw ApiError.notFound('项目装备不存在');
    if (inst.archive_status === 'archived' || inst.frozen_at) {
      throw ApiError.validation('该项目装备已冻结/归档，禁止修改历史基线');
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
      'notes', 'assigned_to', 'subsystem_id', 'operation_template_id', 'required_position_code', 'worker_count',
      'qc_required', 'sop_required', 'drawing_required'
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
      template_id,
      template_instance_id,
    } = body;
    const code = instance_code || nextInstanceCode(customer_name, planned_start?.slice(0, 4));
    if (!code || !customer_name) throw ApiError.validation('instance_code/customer_name 必填');
    const selectedTemplate = template_id ? getTemplate(template_id) : null;
    if (selectedTemplate && selectedTemplate.status !== 'published') throw ApiError.validation('只能使用已发布的项目装备模板');
    const templateSourceId = selectedTemplate?.source_instance_id || template_instance_id || null;
    if (templateSourceId && !get('SELECT id FROM equipment_instances WHERE id = ?', templateSourceId)) throw ApiError.validation('模板来源项目装备不存在');
    const selectedScope = selectedTemplate?.copy_scope || null;
    const useFlag = (field, fallback) => body[field] === undefined ? fallback : !!body[field];
    const shouldGenerateMilestones = useFlag('generate_milestones', selectedScope ? !!selectedScope.milestones : true);
    const shouldCreateBomShell = useFlag('create_bom_shell', selectedScope ? !!selectedScope.bom_shell : true);
    const shouldCreateDocDirs = useFlag('create_doc_dirs', selectedScope ? !!selectedScope.doc_dirs : true);
    const shouldCopyMilestones = !!templateSourceId && useFlag('copy_template_milestones', selectedScope ? !!selectedScope.milestones : false);
    const shouldCopyBom = !!templateSourceId && useFlag('copy_template_bom', selectedScope ? !!selectedScope.bom : false);
    const shouldCopyProcess = !!templateSourceId && useFlag('copy_template_process', selectedScope ? !!selectedScope.process : false);
    const lifecycle = 'design';
    const r = run(
      "INSERT INTO equipment_instances (instance_code, instance_name, equipment_model_id, customer_name, customer_contact, site_location, contract_no, contract_amount, start_date, planned_start, planned_end, serial_no, status, lifecycle_stage, project_no, archive_status, notes, source_template_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [code, instance_name || code, equipment_model_id || null, customer_name, customer_contact || null, site_location || null, contract_no || null, contract_amount || null, start_date || null, planned_start || null, planned_end || null, serial_no || null, lifecycle, lifecycle, project_no || null, 'active', notes || null, selectedTemplate?.id || null]
    );
    const instanceId = r.lastInsertRowid;
    if (templateSourceId) {
      if (shouldCopyMilestones) copyMilestones(templateSourceId, instanceId, planned_start, planned_end);
      else if (shouldGenerateMilestones) createDefaultMilestones(instanceId, planned_start, planned_end);
      if (shouldCopyBom) copyBom(templateSourceId, instanceId);
      else if (shouldCreateBomShell) createBomShell(instanceId, code, instance_name || code);
      if (shouldCopyProcess) copyProcessNodes(templateSourceId, instanceId);
    } else {
      if (shouldGenerateMilestones) createDefaultMilestones(instanceId, planned_start, planned_end);
      if (shouldCreateBomShell) createBomShell(instanceId, code, instance_name || code);
    }
    if (shouldCreateDocDirs) createDocFolders(instanceId);
    run('INSERT INTO equipment_instance_lifecycle_logs (equipment_instance_id, from_stage, to_stage, reason, changed_by) VALUES (?, NULL, ?, ?, ?)', [instanceId, lifecycle, '实例创建向导初始化', userId || null]);
    return { id: instanceId, code, lifecycle };
  });


  const buildOverview = createEquipmentOverview({ db, ApiError, lifecycle: LIFE_CYCLE });

// ============================================================
// ============================================================
app.get('/api/equipment_instances/code-preview', wrap((req, res) => {
  res.json({ code: nextInstanceCode(req.query.customer, req.query.year), rule: 'TBM-[客户缩写]-YYYY-###' });
}));

app.get('/api/equipment_instances/lifecycle-options', wrap((req, res) => {
  res.json(LIFE_CYCLE);
}));

app.get('/api/equipment_instance_templates/scope-options', wrap((_req, res) => {
  res.json(TEMPLATE_SCOPE_OPTIONS);
}));

app.get('/api/equipment_instance_templates', wrap((req, res) => {
  const { status, category } = req.query;
  let sql = `
    SELECT t.*, ei.instance_code AS source_instance_code, ei.instance_name AS source_instance_name
    FROM equipment_instance_templates t
    LEFT JOIN equipment_instances ei ON ei.id = t.source_instance_id
    WHERE 1=1
  `;
  const params = [];
  if (status) { sql += ' AND t.status = ?'; params.push(status); }
  if (category) { sql += ' AND t.category = ?'; params.push(category); }
  sql += " ORDER BY CASE t.status WHEN 'published' THEN 1 WHEN 'draft' THEN 2 ELSE 3 END, t.updated_at DESC, t.id DESC";
  res.json(all(sql, params).map(templateRow));
}));

app.post('/api/equipment_instance_templates', wrap((req, res) => {
  const body = req.body || {};
  const templateName = String(body.template_name || '').trim();
  if (!templateName) throw ApiError.validation('template_name 必填');
  const category = String(body.category || 'TBM').trim() || 'TBM';
  const templateCode = String(body.template_code || nextTemplateCode(category)).trim().toUpperCase();
  const status = ['draft', 'published', 'disabled'].includes(body.status) ? body.status : 'published';
  const version = String(body.version || 'A0').trim() || 'A0';
  const sourceInstanceId = body.source_instance_id ? Number(body.source_instance_id) : null;
  if (sourceInstanceId && !get('SELECT id FROM equipment_instances WHERE id = ?', sourceInstanceId)) throw ApiError.validation('来源项目装备不存在');
  const duplicate = get('SELECT id FROM equipment_instance_templates WHERE template_code = ?', templateCode);
  if (duplicate) throw ApiError.validation('模板编码已存在: ' + templateCode);
  const copyScope = normalizeCopyScope(body.copy_scope, sourceInstanceId ? INSTANCE_TEMPLATE_SCOPE : EMPTY_TEMPLATE_SCOPE);
  const result = run(
    `INSERT INTO equipment_instance_templates
      (template_code, template_name, category, version, source_instance_id, copy_scope, status, description, created_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [templateCode, templateName, category, version, sourceInstanceId, JSON.stringify(copyScope), status, body.description || null, req.user?.sub || req.user?.id || null]
  );
  res.json({ id: result.lastInsertRowid, template_code: templateCode, copy_scope: copyScope, status });
}));

app.put('/api/equipment_instance_templates/:id', wrap((req, res) => {
  const current = get('SELECT * FROM equipment_instance_templates WHERE id = ?', req.params.id);
  if (!current) throw ApiError.notFound('项目装备模板不存在');
  const body = req.body || {};
  const updates = [];
  const params = [];
  for (const field of ['template_name', 'category', 'version', 'description']) {
    if (body[field] !== undefined) {
      updates.push(field + ' = ?');
      params.push(body[field]);
    }
  }
  if (body.source_instance_id !== undefined) {
    const sourceInstanceId = body.source_instance_id ? Number(body.source_instance_id) : null;
    if (sourceInstanceId && !get('SELECT id FROM equipment_instances WHERE id = ?', sourceInstanceId)) throw ApiError.validation('来源项目装备不存在');
    updates.push('source_instance_id = ?');
    params.push(sourceInstanceId);
  }
  if (body.copy_scope !== undefined) {
    const sourceInstanceId = body.source_instance_id === undefined ? current.source_instance_id : (body.source_instance_id || null);
    updates.push('copy_scope = ?');
    params.push(JSON.stringify(normalizeCopyScope(body.copy_scope, sourceInstanceId ? INSTANCE_TEMPLATE_SCOPE : EMPTY_TEMPLATE_SCOPE)));
  }
  if (body.status !== undefined) {
    if (!['draft', 'published', 'disabled'].includes(body.status)) throw ApiError.validation('模板状态不合法');
    updates.push('status = ?');
    params.push(body.status);
  }
  if (!updates.length) throw ApiError.validation('no fields');
  updates.push("updated_at = datetime('now')");
  params.push(req.params.id);
  const result = run('UPDATE equipment_instance_templates SET ' + updates.join(', ') + ' WHERE id = ?', params);
  res.json({ changes: result.changes });
}));

app.post('/api/equipment_instance_templates/:id/status', wrap((req, res) => {
  const status = req.body?.status;
  if (!['draft', 'published', 'disabled'].includes(status)) throw ApiError.validation('模板状态不合法');
  const current = get('SELECT id FROM equipment_instance_templates WHERE id = ?', req.params.id);
  if (!current) throw ApiError.notFound('项目装备模板不存在');
  const result = run("UPDATE equipment_instance_templates SET status = ?, updated_at = datetime('now') WHERE id = ?", [status, req.params.id]);
  res.json({ id: Number(req.params.id), status, changes: result.changes });
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

registerLifecycleRoutes({ app, db, wrap, ApiError, ensureNotFrozen, buildOverview });

// ============================================================
// 装备类型 / 型号 / 子系统 / 工位
// ============================================================
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
