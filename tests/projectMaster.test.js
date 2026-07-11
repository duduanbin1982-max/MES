"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { migrateLegacyProjectTables } = require("../services/projectMasterService");

test("empty legacy project tables become read-only canonical views", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT, customer_name TEXT, customer_contact TEXT, site_location TEXT, contract_no TEXT, equipment_model_id INTEGER, start_date TEXT, planned_start TEXT, planned_end TEXT, actual_start TEXT, actual_end TEXT, status TEXT, progress_pct REAL, contract_amount REAL, notes TEXT, created_at TEXT, updated_at TEXT, project_no TEXT);
    CREATE TABLE instance_milestones (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, phase_code TEXT, phase_name TEXT, sequence INTEGER, planned_start TEXT, planned_end TEXT, actual_start TEXT, actual_end TEXT, status TEXT, notes TEXT);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, project_code TEXT);
    CREATE TABLE project_milestones (id INTEGER PRIMARY KEY, project_id INTEGER);
    INSERT INTO equipment_instances (id,instance_code,instance_name,customer_name,status) VALUES (1,'TBM-1','Test','Customer','design');
  `);
  const result = migrateLegacyProjectTables(db);
  assert.equal(result.migrated, true);
  assert.equal(db.prepare("SELECT type FROM sqlite_master WHERE name='projects'").get().type, "view");
  assert.equal(db.prepare("SELECT project_code FROM projects").get().project_code, "TBM-1");
  assert.equal(db.prepare("SELECT type FROM sqlite_master WHERE name='projects_legacy'").get().type, "table");
});

test("non-empty legacy projects are not migrated automatically", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE projects (id INTEGER PRIMARY KEY, project_code TEXT); INSERT INTO projects VALUES (1,'P1')");
  const result = migrateLegacyProjectTables(db);
  assert.equal(result.migrated, false);
  assert.match(result.reason, /contains data/);
});
