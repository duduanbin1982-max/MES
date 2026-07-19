'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  buildPickList,
  executePick,
  executeReturn,
  getReturnableLots,
} = require('../services/pickService');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE work_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wo_code TEXT,
      equipment_instance_id INTEGER,
      title TEXT,
      quantity_planned INTEGER DEFAULT 1
    );
    CREATE TABLE materials (
      id INTEGER PRIMARY KEY,
      material_code TEXT,
      material_name TEXT,
      spec TEXT,
      unit TEXT
    );
    CREATE TABLE instance_bom (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_instance_id INTEGER,
      material_id INTEGER,
      quantity REAL,
      unit TEXT,
      scrap_factor REAL DEFAULT 1,
      tier INTEGER,
      part_number TEXT,
      category TEXT,
      storage_location TEXT,
      is_phantom INTEGER DEFAULT 0,
      is_alternative INTEGER DEFAULT 0
    );
    CREATE TABLE material_lots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      material_id INTEGER,
      lot_no TEXT,
      supplier TEXT,
      heat_no TEXT,
      received_date TEXT,
      quantity REAL,
      unit TEXT
    );
    CREATE TABLE inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      material_lot_id INTEGER,
      location TEXT,
      quantity REAL,
      unit TEXT,
      status TEXT DEFAULT 'available',
      last_updated TEXT DEFAULT '2026-01-01 00:00:00'
    );
    CREATE TABLE material_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      material_lot_id INTEGER,
      movement_type TEXT,
      quantity REAL,
      unit TEXT,
      from_location TEXT,
      to_location TEXT,
      work_order_id INTEGER,
      operator_id INTEGER,
      notes TEXT,
      created_at TEXT DEFAULT '2026-01-01 00:00:00'
    );
  `);
  db.prepare("INSERT INTO work_orders (id, wo_code, equipment_instance_id, title, quantity_planned) VALUES (1, 'WO-P1', 10, '刀盘装配', 2)").run();
  db.prepare("INSERT INTO materials (id, material_code, material_name, unit) VALUES (1, 'MAT-A', '钢板', '件')").run();
  db.prepare("INSERT INTO instance_bom (equipment_instance_id, material_id, quantity, unit, scrap_factor, tier, part_number, storage_location) VALUES (10, 1, 3, '件', 1, 2, 'PN-A', '主仓库-A-01')").run();
  db.prepare("INSERT INTO material_lots (id, material_id, lot_no, received_date, quantity, unit) VALUES (101, 1, 'LOT-OLD', '2026-01-01', 4, '件')").run();
  db.prepare("INSERT INTO material_lots (id, material_id, lot_no, received_date, quantity, unit) VALUES (102, 1, 'LOT-NEW', '2026-02-01', 5, '件')").run();
  db.prepare("INSERT INTO inventory (material_lot_id, location, quantity, unit, status) VALUES (101, '主仓库-A-01', 4, '件', 'available')").run();
  db.prepare("INSERT INTO inventory (material_lot_id, location, quantity, unit, status) VALUES (102, '主仓库-A-01', 5, '件', 'available')").run();
  return db;
}

test('P1.PICK.1 pick-list multiplies BOM demand by work order quantity and suggests FIFO lots', () => {
  const db = freshDb();
  const pickList = buildPickList(db, 1);
  assert.equal(pickList.work_order_qty, 2);
  assert.equal(pickList.items[0].bom_required, 6);
  assert.equal(pickList.items[0].remaining, 6);
  assert.equal(pickList.items[0].suggested_pick_qty, 6);
  assert.deepEqual(pickList.items[0].suggested_allocations.map(item => [item.lot_id, item.quantity]), [[101, 4], [102, 2]]);
});

test('P1.PICK.2 executePick splits issue across suggested lots and updates net remaining', () => {
  const db = freshDb();
  const result = executePick(db, 1, { items: [{ material_id: 1, quantity: 6 }] }, { id: 1 });
  assert.equal(result.results.length, 2);
  assert.equal(result.errors.length, 0);
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE material_lot_id = 101").get().quantity, 0);
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE material_lot_id = 102").get().quantity, 3);
  assert.equal(buildPickList(db, 1).items[0].status, 'done');
});

test('P1.PICK.3 executeReturn blocks over-return and reopens remaining demand after valid return', () => {
  const db = freshDb();
  executePick(db, 1, { items: [{ material_id: 1, quantity: 6 }] }, { id: 1 });
  const blocked = executeReturn(db, 1, { items: [{ lot_id: 101, quantity: 5 }] }, { id: 1 });
  assert.equal(blocked.results.length, 0);
  assert.match(blocked.errors[0].error, /超过可退数量/);

  const returned = executeReturn(db, 1, { items: [{ lot_id: 101, quantity: 2, reason: '余料退库' }] }, { id: 1 });
  assert.equal(returned.results.length, 1);
  assert.equal(buildPickList(db, 1).items[0].remaining, 2);
  assert.deepEqual(
    getReturnableLots(db, 1).map(row => [row.lot_id, row.returnable_qty]).sort((a, b) => a[0] - b[0]),
    [[101, 2], [102, 2]]
  );
});
