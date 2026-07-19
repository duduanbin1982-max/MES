"use strict";

function initQualitySchema(run) {
  run(`CREATE TABLE IF NOT EXISTS ncr_reports (
    id INTEGER PRIMARY KEY,
    ncr_code TEXT UNIQUE,
    source_type TEXT,
    source_id INTEGER,
    equipment_instance_id INTEGER,
    part_name TEXT,
    defect_desc TEXT NOT NULL,
    defect_qty INTEGER,
    severity TEXT DEFAULT 'minor',
    disposition TEXT DEFAULT 'pending',
    disposition_by INTEGER,
    disposition_at TEXT,
    root_cause TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    closed_at TEXT
  )`);

  run(`CREATE TABLE IF NOT EXISTS capa_actions (
    id INTEGER PRIMARY KEY,
    ncr_id INTEGER,
    action_type TEXT NOT NULL,
    action_desc TEXT NOT NULL,
    assigned_to INTEGER,
    due_date TEXT,
    status TEXT DEFAULT 'open',
    completed_at TEXT,
    verified_by INTEGER,
    verified_at TEXT,
    effectiveness TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  run(`CREATE TABLE IF NOT EXISTS inspection_templates (
    id INTEGER PRIMARY KEY,
    template_name TEXT NOT NULL,
    equipment_type_id INTEGER,
    category TEXT,
    check_items TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  run(`CREATE TABLE IF NOT EXISTS ncr_rechecks (
    id INTEGER PRIMARY KEY,
    ncr_id INTEGER NOT NULL,
    result TEXT NOT NULL,
    inspector_id INTEGER,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
}

module.exports = { initQualitySchema };
