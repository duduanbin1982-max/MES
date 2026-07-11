"use strict";
// services/processMasterService.js
// 工序库 / 岗位库 / 工序岗位要求主数据

const { ApiError } = require("../app/errors");
const { wrap } = require("../middleware/asyncHandler");

const DEFAULT_POSITIONS = [
  { position_code: "assembly_worker", position_name: "装配工", department: "生产部", skill_category: "assembly", min_level: 3, required_cert_type: null, description: "机械装配、部件总装" },
  { position_code: "welder", position_name: "焊工", department: "焊接车间", skill_category: "welding", min_level: 3, required_cert_type: "welding", description: "焊接作业，需有效焊工证" },
  { position_code: "machinist", position_name: "机加工", department: "机加车间", skill_category: "machining", min_level: 3, required_cert_type: "machining", description: "车铣镗钻/CNC 加工" },
  { position_code: "qc_inspector", position_name: "质检员", department: "质量部", skill_category: "qc", min_level: 3, required_cert_type: "qc", description: "过程/出厂检验" },
  { position_code: "ndt_inspector", position_name: "无损检测员", department: "质量部", skill_category: "ndt", min_level: 3, required_cert_type: "ndt", description: "UT/MT/PT 等无损检测" },
  { position_code: "commissioning_engineer", position_name: "调试工程师", department: "调试部", skill_category: "commissioning", min_level: 3, required_cert_type: null, description: "液压/电气/整机调试" },
  { position_code: "warehouse_keeper", position_name: "仓库员", department: "仓储部", skill_category: "warehouse", min_level: 2, required_cert_type: null, description: "收发料、领退料、库位管理" },
];

const DEFAULT_OPERATIONS = [
  { operation_code: "cutting", operation_name: "下料", operation_type: "make", category: "fabrication", default_station_type: "cutting", required_skill: "cutting", required_position_code: "machinist", standard_hours: 4, worker_count: 1, drawing_required: 1, qc_required: 0, sop_required: 1, sequence_hint: 10, description: "板材/型材切割下料" },
  { operation_code: "forming", operation_name: "成型/折弯", operation_type: "make", category: "fabrication", default_station_type: "forming", required_skill: "forming", required_position_code: "machinist", standard_hours: 6, worker_count: 1, drawing_required: 1, qc_required: 0, sop_required: 1, sequence_hint: 20, description: "折弯、卷制、成型" },
  { operation_code: "machining", operation_name: "机加工", operation_type: "make", category: "machining", default_station_type: "machining", required_skill: "machining", required_position_code: "machinist", standard_hours: 8, worker_count: 1, drawing_required: 1, qc_required: 1, sop_required: 1, sequence_hint: 30, description: "车铣镗钻/CNC 加工" },
  { operation_code: "welding", operation_name: "焊接", operation_type: "make", category: "welding", default_station_type: "welding", required_skill: "welding", required_position_code: "welder", standard_hours: 10, worker_count: 1, drawing_required: 1, qc_required: 1, sop_required: 1, sequence_hint: 40, description: "结构件焊接，需焊工资质" },
  { operation_code: "ndt", operation_name: "无损检测", operation_type: "qc", category: "quality", default_station_type: "inspection", required_skill: "ndt", required_position_code: "ndt_inspector", standard_hours: 2, worker_count: 1, drawing_required: 0, qc_required: 1, sop_required: 1, sequence_hint: 50, description: "焊缝/关键件无损检测" },
  { operation_code: "assembly", operation_name: "部件装配", operation_type: "assemble", category: "assembly", default_station_type: "assembly", required_skill: "assembly", required_position_code: "assembly_worker", standard_hours: 16, worker_count: 2, drawing_required: 1, qc_required: 1, sop_required: 1, sequence_hint: 60, description: "部件装配、预装" },
  { operation_code: "process_qc", operation_name: "过程检验", operation_type: "qc", category: "quality", default_station_type: "inspection", required_skill: "qc", required_position_code: "qc_inspector", standard_hours: 2, worker_count: 1, drawing_required: 0, qc_required: 1, sop_required: 1, sequence_hint: 70, description: "尺寸、外观、过程检验" },
  { operation_code: "commissioning", operation_name: "调试", operation_type: "test", category: "commissioning", default_station_type: "commissioning", required_skill: "commissioning", required_position_code: "commissioning_engineer", standard_hours: 12, worker_count: 2, drawing_required: 1, qc_required: 1, sop_required: 1, sequence_hint: 80, description: "液压/电气/整机调试" },
];

function columnNames(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((col) => col.name));
}

function addColumn(db, table, name, ddl) {
  if (!columnNames(db, table).has(name)) db.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run();
}

function safeBool(value) {
  return value ? 1 : 0;
}

function runMigration(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS process_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position_code TEXT NOT NULL UNIQUE,
      position_name TEXT NOT NULL,
      department TEXT,
      skill_category TEXT NOT NULL DEFAULT 'general',
      min_level INTEGER NOT NULL DEFAULT 1,
      required_cert_type TEXT,
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS process_operation_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_code TEXT NOT NULL UNIQUE,
      operation_name TEXT NOT NULL,
      operation_type TEXT NOT NULL DEFAULT 'make',
      category TEXT NOT NULL DEFAULT 'general',
      default_station_type TEXT,
      required_skill TEXT,
      required_position_code TEXT,
      standard_hours REAL NOT NULL DEFAULT 0,
      worker_count INTEGER NOT NULL DEFAULT 1,
      qc_required INTEGER NOT NULL DEFAULT 0,
      sop_required INTEGER NOT NULL DEFAULT 0,
      drawing_required INTEGER NOT NULL DEFAULT 0,
      sequence_hint INTEGER NOT NULL DEFAULT 1,
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (required_position_code) REFERENCES process_positions(position_code)
    );
  `);

  for (const col of [
    ["operation_template_id", "operation_template_id INTEGER"],
    ["required_position_code", "required_position_code TEXT"],
    ["worker_count", "worker_count INTEGER DEFAULT 1"],
    ["qc_required", "qc_required INTEGER DEFAULT 0"],
    ["sop_required", "sop_required INTEGER DEFAULT 0"],
  ]) addColumn(db, "process_nodes", col[0], col[1]);
  addColumn(db, "process_nodes", "drawing_required", "drawing_required INTEGER DEFAULT 0");
  addColumn(db, "process_operation_templates", "drawing_required", "drawing_required INTEGER NOT NULL DEFAULT 0");

  const posInsert = db.prepare(`
    INSERT OR IGNORE INTO process_positions
      (position_code, position_name, department, skill_category, min_level, required_cert_type, description)
    VALUES (@position_code, @position_name, @department, @skill_category, @min_level, @required_cert_type, @description)
  `);
  for (const row of DEFAULT_POSITIONS) posInsert.run(row);

  const opInsert = db.prepare(`
    INSERT OR IGNORE INTO process_operation_templates
      (operation_code, operation_name, operation_type, category, default_station_type, required_skill,
       required_position_code, standard_hours, worker_count, qc_required, sop_required, drawing_required, sequence_hint, description)
    VALUES (@operation_code, @operation_name, @operation_type, @category, @default_station_type, @required_skill,
       @required_position_code, @standard_hours, @worker_count, @qc_required, @sop_required, @drawing_required, @sequence_hint, @description)
  `);
  for (const row of DEFAULT_OPERATIONS) opInsert.run(row);

  db.prepare("CREATE INDEX IF NOT EXISTS idx_process_positions_skill ON process_positions(skill_category, is_active)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_process_templates_category ON process_operation_templates(category, is_active)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_process_nodes_template ON process_nodes(operation_template_id)").run();
  db.exec(`
    CREATE TABLE IF NOT EXISTS process_operation_docs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_template_id INTEGER NOT NULL,
      doc_type TEXT NOT NULL DEFAULT 'sop',
      title TEXT NOT NULL,
      doc_id INTEGER,
      is_required INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (operation_template_id) REFERENCES process_operation_templates(id) ON DELETE CASCADE,
      FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE SET NULL
    );
  `);
}

function findWorkstation(db, stationType) {
  if (!stationType) return null;
  const row = db.prepare(`
    SELECT id FROM workstations
    WHERE is_active = 1 AND status != 'disabled'
      AND (station_type = ? OR name LIKE ? OR workshop LIKE ?)
    ORDER BY CASE status WHEN 'available' THEN 1 ELSE 2 END, id
    LIMIT 1
  `).get(stationType, `%${stationType}%`, `%${stationType}%`);
  return row ? row.id : null;
}

function applyTemplateToNode(db, nodeId, templateId) {
  const template = db.prepare("SELECT * FROM process_operation_templates WHERE id = ? AND is_active = 1").get(templateId);
  if (!template) throw ApiError.notFound("工序模板不存在或已停用");
  const workstationId = findWorkstation(db, template.default_station_type);
  const result = db.prepare(`
    UPDATE process_nodes
    SET operation_template_id = ?,
        operation_name = ?,
        operation_type = ?,
        estimated_hours = ?,
        required_workstation_id = COALESCE(required_workstation_id, ?),
        required_skill = ?,
        required_position_code = ?,
        worker_count = ?,
        qc_required = ?,
        sop_required = ?,
        drawing_required = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    template.id,
    template.operation_name,
    template.operation_type,
    template.standard_hours,
    workstationId,
    template.required_skill,
    template.required_position_code,
    template.worker_count,
    template.qc_required,
    template.sop_required,
    template.drawing_required,
    nodeId,
  );
  if (!result.changes) throw ApiError.notFound("工艺节点不存在");
  return { template, workstation_id: workstationId, changes: result.changes };
}

function validateAssignment(db, { process_node_id, user_id }) {
  if (!process_node_id || !user_id) throw ApiError.validation("process_node_id / user_id 必填");
  const node = db.prepare(`
    SELECT pn.*, p.position_name, p.skill_category AS position_skill, p.min_level, p.required_cert_type AS position_cert_type,
           pot.sop_required AS template_sop_required, pot.drawing_required AS template_drawing_required
    FROM process_nodes pn
    LEFT JOIN process_positions p ON p.position_code = pn.required_position_code
    LEFT JOIN process_operation_templates pot ON pot.id = pn.operation_template_id
    WHERE pn.id = ?
  `).get(process_node_id);
  if (!node) throw ApiError.notFound("工艺节点不存在");
  const user = db.prepare("SELECT id, full_name, role_code, is_active FROM users WHERE id = ?").get(user_id);
  if (!user || Number(user.is_active) !== 1) throw ApiError.notFound("人员不存在或已停用");

  const skillCategory = node.position_skill || node.required_skill;
  const minLevel = Number(node.min_level || 1);
  const certType = node.position_cert_type || null;
  const skill = skillCategory ? db.prepare(`
    SELECT * FROM worker_skills
    WHERE user_id = ?
      AND (skill_category = ? OR skill_name = ?)
      AND proficiency_level >= ?
    ORDER BY proficiency_level DESC
    LIMIT 1
  `).get(user_id, skillCategory, skillCategory, minLevel) : null;

  const cert = certType ? db.prepare(`
    SELECT * FROM worker_certificates
    WHERE user_id = ? AND cert_type = ? AND status = 'valid'
      AND (expiry_date IS NULL OR expiry_date >= date('now'))
    ORDER BY expiry_date IS NULL DESC, expiry_date DESC
    LIMIT 1
  `).get(user_id, certType) : null;

  
  // Check required docs from process_operation_docs
  const requiredDocs = db.prepare(`
    SELECT pod.*, d.status AS doc_status, da.id AS acknowledgement_id
    FROM process_operation_docs pod
    LEFT JOIN documents d ON d.id = pod.doc_id
    LEFT JOIN doc_acknowledgements da ON da.doc_id = d.id AND da.ack_by = ?
    WHERE pod.operation_template_id = ?
  `).all(user_id, node.operation_template_id);
  const missingDocs = [];
  const requiredTypes = new Set(requiredDocs.filter((item) => Number(item.is_required) === 1).map((item) => item.doc_type));
  if (Number(node.template_sop_required) === 1 && !requiredTypes.has("sop")) missingDocs.push("工序模板要求 SOP，但尚未绑定必需文档");
  if (Number(node.template_drawing_required) === 1 && !requiredTypes.has("drawing")) missingDocs.push("工序模板要求图纸，但尚未绑定必需文档");
  for (const rd of requiredDocs) {
    if (Number(rd.is_required) !== 1) continue;
    if (!rd.doc_id || rd.doc_status !== "issued") {
      missingDocs.push(`${rd.title} 未绑定或未签发`);
    } else if (!rd.acknowledgement_id) {
      missingDocs.push(`${rd.title} 尚未由 ${user.full_name} 签收`);
    }
  }
  const missing = [];
  if (skillCategory && !skill) missing.push(`缺少 ${skillCategory} L${minLevel}+ 技能`);
  if (missingDocs.length > 0) missing.push(...missingDocs);
  if (certType && !cert) missing.push(`缺少有效 ${certType} 资质证书`);
  return {
    ok: missing.length === 0,
    missing,
    process_node_id: Number(process_node_id),
    user_id: Number(user_id),
    user_name: user.full_name,
    required_position_code: node.required_position_code,
    position_name: node.position_name,
    required_skill: skillCategory,
    min_level: minLevel,
    required_cert_type: certType,
    matched_skill: skill,
    matched_certificate: cert,
  };
}

function register(app, db) {
  runMigration(db);

  const all = (sql, params = []) => db.prepare(sql).all(params);
  const get = (sql, params = []) => db.prepare(sql).get(params);
  const run = (sql, params = []) => db.prepare(sql).run(params);

  app.get("/api/process-master/overview", wrap((_req, res) => {
    const position = get("SELECT COUNT(*) total, SUM(CASE WHEN is_active=1 THEN 1 ELSE 0 END) active FROM process_positions");
    const operation = get("SELECT COUNT(*) total, SUM(CASE WHEN is_active=1 THEN 1 ELSE 0 END) active FROM process_operation_templates");
    const node = get(`
      SELECT COUNT(*) total,
             SUM(CASE WHEN operation_template_id IS NOT NULL THEN 1 ELSE 0 END) templated,
             SUM(CASE WHEN required_position_code IS NOT NULL AND required_position_code != '' THEN 1 ELSE 0 END) positioned,
             SUM(CASE WHEN COALESCE(worker_count, 0) > 0 THEN 1 ELSE 0 END) staffed
      FROM process_nodes
    `);
    res.json({ positions: position, operations: operation, process_nodes: node });
  }));

  app.get("/api/process-master/positions", wrap((req, res) => {
    const includeInactive = req.query.include_inactive === "1";
    const rows = all(`
      SELECT p.*,
             (SELECT COUNT(*) FROM process_operation_templates t WHERE t.required_position_code = p.position_code) AS template_count,
             (SELECT COUNT(*) FROM process_nodes n WHERE n.required_position_code = p.position_code) AS node_count
      FROM process_positions p
      ${includeInactive ? "" : "WHERE p.is_active = 1"}
      ORDER BY p.department, p.id
    `);
    res.json({ items: rows });
  }));

  app.post("/api/process-master/positions", wrap((req, res) => {
    const body = req.body || {};
    if (!body.position_code || !body.position_name) throw ApiError.validation("position_code / position_name 必填");
    const result = run(`
      INSERT INTO process_positions
        (position_code, position_name, department, skill_category, min_level, required_cert_type, description, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      String(body.position_code).trim(),
      String(body.position_name).trim(),
      body.department || null,
      body.skill_category || "general",
      Number(body.min_level || 1),
      body.required_cert_type || null,
      body.description || null,
      body.is_active === false ? 0 : 1,
    ]);
    res.status(201).json({ id: result.lastInsertRowid, created: true });
  }));

  app.put("/api/process-master/positions/:code", wrap((req, res) => {
    const body = req.body || {};
    const current = get("SELECT id FROM process_positions WHERE position_code = ?", [req.params.code]);
    if (!current) throw ApiError.notFound("岗位不存在");
    const fields = ["position_name", "department", "skill_category", "min_level", "required_cert_type", "description", "is_active"];
    const sets = [];
    const params = [];
    for (const field of fields) {
      if (body[field] !== undefined) {
        sets.push(`${field} = ?`);
        params.push(field === "is_active" ? safeBool(body[field]) : body[field]);
      }
    }
    if (!sets.length) throw ApiError.validation("无可更新字段");
    sets.push("updated_at = datetime('now')");
    params.push(req.params.code);
    const result = run(`UPDATE process_positions SET ${sets.join(", ")} WHERE position_code = ?`, params);
    res.json({ ok: true, changes: result.changes });
  }));

  app.delete("/api/process-master/positions/:code", wrap((req, res) => {
    const used = get(`
      SELECT
        (SELECT COUNT(*) FROM process_operation_templates WHERE required_position_code = ?) +
        (SELECT COUNT(*) FROM process_nodes WHERE required_position_code = ?) AS c
    `, [req.params.code, req.params.code]).c;
    if (used > 0) throw ApiError.conflict(`岗位正在被 ${used} 条工序/节点使用，已改为停用更安全`);
    run("DELETE FROM process_positions WHERE position_code = ?", [req.params.code]);
    res.json({ ok: true, deleted: true });
  }));

  app.get("/api/process-master/operations", wrap((req, res) => {
    const includeInactive = req.query.include_inactive === "1";
    const rows = all(`
      SELECT t.*, p.position_name,
             (SELECT COUNT(*) FROM process_nodes pn WHERE pn.operation_template_id = t.id) AS node_count
      FROM process_operation_templates t
      LEFT JOIN process_positions p ON p.position_code = t.required_position_code
      ${includeInactive ? "" : "WHERE t.is_active = 1"}
      ORDER BY t.sequence_hint, t.id
    `);
    res.json({ items: rows });
  }));

  app.post("/api/process-master/operations", wrap((req, res) => {
    const body = req.body || {};
    if (!body.operation_code || !body.operation_name) throw ApiError.validation("operation_code / operation_name 必填");
    const result = run(`
      INSERT INTO process_operation_templates
        (operation_code, operation_name, operation_type, category, default_station_type,
         required_skill, required_position_code, standard_hours, worker_count, qc_required,
         sop_required, drawing_required, sequence_hint, description, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      String(body.operation_code).trim(),
      String(body.operation_name).trim(),
      body.operation_type || "make",
      body.category || "general",
      body.default_station_type || null,
      body.required_skill || null,
      body.required_position_code || null,
      Number(body.standard_hours || 0),
      Number(body.worker_count || 1),
      safeBool(body.qc_required),
      safeBool(body.sop_required),
      safeBool(body.drawing_required !== false),
      Number(body.sequence_hint || 1),
      body.description || null,
      body.is_active === false ? 0 : 1,
    ]);
    res.status(201).json({ id: result.lastInsertRowid, created: true });
  }));

  app.put("/api/process-master/operations/:id", wrap((req, res) => {
    const body = req.body || {};
    const current = get("SELECT id FROM process_operation_templates WHERE id = ?", [req.params.id]);
    if (!current) throw ApiError.notFound("工序模板不存在");
    const fields = ["operation_code", "operation_name", "operation_type", "category", "default_station_type", "required_skill", "required_position_code", "standard_hours", "worker_count", "qc_required", "sop_required", "drawing_required", "sequence_hint", "description", "is_active"];
    const sets = [];
    const params = [];
    for (const field of fields) {
      if (body[field] !== undefined) {
        sets.push(`${field} = ?`);
        params.push(["qc_required", "sop_required", "is_active"].includes(field) ? safeBool(body[field]) : body[field]);
      }
    }
    if (!sets.length) throw ApiError.validation("无可更新字段");
    sets.push("updated_at = datetime('now')");
    params.push(req.params.id);
    const result = run(`UPDATE process_operation_templates SET ${sets.join(", ")} WHERE id = ?`, params);
    res.json({ ok: true, changes: result.changes });
  }));

  app.delete("/api/process-master/operations/:id", wrap((req, res) => {
    const used = get("SELECT COUNT(*) AS c FROM process_nodes WHERE operation_template_id = ?", [req.params.id]).c;
    if (used > 0) {
      run("UPDATE process_operation_templates SET is_active = 0, updated_at = datetime('now') WHERE id = ?", [req.params.id]);
      return res.json({ ok: true, disabled: true, reason: `已有 ${used} 个节点引用，已停用模板` });
    }
    run("DELETE FROM process_operation_templates WHERE id = ?", [req.params.id]);
    res.json({ ok: true, deleted: true });
  }));

  app.post("/api/process_nodes/:id/apply-template", wrap((req, res) => {
    const templateId = Number((req.body || {}).operation_template_id);
    if (!templateId) throw ApiError.validation("operation_template_id 必填");
    const result = applyTemplateToNode(db, Number(req.params.id), templateId);
    res.json({ ok: true, ...result });
  }));

  app.post("/api/process-master/validate-assignment", wrap((req, res) => {
    const result = validateAssignment(db, req.body || {});
    res.json(result);
  }));

  

  // --- Operation Docs CRUD ---
  app.get("/api/process-master/operations/:id/docs", wrap((req, res) => {
    const rows = all(`
      SELECT pod.*, d.title AS document_title, d.status AS document_status
      FROM process_operation_docs pod
      LEFT JOIN documents d ON d.id = pod.doc_id
      WHERE pod.operation_template_id = ?
      ORDER BY pod.doc_type, pod.id
    `, [req.params.id]);
    res.json({ items: rows });
  }));

  app.post("/api/process-master/operations/:id/docs", wrap((req, res) => {
    const body = req.body || {};
    if (!body.title) throw ApiError.validation("title required");
    const result = run(`
      INSERT INTO process_operation_docs
        (operation_template_id, doc_type, title, doc_id, is_required, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      Number(req.params.id),
      body.doc_type || "sop",
      String(body.title).trim(),
      body.doc_id || null,
      body.is_required !== false ? 1 : 0,
      body.notes || null,
    ]);
    res.status(201).json({ id: result.lastInsertRowid, created: true });
  }));

  app.put("/api/process-master/operations/:id/docs/:docId", wrap((req, res) => {
    const body = req.body || {};
    const sets = []; const params = [];
    for (const field of ["doc_type", "title", "doc_id", "is_required", "notes"]) {
      if (body[field] !== undefined) {
        sets.push(field + " = ?");
        params.push(field === "is_required" ? safeBool(body[field]) : body[field]);
      }
    }
    if (!sets.length) throw ApiError.validation("no fields to update");
    sets.push("updated_at = datetime('now')");
    params.push(req.params.docId, req.params.id);
    const result = run(
      "UPDATE process_operation_docs SET " + sets.join(", ") + " WHERE id = ? AND operation_template_id = ?",
      params
    );
    if (!result.changes) throw ApiError.notFound("doc binding not found");
    res.json({ ok: true, changes: result.changes });
  }));

  app.delete("/api/process-master/operations/:id/docs/:docId", wrap((req, res) => {
    const result = run(
      "DELETE FROM process_operation_docs WHERE id = ? AND operation_template_id = ?",
      [req.params.docId, req.params.id]
    );
    if (!result.changes) throw ApiError.notFound("doc binding not found");
    res.json({ ok: true, deleted: true });
  }));


  console.log("[processMasterService] Process operation/position master data registered");
}

module.exports = {
  register,
  runMigration,
  applyTemplateToNode,
  validateAssignment,
};
