'use strict';

// Shared seeder for cross-subsystem matrix tests.
// Writes an isolated SQLite DB via better-sqlite3, prints the DB path,
// then the test file picks it up via DB_PATH env var.
//
// Schema is intentionally minimal — only the columns the matrix service
// reads: subsystems(id/name/name_en/color/sort_order),
// process_nodes(id/equipment_instance_id/subsystem_id),
// process_node_deps(id/predecessor_id/successor_id/type).

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xsub-'));
const dbPath = path.join(tmpDir, 'seed.db');

const Database = require('better-sqlite3');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE equipment_subsystems (
    id INTEGER PRIMARY KEY,
    code TEXT,
    name_zh TEXT NOT NULL,
    name_en TEXT,
    sequence INTEGER DEFAULT 0,
    description TEXT,
    equipment_type_id INTEGER
  );
  CREATE TABLE equipment_instances (
    id INTEGER PRIMARY KEY,
    instance_name TEXT NOT NULL
  );
  CREATE TABLE process_nodes (
    id INTEGER PRIMARY KEY,
    equipment_instance_id INTEGER NOT NULL,
    subsystem_id INTEGER
  );
  CREATE TABLE process_dependencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    predecessor_id INTEGER NOT NULL,
    successor_id INTEGER NOT NULL,
    dep_type TEXT DEFAULT 'FS'
  );
`);

const insSub = db.prepare(
  'INSERT INTO equipment_subsystems (id, code, name_zh, name_en, sequence, description, equipment_type_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
);
[
  [1, 'CTH', '刀盘', 'Cutterhead', 1, 'cutterhead', 1],
  [2, 'MD',  '主驱动', 'Main Drive', 2, 'main drive', 1],
  [3, 'HYD', '液压', 'Hydraulics', 3, 'hydraulics', 1],
].forEach((r) => insSub.run(...r));

db.prepare('INSERT INTO equipment_instances (id, instance_name) VALUES (1, ?)').run('TBM-2026-001');
db.prepare('INSERT INTO equipment_instances (id, instance_name) VALUES (2, ?)').run('OTHER');

const insNode = db.prepare(
  'INSERT INTO process_nodes (id, equipment_instance_id, subsystem_id) VALUES (?, ?, ?)'
);
[
  [101, 1, 1],
  [102, 1, 1],
  [103, 1, 1],
  [201, 1, 2],
  [202, 1, 2],
  [301, 1, 3],
  [999, 1, null],
  [901, 2, 1],
].forEach((r) => insNode.run(...r));

const insDep = db.prepare(
  'INSERT INTO process_dependencies (predecessor_id, successor_id, dep_type) VALUES (?, ?, ?)'
);
[
  [101, 102, 'FS'],
  [102, 103, 'FS'],
  [201, 202, 'FS'],
  [103, 201, 'FS'],
  [202, 301, 'SS'],
  [301, 999, 'FF'],
  [999, 901, 'FS'],
].forEach((r) => insDep.run(...r));

process.stdout.write(JSON.stringify({ DB_PATH: dbPath, count: { subs: 3, nodes: 8, deps: 7 } }));
