"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const supplierCollaboration = require("../services/supplierCollaborationService");

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE purchase_receiving (id INTEGER PRIMARY KEY, po_id INTEGER, po_item_id INTEGER, received_qty REAL, quality_status TEXT, inspected_by INTEGER, lot_no TEXT, warehouse_location TEXT, material_lot_id INTEGER, inventory_id INTEGER, inspection_id INTEGER);
    CREATE TABLE material_lots (id INTEGER PRIMARY KEY, quality_status TEXT);
    CREATE TABLE inventory (id INTEGER PRIMARY KEY, status TEXT, last_updated TEXT);
  `);
  db.prepare("INSERT INTO material_lots VALUES (10, 'pending')").run();
  db.prepare("INSERT INTO inventory (id, status) VALUES (20, 'quarantined')").run();
  db.prepare("INSERT INTO purchase_receiving VALUES (1, 2, 3, 5, 'pending', NULL, 'LOT-1', 'Q-01', 10, 20, NULL)").run();
  return db;
}

test("passed IQC releases quarantined inventory", () => {
  const db = makeDb();
  const receipt = db.prepare("SELECT * FROM purchase_receiving WHERE id=1").get();
  const result = supplierCollaboration.applyIncomingInspectionResult(db, receipt, 99, "pass", 7);
  assert.deepEqual(result, { receiving_id: 1, quality_status: "passed", inventory_status: "available" });
  assert.equal(db.prepare("SELECT quality_status FROM material_lots WHERE id=10").get().quality_status, "passed");
  assert.equal(db.prepare("SELECT status FROM inventory WHERE id=20").get().status, "available");
  assert.equal(db.prepare("SELECT inspection_id FROM purchase_receiving WHERE id=1").get().inspection_id, 99);
});

test("failed IQC keeps inventory quarantined", () => {
  const db = makeDb();
  const receipt = db.prepare("SELECT * FROM purchase_receiving WHERE id=1").get();
  const result = supplierCollaboration.applyIncomingInspectionResult(db, receipt, 100, "fail", 8);
  assert.equal(result.inventory_status, "quarantined");
  assert.equal(db.prepare("SELECT quality_status FROM material_lots WHERE id=10").get().quality_status, "failed");
  assert.equal(db.prepare("SELECT status FROM inventory WHERE id=20").get().status, "quarantined");
});
