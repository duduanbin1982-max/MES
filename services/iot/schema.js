"use strict";

const ALLOWED_TABLES = new Set(["iot_devices", "iot_data_points", "iot_readings", "iot_alarms"]);

function columnNames(db, table) {
  if (!ALLOWED_TABLES.has(table)) throw new Error(`Invalid table name: ${table}`);
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
}

function addColumn(db, table, name, definition) {
  if (!ALLOWED_TABLES.has(table)) throw new Error(`Invalid table name: ${table}`);
  if (!columnNames(db, table).has(name)) db.prepare(`ALTER TABLE ${table} ADD COLUMN ${definition}`).run();
}

function runMigration(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS iot_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_code TEXT NOT NULL UNIQUE,
      device_name TEXT NOT NULL,
      device_type TEXT NOT NULL DEFAULT 'sensor',
      protocol TEXT NOT NULL DEFAULT 'modbus',
      connection_string TEXT,
      ip_address TEXT,
      port INTEGER,
      slave_id INTEGER,
      register_start INTEGER,
      register_count INTEGER,
      scan_interval_ms INTEGER NOT NULL DEFAULT 5000,
      equipment_id INTEGER,
      production_equipment_id INTEGER,
      location TEXT,
      manufacturer TEXT,
      model TEXT,
      status TEXT NOT NULL DEFAULT 'offline',
      last_seen_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (equipment_id) REFERENCES equipment_instances(id)
    );
    CREATE TABLE IF NOT EXISTS iot_data_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      point_name TEXT NOT NULL,
      point_code TEXT NOT NULL,
      data_type TEXT NOT NULL DEFAULT 'float',
      unit TEXT,
      register_offset INTEGER,
      min_value REAL, max_value REAL,
      alarm_low REAL, alarm_high REAL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (device_id) REFERENCES iot_devices(id) ON DELETE CASCADE,
      UNIQUE(device_id, point_code)
    );
    CREATE TABLE IF NOT EXISTS iot_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      point_id INTEGER,
      value REAL,
      quality TEXT NOT NULL DEFAULT 'good',
      read_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (device_id) REFERENCES iot_devices(id),
      FOREIGN KEY (point_id) REFERENCES iot_data_points(id)
    );
    CREATE TABLE IF NOT EXISTS iot_alarms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      point_id INTEGER,
      alarm_type TEXT NOT NULL,
      threshold_value REAL,
      actual_value REAL,
      message TEXT,
      severity TEXT NOT NULL DEFAULT 'warning',
      acknowledged INTEGER NOT NULL DEFAULT 0,
      acknowledged_by INTEGER,
      acknowledged_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (device_id) REFERENCES iot_devices(id),
      FOREIGN KEY (point_id) REFERENCES iot_data_points(id)
    );
    CREATE INDEX IF NOT EXISTS idx_iot_readings_device ON iot_readings(device_id, read_at);
    CREATE INDEX IF NOT EXISTS idx_iot_readings_point ON iot_readings(point_id, read_at);
    CREATE INDEX IF NOT EXISTS idx_iot_alarms_device ON iot_alarms(device_id, acknowledged);
    CREATE INDEX IF NOT EXISTS idx_iot_devices_status ON iot_devices(status);
  `);
  addColumn(db, "iot_devices", "production_equipment_id", "production_equipment_id INTEGER");
  addColumn(db, "iot_readings", "source", "source TEXT NOT NULL DEFAULT 'external_adapter'");
  addColumn(db, "iot_alarms", "source", "source TEXT NOT NULL DEFAULT 'external_adapter'");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_iot_readings_source_time ON iot_readings(source, read_at);
    CREATE INDEX IF NOT EXISTS idx_iot_alarms_source_time ON iot_alarms(source, created_at);
  `);
}

module.exports = { addColumn, columnNames, runMigration };
