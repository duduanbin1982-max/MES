const { EMPTY_TEMPLATE_SCOPE } = require("./catalog");

function tableColumns(db, table) {
  return new Set(db.prepare("PRAGMA table_info(" + table + ")").all().map((column) => column.name));
}

function hasTable(db, table) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
}

function addColumn(db, table, column, ddl) {
  const columns = tableColumns(db, table);
  if (!columns.has(column)) db.prepare("ALTER TABLE " + table + " ADD COLUMN " + ddl).run();
}

function migrateLegacyLifecycleStatuses(db) {
  if (!hasTable(db, "equipment_instances")) return;
  db.prepare("UPDATE equipment_instances SET lifecycle_stage = 'design' WHERE lifecycle_stage = 'designing'").run();
  db.prepare("UPDATE equipment_instances SET lifecycle_stage = 'procurement' WHERE lifecycle_stage = 'purchasing'").run();
  db.prepare("UPDATE equipment_instances SET status = 'design' WHERE status = 'designing'").run();
  db.prepare("UPDATE equipment_instances SET status = 'procurement' WHERE status = 'purchasing'").run();
}

function initEquipmentInstanceEnhancements(db) {
  const get = (sql, params = []) => db.prepare(sql).get(params);
  const run = (sql, params = []) => db.prepare(sql).run(params);

  addColumn(db, "equipment_instances", "project_no", "project_no TEXT");
  addColumn(db, "equipment_instances", "archive_status", "archive_status TEXT DEFAULT 'active'");
  addColumn(db, "equipment_instances", "archived_at", "archived_at TEXT");
  addColumn(db, "equipment_instances", "archived_by", "archived_by INTEGER");
  addColumn(db, "equipment_instances", "frozen_at", "frozen_at TEXT");
  addColumn(db, "equipment_instances", "frozen_by", "frozen_by INTEGER");
  addColumn(db, "equipment_instances", "freeze_snapshot", "freeze_snapshot TEXT");
  addColumn(db, "equipment_instances", "source_template_id", "source_template_id INTEGER");

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
  db.exec("CREATE INDEX IF NOT EXISTS idx_equipment_instance_milestones_instance ON equipment_instance_milestones(project_id)");
  db.exec(`CREATE TABLE IF NOT EXISTS document_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    equipment_instance_id INTEGER NOT NULL,
    folder_name TEXT NOT NULL,
    folder_type TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(equipment_instance_id, folder_name)
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_document_folders_instance ON document_folders(equipment_instance_id)");
  db.exec(`CREATE TABLE IF NOT EXISTS equipment_instance_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_code TEXT NOT NULL UNIQUE,
    template_name TEXT NOT NULL,
    category TEXT DEFAULT 'TBM',
    version TEXT DEFAULT 'A0',
    source_instance_id INTEGER,
    copy_scope TEXT NOT NULL,
    status TEXT DEFAULT 'published',
    description TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_equipment_instance_templates_status ON equipment_instance_templates(status)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_equipment_instance_templates_source ON equipment_instance_templates(source_instance_id)");

  const defaultTemplate = get("SELECT id FROM equipment_instance_templates WHERE template_code = 'TPL-TBM-STD'");
  if (!defaultTemplate) {
    run(
      "INSERT INTO equipment_instance_templates (template_code, template_name, category, version, source_instance_id, copy_scope, status, description) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)",
      ["TPL-TBM-STD", "标准 TBM 项目模板", "TBM", "A0", JSON.stringify(EMPTY_TEMPLATE_SCOPE), "published", "空白标准模板：生成里程碑、BOM 空壳和文档目录"]
    );
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_equipment_instances_project_no ON equipment_instances(project_no)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_equipment_instances_archive_status ON equipment_instances(archive_status)");
  migrateLegacyLifecycleStatuses(db);
}

module.exports = {
  initEquipmentInstanceEnhancements,
};
