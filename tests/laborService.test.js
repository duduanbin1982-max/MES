'use strict';

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const laborService = require("../services/laborService");

function createDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, full_name TEXT, role_code TEXT,
      is_active INTEGER DEFAULT 1, cert_no TEXT, cert_type TEXT, availability TEXT DEFAULT 'idle',
      workstation_id INTEGER, skills TEXT
    );
    INSERT INTO users (id, username, full_name, role_code, is_active) VALUES
      (1, 'w1', '王师傅', 'worker', 1),
      (2, 'w2', '李工', 'worker', 1);
  `);
  return db;
}
function createApp(db) {
  const routes = new Map();
  const app = {};
  for (const method of ["get", "post", "put", "delete"]) {
    app[method] = (route, handler) => routes.set(`${method.toUpperCase()} ${route}`, handler);
  }
  laborService.register(app, db);
  return { routes, find: (method, route) => routes.get(`${method} ${route}`) };
}
function invoke(handler, request = {}) {
  return new Promise((resolve, reject) => {
    const state = { status: 200, body: null };
    const res = { status(code) { state.status = code; return this; }, json(body) { state.body = body; return this; } };
    const req = { params: {}, query: {}, body: {}, user: { uid: 1, role: "admin", permissions: ["*"] }, ...request };
    const next = (error) => reject(error);
    try {
      const ret = handler(req, res, next);
      Promise.resolve(ret).then(() => resolve(state)).catch(reject);
    } catch (error) { reject(error); }
  });
}

test("LAB-1 证书建档同步用户摘要，到期自动置失效", async () => {
  const db = createDb();
  const { find } = createApp(db);
  const created = await invoke(find("POST", "/api/labor/certificates"), {
    body: { user_id: 1, cert_type: "welding", cert_name: "焊工证", cert_number: "HG-1", expiry_date: "2099-12-31" },
  });
  assert.equal(created.status, 201);
  let user = db.prepare("SELECT cert_no, cert_type FROM users WHERE id = 1").get();
  assert.equal(user.cert_no, "HG-1");
  assert.equal(user.cert_type, "welding");

  const certId = created.body.id;
  const renewed = await invoke(find("PUT", "/api/labor/certificates/:id"), {
    params: { id: String(certId) }, body: { expiry_date: "2000-01-01", status: "valid" },
  });
  assert.equal(renewed.status, 200);
  const list = await invoke(find("GET", "/api/labor/certificates"));
  assert.equal(list.body[0].status, "expired");
  user = db.prepare("SELECT cert_no, cert_type FROM users WHERE id = 1").get();
  assert.equal(user.cert_no, null);
  db.close();
});

test("LAB-2 证书输入校验/重复/删除", async () => {
  const db = createDb();
  const { find } = createApp(db);
  await assert.rejects(
    () => invoke(find("POST", "/api/labor/certificates"), { body: { cert_type: "welding", cert_name: "x" } }),
    (error) => error.status === 400,
  );
  await assert.rejects(
    () => invoke(find("POST", "/api/labor/certificates"), { body: { user_id: 999, cert_type: "welding", cert_name: "x" } }),
    (error) => error.status === 404,
  );
  await assert.rejects(
    () => invoke(find("POST", "/api/labor/certificates"), { body: { user_id: 1, cert_type: "welding", cert_name: "x", issued_date: "2026-01-02", expiry_date: "2026-01-01" } }),
    (error) => error.status === 400 && /不能晚于/.test(error.message),
  );
  const first = await invoke(find("POST", "/api/labor/certificates"), { body: { user_id: 1, cert_type: "welding", cert_name: "A", cert_number: "DUP" } });
  await assert.rejects(
    () => invoke(find("POST", "/api/labor/certificates"), { body: { user_id: 1, cert_type: "welding", cert_name: "B", cert_number: "DUP" } }),
    (error) => error.status === 409,
  );
  const deleted = await invoke(find("DELETE", "/api/labor/certificates/:id"), { params: { id: String(first.body.id) } });
  assert.equal(deleted.body.success, true);
  await assert.rejects(
    () => invoke(find("DELETE", "/api/labor/certificates/:id"), { params: { id: "999" } }),
    (error) => error.status === 404,
  );
  db.close();
});

test("LAB-3 技能 upsert/等级校验", async () => {
  const db = createDb();
  const { find } = createApp(db);
  let res = await invoke(find("POST", "/api/labor/skills"), { body: { user_id: 1, skill_name: "手工电弧焊", skill_category: "welding", proficiency_level: 3 } });
  assert.equal(res.status, 200);
  res = await invoke(find("POST", "/api/labor/skills"), { body: { user_id: 1, skill_name: "手工电弧焊", skill_category: "welding", proficiency_level: 5, certified: true } });
  assert.equal(res.status, 200);
  const rows = db.prepare("SELECT COUNT(*) c, MAX(proficiency_level) lvl, MAX(certified) cert FROM worker_skills WHERE user_id = 1").get();
  assert.equal(rows.c, 1);
  assert.equal(rows.lvl, 5);
  assert.equal(rows.cert, 1);
  await assert.rejects(
    () => invoke(find("POST", "/api/labor/skills"), { body: { user_id: 1, skill_name: "bad", proficiency_level: 0 } }),
    (error) => error.status === 400,
  );
  db.close();
});

test("LAB-4 培训记录包含发证字段，支持增改删", async () => {
  const db = createDb();
  const { find } = createApp(db);
  const created = await invoke(find("POST", "/api/labor/training"), {
    body: { user_id: 1, training_name: "焊工复证", training_type: "external", start_date: "2026-01-01", end_date: "2026-01-03", duration_hours: 24, score: 90, passed: true, certificate_issued: true },
  });
  assert.equal(created.status, 201);
  const list = await invoke(find("GET", "/api/labor/training"));
  assert.equal(list.body[0].certificate_issued, 1);
  const updated = await invoke(find("PUT", "/api/labor/training/:id"), { params: { id: String(created.body.id) }, body: { score: 95 } });
  assert.equal(updated.status, 200);
  const deleted = await invoke(find("DELETE", "/api/labor/training/:id"), { params: { id: String(created.body.id) } });
  assert.equal(deleted.body.success, true);
  db.close();
});
