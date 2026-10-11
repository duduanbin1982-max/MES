"use strict";
// tests/deliveryDbContextWhitelist.test.js
// 守卫白名单覆盖率测试 (2026-10-11)
//
// 事故背景：9859cda 给 delivery/dbContext.js 加了 ALLOWED_TABLES 守卫，但名单不全
// —— 读模型会走
//     ["work_order_operations","process_reports","operation_reports","process_work_reports"]
//       .find(tableExists)
//   命中 work_order_operations 后传给 has()/columns()，直接抛
//   "Invalid table name: work_order_operations"，
//   导致 /api/delivery/overview、/api/delivery/projects/:id 在生产上 500。
//   部署前闸门当时没有覆盖到这条路径，所以没拦住。
//
// 本测试用两种互补方式守住：
//   1) 动态：在 fixture 库上跑完读模型的全部公共 API，记录 columns()/has()
//      真正请求过的表名，要求全部在白名单内，且任何 API 都不抛错；
//   2) 静态：扫 services/delivery/** 里所有 `[...].find(tableExists)` 的候选表名数组，
//      要求数组里每个字面量都在白名单内（这样将来把候选表建出来也不会崩）。

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DELIVERY_DIR = path.join(PROJECT_ROOT, "services", "delivery");
const { seedDeliveryDb } = require("./helpers/deliveryReadModelFixture");
const { createDeliveryDbContext, ALLOWED_TABLES } = require("../services/delivery/dbContext");
const { createReadModel } = require("../services/delivery/readModel");

function walkJs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkJs(full);
    return entry.name.endsWith(".js") ? [full] : [];
  });
}

// 跑完读模型全部公共 API，返回 { requested, failures }
function exerciseReadModel() {
  const db = seedDeliveryDb();
  const requested = new Set();
  const failures = [];

  // columns() 内部会执行 `PRAGMA table_info(<table>)`；拦在 prepare 上即可拿到
  // 所有真实请求过的表名（表不存在时 columns 会先走白名单校验，所以抛错也在这里暴露）
  const realPrepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    const match = /PRAGMA\s+table_info\s*\(\s*([^)\s]+)\s*\)/i.exec(String(sql));
    if (match) requested.add(match[1]);
    return realPrepare(sql);
  };

  const ctx = createDeliveryDbContext(db);
  const model = createReadModel({ db, ...ctx, enrichEscalation: (item) => item });

  const run = (name, fn) => {
    try {
      return fn();
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
      return null;
    }
  };

  const exceptions = run("collectExceptions", () => model.collectExceptions()) || [];
  run("exceptionSummary", () => model.exceptionSummary(exceptions));
  const instances = run("getInstances", () => model.getInstances()) || [];
  for (const instance of instances) {
    run(`buildProject(${instance.id})`, () => model.buildProject(instance, exceptions));
    run(`buildProjectRiskDrilldown(${instance.id})`, () => model.buildProjectRiskDrilldown(instance, exceptions));
    run(`buildProjectLineage(${instance.id})`, () => model.buildProjectLineage(instance, exceptions));
  }
  db.close();
  return { requested, failures, instanceCount: instances.length };
}

test("DBCTX.1 白名单覆盖读模型实际请求的全部表名", () => {
  const { requested, failures } = exerciseReadModel();
  assert.ok(requested.size >= 15, `动态收集到的表太少(${requested.size})，守卫可能失效`);
  assert.ok(requested.has("work_order_operations"), "必须走到 work_order_operations 这条路径，否则测试是假绿");
  const missing = [...requested].filter((table) => !ALLOWED_TABLES.has(table));
  assert.deepEqual(missing, [], `这些表被请求但不在 ALLOWED_TABLES 里: ${missing.join(", ")}`);
  assert.deepEqual(failures, []);
});

test("DBCTX.2 读模型全部公共 API 在 fixture 上都不抛错", () => {
  const { failures, instanceCount } = exerciseReadModel();
  assert.equal(instanceCount, 3);
  assert.deepEqual(failures, []);
});

test("DBCTX.3 守卫仍然会把非白名单表名挡下来", () => {
  const db = new Database(":memory:");
  const ctx = createDeliveryDbContext(db);
  for (const table of ["information_schema.tables", "sqlite_master", "users; DROP TABLE users"]) {
    assert.throws(() => ctx.columns(table), /Invalid table name/, `应拒绝 ${table}`);
    assert.throws(() => ctx.has(table, "id"), /Invalid table name/, `应拒绝 ${table}`);
  }
  db.close();
});

test("DBCTX.4 `[...].find(tableExists)` 的候选表名必须全部在白名单内", () => {
  const found = [];
  for (const file of walkJs(DELIVERY_DIR)) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/\[([^\]]*?)\]\.find\(tableExists\)/g)) {
      const names = [...match[1].matchAll(/["']([^"']+)["']/g)].map((item) => item[1]);
      for (const name of names) {
        if (!ALLOWED_TABLES.has(name)) {
          found.push(`${path.relative(PROJECT_ROOT, file)}: ${name}`);
        }
      }
    }
  }
  assert.deepEqual(found, [], "候选表建出来后会让 columns() 直接抛错");
  assert.ok(found.length === 0);
});
