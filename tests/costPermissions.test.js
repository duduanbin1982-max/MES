"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { apiPermissionMiddleware } = require("../middleware/apiPermissions");

function check(path, method, permissions, role = "worker") {
  return new Promise((resolve) => {
    const req = {
      path,
      method,
      originalUrl: path,
      user: { role, permissions },
    };
    let settled = false;
    const done = (error) => {
      if (settled) return;
      settled = true;
      resolve(error || null);
    };
    try {
      const result = apiPermissionMiddleware(req, {}, done);
      if (result !== undefined) done(null);
    } catch (error) { done(error); }
  });
}

test("COST-RBAC 成本接口不再走未命中默认放行", async () => {
  const worker = await check("/project_cost_entries", "GET", [], "worker");
  assert.ok(worker);
  assert.equal(worker.status, 403);

  const workerRollup = await check("/equipment_instances/1/cost_rollup", "GET", [], "worker");
  assert.equal(workerRollup.status, 403);

  const workerVariance = await check("/equipment_instances/1/cost_variance", "GET", [], "worker");
  assert.equal(workerVariance.status, 403);

  const admin = await check("/project_cost_entries", "GET", ["*"], "admin");
  assert.equal(admin, null);

  const foreman = await check("/project_cost_entries", "GET", ["report:read"], "foreman");
  assert.equal(foreman, null);

  const workerWrite = await check("/project_cost_entries", "POST", [], "worker");
  assert.equal(workerWrite.status, 403);
});
