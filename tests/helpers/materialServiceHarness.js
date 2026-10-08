'use strict';

const Database = require('better-sqlite3');

function freshDb() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE materials (id INTEGER PRIMARY KEY, material_code TEXT UNIQUE NOT NULL, material_name TEXT NOT NULL, spec TEXT, unit TEXT, safety_stock REAL DEFAULT 0, reorder_point REAL DEFAULT 0)');
  db.exec('CREATE TABLE material_lots (id INTEGER PRIMARY KEY AUTOINCREMENT, material_id INTEGER NOT NULL, lot_no TEXT NOT NULL, supplier TEXT, heat_no TEXT, certificate_no TEXT, received_date TEXT, quantity REAL, unit TEXT, quality_status TEXT DEFAULT "pending", notes TEXT)');
  db.exec('CREATE TABLE inventory (id INTEGER PRIMARY KEY AUTOINCREMENT, material_lot_id INTEGER NOT NULL, location TEXT NOT NULL, quantity REAL NOT NULL, unit TEXT, status TEXT DEFAULT "available", last_updated TEXT DEFAULT "2026-01-01 00:00:00")');
  db.exec('CREATE TABLE material_movements (id INTEGER PRIMARY KEY AUTOINCREMENT, material_lot_id INTEGER NOT NULL, movement_type TEXT NOT NULL, quantity REAL NOT NULL, unit TEXT, from_location TEXT, to_location TEXT, work_order_id INTEGER, project_id INTEGER, operator_id INTEGER, notes TEXT, created_at TEXT DEFAULT "2026-01-01 00:00:00")');
  db.exec('CREATE TABLE work_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, wo_code TEXT)');
  db.exec('CREATE TABLE material_units (id INTEGER PRIMARY KEY AUTOINCREMENT, material_id INTEGER NOT NULL, from_unit TEXT NOT NULL, to_unit TEXT NOT NULL, factor REAL NOT NULL, notes TEXT, created_at TEXT DEFAULT \'2026-01-01 00:00:00\', UNIQUE(material_id, from_unit, to_unit))');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT)');
  return db;
}

function makeApp(db) {
  const material = require('../../services/material');
  const materialService = require('../../services/materialService');
  const routes = {};
  const bind = (method) => (p, h) => {
    routes[method.toUpperCase() + ' ' + p] = {
      method,
      handler: (req, res) => h(req, res, (err) => {
        if (!err) return;
        res.status(err.status || 500).json({ error: err.message, code: err.code || 'INTERNAL_ERROR', details: err.details || null });
      }),
    };
  };
  const app = { get: bind('get'), post: bind('post'), put: bind('put'), patch: bind('patch'), delete: bind('delete') };
  material.register(app, db);
  materialService.register(app, db);
  return { app, routes };
}

function mkReqRes(body, opts = {}) {
  const req = { body, query: opts.query || {}, params: opts.params || {}, user: 'user' in opts ? opts.user : { uid: 1, role: 'admin', permissions: ['*'] } };
  let status = 200, json = null;
  const res = { status: (s) => { status = s; return res; }, json: (j) => { json = j; return res; }, _get: () => ({ status, json }) };
  return { req, res, getResult: () => ({ status, json }) };
}

function seedDefaultMaterialLot(db) {
  db.prepare('INSERT INTO materials (id, material_code, material_name) VALUES (?, ?, ?)').run(1, 'T-001', '测试物料');
  db.prepare('INSERT INTO material_lots (id, material_id, lot_no, quantity) VALUES (?, ?, ?, ?)').run(1, 1, 'LOT-001', 100);
}

module.exports = {
  freshDb,
  makeApp,
  mkReqRes,
  seedDefaultMaterialLot,
};
