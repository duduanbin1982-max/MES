"use strict";
// tests/deliveryRecords.test.js
// 2026-11-02：交付单 / 验收单（补「交付/验收无单据表」断点）
// 覆盖：自动单号、状态机流转、非法流转拦截、验收签署校验、删除、实例不存在。

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const {
  initDeliveryRecordsSchema,
  registerDeliveryRecordRoutes,
  DELIVERY_TRANSITIONS,
} = require("../services/delivery/records");

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT);
    INSERT INTO equipment_instances (id, instance_code, instance_name) VALUES (1, 'TBM-T-001', '测试机');
  `);
  initDeliveryRecordsSchema(db);
  initDeliveryRecordsSchema(db); // 幂等
  return db;
}

function makeApp() {
  const routes = new Map();
  const app = {
    get: (path, ...handlers) => routes.set("GET " + path, handlers),
    post: (path, ...handlers) => routes.set("POST " + path, handlers),
    put: (path, ...handlers) => routes.set("PUT " + path, handlers),
    delete: (path, ...handlers) => routes.set("DELETE " + path, handlers),
  };
  return { app, routes };
}

function call(routes, method, path, { params = {}, body = {} } = {}) {
  const handlers = routes.get(`${method} ${path}`);
  assert.ok(handlers, `路由未注册: ${method} ${path}`);
  const handler = handlers[handlers.length - 1];
  let payload = null;
  let error = null;
  const res = {
    status(code) { return { json(value) { payload = { status: code, body: value }; } }; },
    json(value) { payload = { status: 200, body: value }; },
  };
  handler({ params, body, query: {}, user: { sub: 1, uid: 1 } }, res, (err) => { error = err; });
  return { payload, error };
}

test("DR.1 创建交付单：自动单号 DO-<实例>-001，按实例递增", () => {
  const db = freshDb();
  const { app, routes } = makeApp();
  registerDeliveryRecordRoutes(app, db);
  const first = call(routes, "POST", "/api/equipment_instances/:id/deliveries", {
    params: { id: "1" }, body: { planned_date: "2026-12-01", transport_mode: "road", carrier: "顺丰" },
  });
  assert.equal(first.payload.status, 200);
  assert.equal(first.payload.body.delivery_no, "DO-TBM-T-001-001");
  const second = call(routes, "POST", "/api/equipment_instances/:id/deliveries", {
    params: { id: "1" }, body: { planned_date: "2026-12-10" },
  });
  assert.equal(second.payload.body.delivery_no, "DO-TBM-T-001-002");

  const list = call(routes, "GET", "/api/equipment_instances/:id/deliveries", { params: { id: "1" } });
  assert.equal(list.payload.body.total, 2);
  assert.equal(list.payload.body.items[0].status, "planned", "默认状态 planned");
  db.close();
});

test("DR.2 枚举校验：非法 transport_mode 被拒", () => {
  const db = freshDb();
  const { app, routes } = makeApp();
  registerDeliveryRecordRoutes(app, db);
  const bad = call(routes, "POST", "/api/equipment_instances/:id/deliveries", {
    params: { id: "1" }, body: { transport_mode: "teleport" },
  });
  assert.equal(bad.error.status, 400);
  db.close();
});

test("DR.3 状态机：planned→shipped→in_transit→arrived→accepted 全链路", () => {
  const db = freshDb();
  const { app, routes } = makeApp();
  registerDeliveryRecordRoutes(app, db);
  const created = call(routes, "POST", "/api/equipment_instances/:id/deliveries", { params: { id: "1" }, body: {} });
  const id = String(created.payload.body.id);

  for (const next of ["shipped", "in_transit", "arrived", "accepted"]) {
    const step = call(routes, "POST", "/api/deliveries/:id/status", { params: { id }, body: { status: next } });
    assert.equal(step.error, null, `${next} 应允许`);
    assert.equal(step.payload.body.to, next);
  }
  const after = call(routes, "GET", "/api/equipment_instances/:id/deliveries", { params: { id: "1" } });
  const stored = after.payload.body.items[0];
  assert.equal(stored.status, "accepted");
  assert.ok(stored.actual_date, "状态推进后应记录实际日期");
  db.close();
});

test("DR.4 状态机：跳步 / 回退 / 终态继续推进 均被拒（400）", () => {
  const db = freshDb();
  const { app, routes } = makeApp();
  registerDeliveryRecordRoutes(app, db);
  const created = call(routes, "POST", "/api/equipment_instances/:id/deliveries", { params: { id: "1" }, body: {} });
  const id = String(created.payload.body.id);

  const skip = call(routes, "POST", "/api/deliveries/:id/status", { params: { id }, body: { status: "arrived" } });
  assert.equal(skip.error.status, 400, "planned 不能直接跳到 arrived");
  assert.match(String(skip.error.message), /不合法的状态流转/);

  call(routes, "POST", "/api/deliveries/:id/status", { params: { id }, body: { status: "shipped" } });
  const back = call(routes, "POST", "/api/deliveries/:id/status", { params: { id }, body: { status: "planned" } });
  assert.equal(back.error.status, 400, "不能回退到 planned");

  call(routes, "POST", "/api/deliveries/:id/status", { params: { id }, body: { status: "in_transit" } });
  call(routes, "POST", "/api/deliveries/:id/status", { params: { id }, body: { status: "arrived" } });
  call(routes, "POST", "/api/deliveries/:id/status", { params: { id }, body: { status: "accepted" } });
  const finished = call(routes, "POST", "/api/deliveries/:id/status", { params: { id }, body: { status: "cancelled" } });
  assert.equal(finished.error.status, 400, "accepted 是终态");
  db.close();
});

test("DR.5 PUT 不能绕过状态机改 status", () => {
  const db = freshDb();
  const { app, routes } = makeApp();
  registerDeliveryRecordRoutes(app, db);
  const created = call(routes, "POST", "/api/equipment_instances/:id/deliveries", { params: { id: "1" }, body: {} });
  const id = String(created.payload.body.id);
  const updated = call(routes, "PUT", "/api/deliveries/:id", { params: { id }, body: { status: "accepted", carrier: "德邦" } });
  assert.equal(updated.payload.body.item.status, "planned", "PUT 应忽略 status");
  assert.equal(updated.payload.body.item.carrier, "德邦");
  db.close();
});

test("DR.6 验收单：自动单号 AC-…，签署校验（签署人必填 / 让步必填说明）", () => {
  const db = freshDb();
  const { app, routes } = makeApp();
  registerDeliveryRecordRoutes(app, db);
  const created = call(routes, "POST", "/api/equipment_instances/:id/acceptances", {
    params: { id: "1" }, body: { acceptance_type: "fat", planned_date: "2026-12-05" },
  });
  assert.equal(created.payload.body.acceptance_no, "AC-TBM-T-001-001");
  const id = String(created.payload.body.id);
  assert.equal(created.payload.body.item.result, "pending");

  const noSigner = call(routes, "POST", "/api/acceptances/:id/sign", { params: { id }, body: { result: "passed" } });
  assert.equal(noSigner.error.status, 400, "缺签署人应拒绝");
  assert.match(String(noSigner.error.message), /signer_name/);

  const conditionalNoNote = call(routes, "POST", "/api/acceptances/:id/sign", {
    params: { id }, body: { result: "conditional", signer_name: "张工" },
  });
  assert.equal(conditionalNoNote.error.status, 400, "让步接收必须写说明");

  const ok = call(routes, "POST", "/api/acceptances/:id/sign", {
    params: { id }, body: { result: "passed", signer_name: "张工", signer_title: "客户代表", actual_date: "2026-12-06" },
  });
  assert.equal(ok.error, null);
  assert.equal(ok.payload.body.item.result, "passed");
  assert.equal(ok.payload.body.item.signer_name, "张工");
  assert.ok(ok.payload.body.item.signed_at, "应记录签署时间");
  assert.equal(ok.payload.body.item.actual_date, "2026-12-06");
  db.close();
});

test("DR.7 验收单：PUT 不能改 result（只能通过签署接口）", () => {
  const db = freshDb();
  const { app, routes } = makeApp();
  registerDeliveryRecordRoutes(app, db);
  const created = call(routes, "POST", "/api/equipment_instances/:id/acceptances", { params: { id: "1" }, body: {} });
  const id = String(created.payload.body.id);
  const updated = call(routes, "PUT", "/api/acceptances/:id", { params: { id }, body: { result: "passed", customer_name: "某地铁公司" } });
  assert.equal(updated.payload.body.item.result, "pending");
  assert.equal(updated.payload.body.item.customer_name, "某地铁公司");
  db.close();
});

test("DR.8 实例不存在 → 404；交付单/验收单均可删除", () => {
  const db = freshDb();
  const { app, routes } = makeApp();
  registerDeliveryRecordRoutes(app, db);
  const missing = call(routes, "GET", "/api/equipment_instances/:id/deliveries", { params: { id: "999" } });
  assert.equal(missing.error.status, 404);

  const created = call(routes, "POST", "/api/equipment_instances/:id/deliveries", { params: { id: "1" }, body: {} });
  const id = String(created.payload.body.id);
  const del = call(routes, "DELETE", "/api/deliveries/:id", { params: { id } });
  assert.deepEqual(del.payload.body.deleted, [Number(id)]);
  const list = call(routes, "GET", "/api/equipment_instances/:id/deliveries", { params: { id: "1" } });
  assert.equal(list.payload.body.total, 0);

  const acc = call(routes, "POST", "/api/equipment_instances/:id/acceptances", { params: { id: "1" }, body: {} });
  const accId = String(acc.payload.body.id);
  const delAcc = call(routes, "DELETE", "/api/acceptances/:id", { params: { id: accId } });
  assert.deepEqual(delAcc.payload.body.deleted, [Number(accId)]);
  const accList = call(routes, "GET", "/api/equipment_instances/:id/acceptances", { params: { id: "1" } });
  assert.equal(accList.payload.body.total, 0);
  db.close();
});

test("DR.9 状态机表覆盖全部状态（防止新增状态后忘记配置流转）", () => {
  const all = Object.keys(DELIVERY_TRANSITIONS);
  assert.deepEqual(all.sort(), ["accepted", "arrived", "cancelled", "in_transit", "planned", "shipped"]);
  assert.deepEqual(DELIVERY_TRANSITIONS.accepted, [], "accepted 终态");
  assert.deepEqual(DELIVERY_TRANSITIONS.cancelled, [], "cancelled 终态");
});
