"use strict";
// 静态分析 v1 发现 #6: /api/workflow/definitions 由"匿名可读"改为"登录可读"。
//
// 回归点:
//   1) 未带 token 必须 401 —— 防止 publicPaths 又把它放回去;
//   2) 每个内置角色登录后仍能读到定义 —— 防止它落到下面通用的 /workflow 规则
//      (需要 work_order:read), 把 welder / planner / purchaser / sales 锁死;
//   3) 权限为空的 token 得到 403 —— 证明这请求确实过了 apiPermissions 这道门;
//   4) /api/health 仍然匿名可探活。
//
// 证据: nginx 4 个月访问日志里 /api/workflow/definitions 只有 1 次匿名请求
// (来自 192.168.1.11, 且返回 404), 唯一真实调用方是登录后的前端
// frontend/src/views/WorkflowEngine.vue。

require("dotenv").config({ path: require("node:path").resolve(__dirname, "../.env") });
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = require("node:crypto").randomBytes(48).toString("hex");
}

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const Database = require("better-sqlite3");
const express = require("express");
const { authMiddleware, makeToken } = require("../middleware/auth");
const { apiPermissionMiddleware } = require("../middleware/apiPermissions");
const { errorHandler, notFoundHandler } = require("../app/errors");
const { DEFAULT_ROLE_PERMISSIONS } = require("../app/permissions");

// 2026-10-10 从生产库 data/mes.db 的 roles 表导出（只读查询）。
// 用途：守住"改成登录可读后，真实角色不会被 403 锁死"。
// 注意 welder/planner/purchaser/sales 都没有 work_order:read —— 如果这个端点
// 落到通用的 /workflow 规则(需要 work_order:read)，他们就会拿到 403。
const PROD_ROLE_PERMISSIONS = {
  admin: ["*"],
  admin_2: [],
  engineer: ["project:read", "bom:*", "work_order:read", "help:read", "equipment:read"],
  foreman: ["project:*", "work_order:*", "bom:read", "material:read", "audit:read", "help:read", "equipment:read"],
  planner: ["help:read", "equipment:read"],
  production_supervisor: ["equipment:read", "equipment:write", "work_order:admin", "work_order:read", "work_order:write", "help:read"],
  purchaser: ["help:read", "equipment:read"],
  qc: ["qc:*", "work_order:read", "help:read", "equipment:read"],
  sales: ["project:read", "contract:read", "help:read", "equipment:read"],
  warehouse: ["shopfloor:read", "material:read", "inventory:read", "inventory:write", "work_order:read", "pick:read", "pick:write", "document:read", "help:read", "equipment:read", "equipment:write"],
  welder: ["weld:create", "wo:read", "help:read", "equipment:read"],
  worker: ["work_order:read", "wo:execute", "help:read", "equipment:read"],
};

let server;
let port;
let db;

function get(path, token) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "GET",
        headers: token ? { authorization: "Bearer " + token } : {},
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => { raw += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

test.before(async () => {
  db = new Database(":memory:");
  const app = express();
  app.use(express.json());
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  // 与 server.js 一致: 先 auth(验签 + 注入 req.user), 再 apiPermissions(逐路由 RBAC)
  app.use("/api", authMiddleware);
  app.use("/api", apiPermissionMiddleware);
  require("../services/workflowService").register(app, db, {});
  app.use(notFoundHandler);
  app.use(errorHandler);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (db) db.close();
});

test("WF-AUTH.1 /api/health 仍然匿名可读", async () => {
  const response = await get("/api/health");
  assert.equal(response.status, 200);
  assert.equal(response.body.status, "ok");
});

test("WF-AUTH.2 /api/workflow/definitions 匿名访问返回 401", async () => {
  const response = await get("/api/workflow/definitions");
  assert.equal(response.status, 401);
});

test("WF-AUTH.3 每个内置角色登录后都能读到工作流定义", async () => {
  const roles = Object.keys(DEFAULT_ROLE_PERMISSIONS);
  assert.ok(roles.length >= 6, "内置角色表不应缩水");
  for (const role of roles) {
    const token = makeToken(1, role, { permissions: DEFAULT_ROLE_PERMISSIONS[role] });
    const response = await get("/api/workflow/definitions", token);
    assert.equal(response.status, 200, `角色 ${role} 读取定义被拒: ${response.status}`);
    assert.ok(Array.isArray(response.body) && response.body.length > 0);
  }
});

test("WF-AUTH.3b 生产库里的真实角色登录后同样读得到定义", async () => {
  for (const [role, permissions] of Object.entries(PROD_ROLE_PERMISSIONS)) {
    // admin_2 权限为 [] （生产库里也没有任何用户挂它），是唯一预期被拒的角色
    const expectDenied = permissions.length === 0;
    const token = makeToken(1, role, { permissions });
    const response = await get("/api/workflow/definitions", token);
    if (expectDenied) {
      assert.equal(response.status, 403, `角色 ${role} 权限为空时应 403`);
      continue;
    }
    assert.equal(
      response.status,
      200,
      `真实角色 ${role} (${permissions.join(",")}) 读取定义被拒: ${response.status} —— ` +
        `说明它落到了需要 work_order:read 的通用 /workflow 规则`
    );
  }
});

test("WF-AUTH.4 权限为空的 token 被 403 拦住", async () => {
  const token = makeToken(1, "nobody", { permissions: [] });
  const response = await get("/api/workflow/definitions", token);
  assert.equal(response.status, 403);
  assert.equal(response.body.code, "FORBIDDEN");
});

test("WF-AUTH.5 返回体不包含状态机内部实现细节", async () => {
  const token = makeToken(1, "welder", { permissions: DEFAULT_ROLE_PERMISSIONS.welder });
  const response = await get("/api/workflow/definitions", token);
  assert.equal(response.status, 200);
  for (const item of response.body) {
    assert.deepEqual(Object.keys(item).sort(), [
      "description",
      "display_name",
      "entity_type",
      "name",
      "states",
      "transitions_count",
    ]);
  }
});
