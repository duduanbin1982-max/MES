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
  db.exec("CREATE TABLE process_nodes (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, operation_name TEXT, operation_template_id INTEGER)");
  db.exec("CREATE TABLE process_operation_templates (id INTEGER PRIMARY KEY, operation_code TEXT, default_specs_json TEXT)");
  db.exec("INSERT INTO process_operation_templates (id, operation_code, default_specs_json) VALUES (5, 'test_template', '{\"spc\":{\"temperature_c\":{\"lsl\":60,\"usl\":90}}}')");
  db.exec("INSERT INTO process_nodes (id, equipment_instance_id, operation_name) VALUES (1,1,'测试节点1'), (2,1,'测试节点2'), (7,1,'测试节点7'), (134,1,'测试节点134')");
  return db;
}
function makeApp() { const r = {}; for (const m of ["get","post","put","delete"]) r[m] = (p, ...hs) => { r[m.toUpperCase() + " " + p] = hs; }; return r; }
function callAsync(app, method, p, body, user, query = {}) {
  const pathTpl = p.replace(/\d+/g, ":id");
  const hs = app[method.toUpperCase() + " " + p] || app[method.toUpperCase() + " " + pathTpl];
  if (!hs) throw new Error("no route: " + method + " " + p);
  const m = pathTpl.match(/:([a-zA-Z_]+)/);
  const params = {}; if (m) { const parts = p.split("/"); const idx = pathTpl.split("/").indexOf(":" + m[1]); if (idx >= 0) params[m[1]] = parts[idx]; }
  return new Promise((resolve, reject) => {
    let status = 200, payload = null;
    const res = { status(c) { status = c; return this; }, json(x) { payload = x; return this; } };
    const req = { method, query, body: body || {}, params, user };
    const next = (error) => reject(error);
    try {
      const ret = hs[hs.length - 1](req, res, next);
      Promise.resolve(ret).then(() => resolve({ status, body: payload })).catch(reject);
    } catch (error) { reject(error); }
  });
}

function call(app, method, p, body) {
  const pathTpl = p.replace(/\d+/g, ":id");
  const hs = app[method.toUpperCase() + " " + p] || app[method.toUpperCase() + " " + pathTpl];
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


test("PPS-1 规格保存/读取，且 LSL/USL 必须在物理范围内", async () => {
  const db = makeDb(); const app = makeApp(); delete require.cache[svcPath]; require(svcPath).register(app, db);
  const save = await callAsync(app, "put", "/api/process_nodes/7/params/specs", { specs: { temperature_c: { lsl: 70, usl: 100, target: 85, unit: "C" } } });
  assert.equal(save.status, 200);
  const get = await callAsync(app, "get", "/api/process_nodes/7/params/specs");
  assert.equal(get.status, 200);
  assert.equal(get.body.specs.temperature_c.usl, 100);
  assert.equal(get.body.specs.temperature_c.target, 85);
  await assert.rejects(
    () => callAsync(app, "put", "/api/process_nodes/7/params/specs", { specs: { pressure_mpa: { lsl: -1, usl: 5 } } }),
    (error) => error.status === 400 && /物理范围/.test(error.message),
  );
  await assert.rejects(
    () => callAsync(app, "put", "/api/process_nodes/7/params/specs", { specs: { temperature_c: { lsl: 100, usl: 70 } } }),
    (error) => error.status === 400 && /不能大于/.test(error.message),
  );
  db.close();
});

test("PPS-2 空白参数记录被拒绝", async () => {
  const db = makeDb(); const app = makeApp(); delete require.cache[svcPath]; require(svcPath).register(app, db);
  await assert.rejects(
    () => callAsync(app, "post", "/api/process_nodes/7/params", {}),
    (error) => error.status === 400 && /至少填写/.test(error.message),
  );
  db.close();
});

test("PPS-3 普通用户不能伪造 recorded_by", async () => {
  const db = makeDb(); db.prepare("INSERT INTO users (id, full_name) VALUES (9, '李四')").run();
  const app = makeApp(); delete require.cache[svcPath]; require(svcPath).register(app, db);
  await assert.rejects(
    () => callAsync(app, "post", "/api/process_nodes/7/params", { current_amp: 10, recorded_by: 9 }, { sub: 1, role: "worker", permissions: ["process:write"] }),
    (error) => error.status === 403 && /本人身份/.test(error.message),
  );
  const own = await callAsync(app, "post", "/api/process_nodes/7/params", { current_amp: 10, recorded_by: 9 }, { sub: 9, role: "worker", permissions: ["process:write"] });
  assert.equal(own.status, 200);
  db.close();
});

test("PPS-4 不存在的工艺节点返回 404", async () => {
  const db = makeDb(); const app = makeApp(); delete require.cache[svcPath]; require(svcPath).register(app, db);
  await assert.rejects(
    () => callAsync(app, "get", "/api/process_nodes/999/params"),
    (error) => error.status === 404,
  );
  db.close();
});


test("PPS-5 参数列表分页与时间范围", async () => {
  const db = makeDb(); const app = makeApp(); delete require.cache[svcPath]; require(svcPath).register(app, db);
  for (let i = 1; i <= 5; i += 1) db.prepare("INSERT INTO process_params (process_node_id, current_amp) VALUES (7, ?)").run(100 + i);
  const page = await callAsync(app, "get", "/api/process_nodes/7/params", null, undefined, { page: 1, page_size: 2 });
  assert.equal(page.status, 200);
  assert.equal(page.body.total, 5);
  assert.equal(page.body.items.length, 2);
  assert.equal(page.body.page, 1);
  const today = new Date().toISOString().slice(0, 10);
  const ranged = await callAsync(app, "get", "/api/process_nodes/7/params", null, undefined, { page: 1, page_size: 50, from: today, to: today });
  assert.equal(ranged.body.total, 5);
  const empty = await callAsync(app, "get", "/api/process_nodes/7/params", null, undefined, { page: 1, from: "2000-01-01", to: "2000-01-02" });
  assert.equal(empty.body.total, 0);
  db.close();
});

test("PPS-6 节点无自定义规格时回退工序模板默认规格", async () => {
  const db = makeDb();
  db.prepare("UPDATE process_nodes SET operation_template_id = 5 WHERE id = 7").run();
  const app = makeApp(); delete require.cache[svcPath]; require(svcPath).register(app, db);
  const inherited = await callAsync(app, "get", "/api/process_nodes/7/params/specs");
  assert.equal(inherited.body.source, "template");
  assert.equal(inherited.body.specs.temperature_c.lsl, 60);
  const save = await callAsync(app, "put", "/api/process_nodes/7/params/specs", { specs: { temperature_c: { lsl: 70, usl: 100 } } });
  assert.equal(save.status, 200);
  const own = await callAsync(app, "get", "/api/process_nodes/7/params/specs");
  assert.equal(own.body.source, "node");
  assert.equal(own.body.specs.temperature_c.lsl, 70);
  db.close();
});
