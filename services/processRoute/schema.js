"use strict";
// services/processRoute/schema.js
// 2026-11-07 工艺树升级：路线模板/版本/变更/ITP/执行事件/阶段与成本所需结构
// 说明：仅新增表与列，不改旧字段语义；幂等执行。

function tableExists(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function columnExists(db, table, column) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
  } catch (_error) {
    return false;
  }
}

function addColumn(db, table, column, ddl) {
  if (!columnExists(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

function ensureProcessRouteSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS process_route_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_code TEXT NOT NULL UNIQUE,
      template_name TEXT NOT NULL,
      part_category TEXT,
      material_category TEXT,
      phase_code TEXT,
      description TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS process_route_template_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL,
      sequence INTEGER NOT NULL,
      operation_name TEXT NOT NULL,
      operation_type TEXT,
      phase_code TEXT,
      standard_hours REAL DEFAULT 0,
      worker_count INTEGER DEFAULT 1,
      default_station_type TEXT,
      required_skill TEXT,
      required_position_code TEXT,
      qc_required INTEGER DEFAULT 0,
      sop_required INTEGER DEFAULT 0,
      drawing_required INTEGER DEFAULT 0,
      is_external INTEGER DEFAULT 0,
      operation_template_id INTEGER,
      dependency_type TEXT DEFAULT 'FS',
      lag_hours REAL DEFAULT 0,
      description TEXT,
      UNIQUE (template_id, sequence)
    );

    CREATE TABLE IF NOT EXISTS process_route_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_instance_id INTEGER NOT NULL,
      version_no TEXT NOT NULL,
      status TEXT DEFAULT 'draft',
      snapshot_json TEXT NOT NULL,
      node_count INTEGER DEFAULT 0,
      dependency_count INTEGER DEFAULT 0,
      note TEXT,
      released_by INTEGER,
      released_at TEXT,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE (equipment_instance_id, version_no)
    );

    CREATE TABLE IF NOT EXISTS process_route_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_instance_id INTEGER NOT NULL,
      change_no TEXT NOT NULL,
      title TEXT NOT NULL,
      reason TEXT,
      status TEXT DEFAULT 'draft',
      impact_json TEXT,
      requested_by INTEGER,
      reviewed_by INTEGER,
      reviewed_at TEXT,
      review_note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS process_operation_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      process_node_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT,
      operator_id INTEGER,
      hours_worked REAL DEFAULT 0,
      quantity REAL,
      reason TEXT,
      meta_json TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS process_itp_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      process_node_id INTEGER NOT NULL,
      point_no INTEGER DEFAULT 1,
      point_type TEXT DEFAULT 'self',
      requirement TEXT,
      status TEXT DEFAULT 'pending',
      checked_by INTEGER,
      checked_at TEXT,
      remark TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_process_nodes_instance ON process_nodes (equipment_instance_id);
    CREATE INDEX IF NOT EXISTS idx_process_nodes_bom ON process_nodes (bom_node_id);
    CREATE INDEX IF NOT EXISTS idx_route_template_steps_template ON process_route_template_steps (template_id, sequence);
    CREATE INDEX IF NOT EXISTS idx_route_versions_instance ON process_route_versions (equipment_instance_id, version_no);
    CREATE INDEX IF NOT EXISTS idx_operation_events_node ON process_operation_events (process_node_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_itp_points_node ON process_itp_points (process_node_id);
  `);

  if (tableExists(db, "process_dependencies")) {
    db.exec("CREATE INDEX IF NOT EXISTS idx_process_dependencies_instance ON process_dependencies (equipment_instance_id)");
  }

  // process_nodes 升级列
  addColumn(db, "process_nodes", "route_version_id", "INTEGER");
  addColumn(db, "process_nodes", "route_template_id", "INTEGER");
  addColumn(db, "process_nodes", "is_external", "INTEGER DEFAULT 0");
  addColumn(db, "process_nodes", "rework_of_node_id", "INTEGER");
  addColumn(db, "process_nodes", "node_code", "TEXT");
  // 节点二维码编码：PN-<id>，历史节点回填
  db.exec("UPDATE process_nodes SET node_code = 'PN-' || id WHERE node_code IS NULL OR node_code = ''");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_process_nodes_code ON process_nodes (node_code)");

  seedDefaultTemplate(db);
}

// 如果没有任何路线模板，用现有工序模板生成一个通用模板，避免空模板导致无法生成
function seedDefaultTemplate(db) {
  try {
    const count = db.prepare("SELECT COUNT(*) c FROM process_route_templates").get().c;
    if (count > 0) return;
    if (!tableExists(db, "process_operation_templates")) return;
    const operations = db.prepare("SELECT * FROM process_operation_templates WHERE is_active = 1 ORDER BY sequence_hint, id").all();
    if (!operations.length) return;
    const tx = db.transaction(() => {
      const template = db.prepare(`
        INSERT INTO process_route_templates (template_code, template_name, part_category, material_category, phase_code, description)
        VALUES ('TPL-GENERIC', '通用部件工艺路线', '*', '*', 'fabrication', '由工序模板自动生成的通用路线，可在模板管理中按部件类别细分')
      `).run();
      const insertStep = db.prepare(`
        INSERT INTO process_route_template_steps
          (template_id, sequence, operation_name, operation_type, phase_code, standard_hours, worker_count,
           default_station_type, required_skill, required_position_code, qc_required, sop_required, drawing_required,
           is_external, operation_template_id, dependency_type, lag_hours, description)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'FS', 0, ?)
      `);
      operations.forEach((operation, index) => {
        insertStep.run(
          template.lastInsertRowid,
          index + 1,
          operation.operation_name,
          operation.operation_type,
          index < 2 ? "preparation" : (operation.operation_type === "qc" ? "inspection" : "fabrication"),
          Number(operation.standard_hours) || 0,
          Number(operation.worker_count) || 1,
          operation.default_station_type || null,
          operation.required_skill || null,
          operation.required_position_code || null,
          Number(operation.qc_required) ? 1 : 0,
          Number(operation.sop_required) ? 1 : 0,
          Number(operation.drawing_required) ? 1 : 0,
          0,
          operation.id,
          operation.description || operation.operation_name,
        );
      });
    });
    tx();
  } catch (_error) {
    // 结构升级阶段允许种子失败，不阻断主流程
  }
}

module.exports = { ensureProcessRouteSchema, tableExists, columnExists };
