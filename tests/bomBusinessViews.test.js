"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { buildBusinessViews } = require("../services/bomService");

function createDatabase() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE instance_bom (
      id INTEGER PRIMARY KEY,
      equipment_instance_id INTEGER NOT NULL,
      parent_id INTEGER,
      tier INTEGER NOT NULL,
      material_id INTEGER,
      part_number TEXT,
      quantity REAL NOT NULL DEFAULT 1,
      unit TEXT,
      scrap_factor REAL DEFAULT 1,
      category TEXT,
      material_grade TEXT,
      surface_treatment TEXT,
      brand_recommend TEXT,
      brand_grade TEXT,
      operation_id INTEGER,
      is_phantom INTEGER DEFAULT 0,
      weight REAL,
      unit_price REAL,
      notes TEXT
    );
    CREATE TABLE materials (
      id INTEGER PRIMARY KEY,
      material_code TEXT,
      material_name TEXT,
      spec TEXT,
      unit TEXT
    );
    INSERT INTO materials (id, material_code, material_name, spec, unit)
      VALUES (10, 'WG-001', '外购轴承', '6205-2RS', '件');
    INSERT INTO instance_bom (id, equipment_instance_id, tier, part_number, quantity, unit, category)
      VALUES (1, 1, 0, 'TBM-ROOT', 1, '台', '成品');
    INSERT INTO instance_bom (id, equipment_instance_id, parent_id, tier, part_number, quantity, unit, category)
      VALUES (2, 1, 1, 1, 'MOD-001', 1, '套', '自制部件');
    INSERT INTO instance_bom (
      id, equipment_instance_id, parent_id, tier, material_id,
      quantity, unit, category, unit_price
    ) VALUES (3, 1, 2, 2, 10, 2, '件', '外购成品', 50);
  `);
  return db;
}

test("BOM business views preserve purchase, assembly, process, and cost projections", () => {
  const db = createDatabase();
  const result = buildBusinessViews(db, 1);

  assert.equal(result.summary.total_nodes, 3);
  assert.equal(result.summary.total_cost, 100);
  assert.equal(result.summary.purchase_line_count, 1);
  assert.equal(result.summary.component_count, 1);
  assert.equal(result.purchase.items[0].quantity, 2);
  assert.equal(result.purchase.items[0].estimated_amount, 100);
  assert.equal(result.assembly.components[0].total_cost, 100);
  assert.equal(result.assembly.components[0].kit_status, "blocked");
  assert.equal(result.cost.total_cost, 100);
  assert.equal(result.process.summary.component_count, 1);
  db.close();
});
