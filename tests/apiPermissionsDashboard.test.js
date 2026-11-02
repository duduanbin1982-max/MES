"use strict";
// tests/apiPermissionsDashboard.test.js
// 2026-11-02：仪表盘接口权限矩阵
//
// 背景：审计发现 /dashboard/risk-summary、/long-leadtime、/live-status、/process-health
// 四个接口没有匹配任何权限规则，导致"无规则即放行"——welder/worker 可越权读取。
// 本测试锁定：5 个仪表盘 GET 接口都必须 report:read。

const test = require("node:test");
const assert = require("node:assert/strict");

const { apiPermissionMiddleware } = require("../middleware/apiPermissions");
const { DEFAULT_ROLE_PERMISSIONS } = require("../app/permissions");

const DASHBOARD_GETS = [
  "/api/dashboard",
  "/api/dashboard/risk-summary",
  "/api/dashboard/long-leadtime",
  "/api/dashboard/live-status",
  "/api/dashboard/process-health",
  "/api/dashboard/alerts",
  "/api/dashboard/delays",
  "/api/dashboard/delays/summary",
];

function hit(path, role) {
  const permissions = role === "admin" ? ["*"] : DEFAULT_ROLE_PERMISSIONS[role] || [];
  // 真实应用里中间件挂在 /api 前缀下，req.path 不含 /api
  const req = { path: path.replace(/^\/api/, ""), method: "GET", originalUrl: path, user: { role, permissions } };
  let error = null;
  let passed = false;
  apiPermissionMiddleware(req, {}, (err) => {
    if (err) error = err;
    else passed = true;
  });
  return { passed, status: error?.status || (passed ? 200 : 0) };
}

test("PID.1 所有仪表盘 GET 接口都要求 report:read（低权限角色 403）", () => {
  for (const path of DASHBOARD_GETS) {
    for (const role of ["welder", "worker", "warehouse"]) {
      const result = hit(path, role);
      assert.equal(result.status, 403, `${path} 对 ${role} 应 403，实际 ${result.status}`);
    }
  }
});

test("PID.2 有 report:read 的角色可读（planner / qc / sales）", () => {
  for (const path of DASHBOARD_GETS) {
    for (const role of ["planner", "qc", "sales"]) {
      const result = hit(path, role);
      assert.ok(result.passed, `${path} 对 ${role} 应放行，实际 ${result.status}`);
    }
  }
});

test("PID.3 管理员全部可读", () => {
  for (const path of DASHBOARD_GETS) {
    assert.ok(hit(path, "admin").passed, `${path} 对 admin 应放行`);
  }
});
