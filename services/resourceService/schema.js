"use strict";

const { STATION_TYPES, inferStationType } = require("./catalog");

function runMigration(db) {
  const columnNames = (table) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
  const addColumn = (table, name, definition) => {
    if (!columnNames(table).has(name)) db.prepare(`ALTER TABLE ${table} ADD COLUMN ${definition}`).run();
  };

  [
    { name: "workstation_id", definition: "workstation_id INTEGER REFERENCES workstations(id)" },
    { name: "availability", definition: "availability TEXT DEFAULT 'offline'" },
    { name: "skills", definition: "skills TEXT" },
  ].forEach((column) => addColumn("users", column.name, column.definition));

  [
    { name: "station_type", definition: "station_type TEXT DEFAULT 'general'" },
    { name: "status", definition: "status TEXT DEFAULT 'available'" },
    { name: "capability_tags", definition: "capability_tags TEXT" },
    { name: "required_skills", definition: "required_skills TEXT" },
    { name: "max_workers", definition: "max_workers INTEGER DEFAULT 1" },
    { name: "location", definition: "location TEXT" },
    { name: "shift", definition: "shift TEXT DEFAULT 'day'" },
    { name: "notes", definition: "notes TEXT" },
  ].forEach((column) => addColumn("workstations", column.name, column.definition));

  db.prepare(`
    CREATE TABLE IF NOT EXISTS resource_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      workstation_id INTEGER,
      equipment_instance_id INTEGER,
      assigned_at TEXT DEFAULT (datetime('now')),
      released_at TEXT,
      status TEXT DEFAULT 'active',
      notes TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (workstation_id) REFERENCES workstations(id),
      FOREIGN KEY (equipment_instance_id) REFERENCES equipment_instances(id)
    )
  `).run();
  addColumn("resource_allocations", "work_order_id", "work_order_id INTEGER");

  db.prepare("UPDATE workstations SET station_type = NULL WHERE code LIKE 'WS-SMOKE-%'").run();
  if (process.env.NODE_ENV !== "production") db.prepare("DELETE FROM workstations WHERE code LIKE 'WS-SMOKE-%'").run();

  const update = db.prepare("UPDATE workstations SET station_type = ?, status = COALESCE(status, 'available'), max_workers = COALESCE(max_workers, capacity_per_day, 1), required_skills = COALESCE(required_skills, ?), capability_tags = COALESCE(capability_tags, ?), shift = COALESCE(shift, 'day') WHERE id = ?");
  for (const row of db.prepare("SELECT * FROM workstations").all()) {
    const type = row.station_type && row.station_type !== "general" ? row.station_type : inferStationType(row);
    const defaults = STATION_TYPES.find((item) => item.value === type)?.default_skills || [];
    update.run(type, JSON.stringify(defaults), JSON.stringify(defaults), row.id);
  }

  const hasInspection = db.prepare("SELECT id FROM workstations WHERE is_active = 1 AND (station_type = 'inspection' OR name LIKE '%检验%' OR workshop LIKE '%检验%' OR workshop LIKE '%质检%') LIMIT 1").get();
  if (!hasInspection) {
    db.prepare(`
      INSERT INTO workstations (code, name, workshop, capacity_per_day, is_active, station_type, status, capability_tags, required_skills, max_workers, location, shift, notes)
      VALUES ('WS-QC-01', '检验工位 1', '质检', 12, 1, 'inspection', 'available', ?, ?, 3, '质检区', 'day', '补齐标准四类工位：检验/探伤/尺寸测量')
    `).run(JSON.stringify(["qc", "ndt", "measurement"]), JSON.stringify(["qc", "ndt", "measurement"]));
  }

  db.prepare("CREATE INDEX IF NOT EXISTS idx_workstations_station_type ON workstations(station_type)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_workstations_status ON workstations(status)").run();
}

module.exports = { runMigration };
