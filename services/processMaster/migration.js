"use strict";

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
  if (!ALLOWED_TABLES.has(table)) throw new Error("Invalid table name: " + table);
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
}

function addColumn(db, table, name, ddl) {
  if (!columnNames(db, table).has(name)) db.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run();
}

const ALLOWED_TABLES = new Set([
  "process_nodes",
  "process_operation_templates",
]);

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

  for (const column of [
    ["operation_template_id", "operation_template_id INTEGER"],
    ["required_position_code", "required_position_code TEXT"],
    ["worker_count", "worker_count INTEGER DEFAULT 1"],
    ["qc_required", "qc_required INTEGER DEFAULT 0"],
    ["sop_required", "sop_required INTEGER DEFAULT 0"],
  ]) addColumn(db, "process_nodes", column[0], column[1]);
  addColumn(db, "process_nodes", "drawing_required", "drawing_required INTEGER DEFAULT 0");
  addColumn(db, "process_operation_templates", "drawing_required", "drawing_required INTEGER NOT NULL DEFAULT 0");

  const positionInsert = db.prepare(`
    INSERT OR IGNORE INTO process_positions
      (position_code, position_name, department, skill_category, min_level, required_cert_type, description)
    VALUES (@position_code, @position_name, @department, @skill_category, @min_level, @required_cert_type, @description)
  `);
  for (const row of DEFAULT_POSITIONS) positionInsert.run(row);

  const operationInsert = db.prepare(`
    INSERT OR IGNORE INTO process_operation_templates
      (operation_code, operation_name, operation_type, category, default_station_type, required_skill,
       required_position_code, standard_hours, worker_count, qc_required, sop_required, drawing_required, sequence_hint, description)
    VALUES (@operation_code, @operation_name, @operation_type, @category, @default_station_type, @required_skill,
       @required_position_code, @standard_hours, @worker_count, @qc_required, @sop_required, @drawing_required, @sequence_hint, @description)
  `);
  for (const row of DEFAULT_OPERATIONS) operationInsert.run(row);

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

module.exports = { runMigration };
