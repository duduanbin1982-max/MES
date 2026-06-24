'use strict';
const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const path = require("path");
const svcPath = path.resolve(__dirname, "../services/process/params.js");
function makeDb() {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE process_params (id INTEGER PRIMARY KEY AUTOINCREMENT, process_node_id INTEGER NOT NULL, recorded_by INTEGER, recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, current_amp REAL, voltage_v REAL, speed_mm_min REAL, temperature_c REAL, pressure_mpa REAL, feed_rate REAL, custom_json TEXT, notes TEXT)");
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, full_name TEXT)");
  return db;
}
function makeApp() { const r = {}; for (const m of ["get","post","put","delete"]) r[m] = (p, ...hs) => { r[m.toUpperCase() + " " + p] = hs; }; return r; }
function call(app, method, p, body) {
  const pathTpl = p.replace(/\d+/g, ":id");
  let hs = app[method.toUpperCase() + " " + p] || app[method.toUpperCase() + " " + pathTpl];
  if (!hs) throw new Error("no route: " + method + " " + p);
  const m = pathTpl.match(/:([a-zA-Z_]+)/);
  const params = {}; if (m) { const parts = p.split("/"); const idx = pathTpl.split("/").indexOf(":" + m[1]); if (idx >= 0) params[m[1]] = parts[idx]; }
  const req = { method, query: {}, body: body || {}, params };
  let s = 200, b = null;
  const res = { status(c) { s = c; return this; }, json(x) { b = x; return this; } };
  for (const h of hs) h(req, res);
  return { status: s, body: b };
}
test("empty process_params returns []", () => {
  const db = makeDb(); const app = makeApp(); delete require.cache[svcPath]; require(svcPath).register(app, db);
  const r = call(app, "get", "/api/process_nodes/1/params");
  assert.equal(r.status, 200); assert.deepEqual(r.body, []);
});
test("POST inserts param, GET returns it joined with recorder_name", () => {
  const db = makeDb(); db.prepare("INSERT INTO users (id, full_name) VALUES (?, ?)").run(4, "王师傅");
  const app = makeApp(); delete require.cache[svcPath]; require(svcPath).register(app, db);
  const post = call(app, "post", "/api/process_nodes/134/params", { current_amp: 220, voltage_v: 28, speed_mm_min: 450, temperature_c: 85, recorded_by: 4, notes: "P2-#8 unit test" });
  assert.equal(post.status, 200); assert.equal(typeof post.body.id, "number");
  const get = call(app, "get", "/api/process_nodes/134/params");
  assert.equal(get.status, 200); assert.equal(get.body.length, 1);
  const row = get.body[0];
  assert.equal(row.process_node_id, 134);
  assert.equal(row.current_amp, 220);
  assert.equal(row.voltage_v, 28);
  assert.equal(row.recorder_name, "王师傅");
});
test("GET filters by process_node_id, other nodes excluded", () => {
  const db = makeDb(); db.prepare("INSERT INTO process_params (process_node_id, current_amp) VALUES (?, ?)").run(1, 100);
  db.prepare("INSERT INTO process_params (process_node_id, current_amp) VALUES (?, ?)").run(1, 110);
  db.prepare("INSERT INTO process_params (process_node_id, current_amp) VALUES (?, ?)").run(2, 200);
  const app = makeApp(); delete require.cache[svcPath]; require(svcPath).register(app, db);
  const r = call(app, "get", "/api/process_nodes/1/params");
  assert.equal(r.body.length, 2);
  assert.ok(r.body.every(p => p.process_node_id === 1));
});
test("POST with missing optional fields stored as null", () => {
  const db = makeDb(); const app = makeApp(); delete require.cache[svcPath]; require(svcPath).register(app, db);
  const post = call(app, "post", "/api/process_nodes/7/params", { notes: "minimal" });
  assert.equal(post.status, 200);
  const get = call(app, "get", "/api/process_nodes/7/params");
  assert.equal(get.body.length, 1);
  assert.equal(get.body[0].notes, "minimal");
  assert.equal(get.body[0].current_amp, null);
  assert.equal(get.body[0].voltage_v, null);
});
