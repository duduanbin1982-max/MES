"use strict";
// services/cost/projectCostEntries/ 拆分的回归守卫 (2026-10-11)
//
// 这个模块有两个容易拆坏的点：
//   1) ensureSchema 里有"旧表迁移"分支（表 SQL 不含 'material' 就 RENAME + 重建 + 拷数据）；
//   2) POST/PUT/DELETE 挂了两层中间件 (requireRole + wrap)，
//      只看路由清单不够，必须真的把中间件链跑完。

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MODULE_DIR = path.join(PROJECT_ROOT, "services", "cost", "projectCostEntries");
const projectCostEntries = require("../services/cost/projectCostEntries");

const EXPECTED_ROUTES = [
  ["GET", "/api/project_cost_entries"],
  ["GET", "/api/project_cost_entries/summary"],
  ["POST", "/api/project_cost_entries"],
  ["PUT", "/api/project_cost_entries/:id"],
  ["POST", "/api/project_cost_entries/backfill"],
  ["DELETE", "/api/project_cost_entries/:id"],
];

function makeApp() {
  const routes = [];
  const push = (method) => (routePath, ...handlers) => routes.push({ method, path: routePath, handlers });
  return { routes, get: push("GET"), put: push("PUT"), post: push("POST"), delete: push("DELETE") };
}

// 迷你 express: 按顺序跑完该路由的全部中间件
function callRoute(app, method, routePath, req) {
  const route = app.routes.find((item) => item.method === method && item.path === routePath);
  assert.ok(route, `route not registered: ${method} ${routePath}`);
  return new Promise((resolve) => {
    const fullReq = { query: {}, body: {}, params: {}, ...req };
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        resolve({ ok: true, res: this });
        return this;
      },
    };
    let index = 0;
    const next = (err) => {
      if (err) return resolve({ ok: false, err });
      const handler = route.handlers[index++];
      if (!handler) return resolve({ ok: false, err: new Error("no handler resolved") });
      try {
        const out = handler(fullReq, res, next);
        if (out && typeof out.then === "function") out.catch(next);
      } catch (error) {
        next(error);
      }
    };
    next();
  });
}

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE equipment_instances (
      id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT
    );
    INSERT INTO equipment_instances (id, instance_code, instance_name) VALUES (100, 'TBM-1', '一号机');
  `);
  projectCostEntries.ensureSchema(db);
  return db;
}

test("COST.1 公共面覆盖原 3 个导出，COST_TYPES 内容不变", () => {
  assert.equal(typeof projectCostEntries.register, "function");
  assert.equal(typeof projectCostEntries.ensureSchema, "function");
  assert.ok(projectCostEntries.COST_TYPES instanceof Set);
  assert.deepEqual(
    [...projectCostEntries.COST_TYPES].sort(),
    ["depreciation", "labor", "material", "outsourcing", "quality_loss", "rework"]
  );
});

test("COST.2 拆分目录里每个相对 require 都能解析", () => {
  const requirePattern = /require\(\s*["']([^"']+)["']\s*\)/g;
  const missing = [];
  for (const file of fs.readdirSync(MODULE_DIR)) {
    if (!file.endsWith(".js")) continue;
    const source = fs
      .readFileSync(path.join(MODULE_DIR, file), "utf8")
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
      })
      .join("\n");
    for (const match of source.matchAll(requirePattern)) {
      const request = match[1];
      if (!request.startsWith(".")) continue;
      const base = path.resolve(MODULE_DIR, request);
      const resolved = ["", ".js", ".json", "/index.js"].some((suffix) => fs.existsSync(`${base}${suffix}`));
      if (!resolved) missing.push(`${file}: ${request}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("COST.3 register 装配的 6 条路由与拆分前逐条一致（含两层中间件）", () => {
  const db = makeDb();
  const app = makeApp();
  projectCostEntries.register(app, db);
  const sortKey = (item) => `${item.method} ${item.path}`;
  assert.deepEqual(app.routes.map(sortKey).sort(), EXPECTED_ROUTES.map(([m, p]) => `${m} ${p}`).sort());
  for (const route of app.routes) {
    const expectedHandlers = ["GET"].includes(route.method) ? 1 : 2;
    assert.equal(route.handlers.length, expectedHandlers, `${sortKey(route)} 的中间件层数不对`);
  }
  db.close();
});

test("COST.4 ensureSchema 建表 + CHECK 约束 + 4 个索引", () => {
  const db = makeDb();
  const tableSql = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='project_cost_entries'")
    .get().sql;
  assert.match(tableSql, /CHECK \(cost_type IN \('material','labor','outsourcing','depreciation','rework','quality_loss'\)\)/);
  assert.match(tableSql, /CHECK \(status IN \('draft','posted','void'\)\)/);
  const indexes = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='project_cost_entries'")
    .all()
    .map((row) => row.name);
  for (const name of [
    "idx_project_cost_entries_instance",
    "idx_project_cost_entries_type",
    "idx_project_cost_entries_bom",
    "idx_project_cost_entries_work_order",
  ]) {
    assert.ok(indexes.includes(name), `缺少索引 ${name}`);
  }
  db.close();
});

test("COST.5 旧表迁移分支：SQL 不含 'material' 时 RENAME + 重建 + 拷数据", () => {
  const db = new Database(":memory:");
  // 旧版表结构：列齐全但 cost_type/status 没有 CHECK 约束（SQL 里不含 'material'）
  db.exec(`
    CREATE TABLE project_cost_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_instance_id INTEGER NOT NULL,
      bom_node_id INTEGER,
      work_order_id INTEGER,
      cost_type TEXT NOT NULL,
      source_type TEXT,
      source_ref TEXT,
      description TEXT NOT NULL,
      vendor TEXT,
      amount REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'CNY',
      occurred_on TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'posted',
      notes TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );
    INSERT INTO project_cost_entries (id, equipment_instance_id, cost_type, description, amount, occurred_on)
    VALUES (7, 100, 'labor', '旧记录', 88, '2026-09-01');
  `);
  projectCostEntries.ensureSchema(db);

  const row = db.prepare("SELECT * FROM project_cost_entries WHERE id = 7").get();
  assert.ok(row, "迁移后旧数据应被搬运过来");
  assert.equal(row.amount, 88);
  const tableSql = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='project_cost_entries'")
    .get().sql;
  assert.match(tableSql, /CHECK \(cost_type IN \('material'/);
  const legacy = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'project_cost_entries_legacy_%'")
    .all();
  assert.equal(legacy.length, 1, "旧表应被 RENAME 保留");
  db.close();
});

test("COST.6 全链路：新增 → 列表 → 汇总 → 修改 → 作废，且鉴权与校验生效", async () => {
  const db = makeDb();
  const app = makeApp();
  projectCostEntries.register(app, db);
  const admin = { user: { role: "admin", sub: 1 } };

  // 非管理员被 requireRole 拦下 (requireRole 用 res.status().json(), 不走 next)
  const denied = await callRoute(app, "POST", "/api/project_cost_entries", {
    user: { role: "welder", sub: 2 },
    body: { equipment_instance_id: 100, cost_type: "material", description: "钢材", amount: 1 },
  });
  assert.equal(denied.res.statusCode, 403);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM project_cost_entries").get().c, 0, "被拦下的请求不应写库");

  // 非法 cost_type 返回 400
  const bad = await callRoute(app, "POST", "/api/project_cost_entries", {
    ...admin,
    body: { equipment_instance_id: 100, cost_type: "nonsense", description: "x", amount: 1 },
  });
  assert.equal(bad.res.statusCode, 400);

  // 新增（金额四舍五入到 2 位）
  const created = await callRoute(app, "POST", "/api/project_cost_entries", {
    ...admin,
    body: { equipment_instance_id: 100, cost_type: "material", description: "钢材", amount: 123.456, occurred_on: "2026-10-01" },
  });
  assert.equal(created.res.body.ok, true);
  assert.equal(created.res.body.item.amount, 123.46);
  assert.equal(created.res.body.item.status, "posted");
  const id = created.res.body.item.id;

  // 列表带 cost_type_label
  const list = await callRoute(app, "GET", "/api/project_cost_entries", { query: { equipment_instance_id: "100" } });
  assert.equal(list.res.body.count, 1);
  assert.equal(list.res.body.items[0].cost_type_label, "材料");

  // 汇总
  const summary = await callRoute(app, "GET", "/api/project_cost_entries/summary", {});
  assert.equal(summary.res.body.by_type.material.amount, 123.46);
  assert.equal(summary.res.body.total, 123.46);
  assert.equal(summary.res.body.by_type.labor.amount, 0);

  // 修改
  const updated = await callRoute(app, "PUT", "/api/project_cost_entries/:id", {
    ...admin,
    params: { id: String(id) },
    body: { amount: 200 },
  });
  assert.equal(updated.res.body.item.amount, 200);

  // 作废（软删除）
  const removed = await callRoute(app, "DELETE", "/api/project_cost_entries/:id", {
    ...admin,
    params: { id: String(id) },
  });
  assert.equal(removed.res.body.ok, true);
  const after = await callRoute(app, "GET", "/api/project_cost_entries", {});
  assert.equal(after.res.body.count, 0, "作废后不应再出现在列表里");
  assert.equal(db.prepare("SELECT status FROM project_cost_entries WHERE id = ?").get(id).status, "void");
  db.close();
});
