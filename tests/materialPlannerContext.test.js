"use strict";
// tests/materialPlannerContext.test.js
// 守卫：materialPlanner 的 ctx 必须暴露各路由文件实际解构的 helper。
// 背景（2026-10-17 ESLint 落地）：AST 拆分后 routes_2.js 解构了 get，但 context.js 返回里没有 get，
// 导致 /api/material-planner/mrp 一直 500（TypeError: get is not a function），且没有用例覆盖到。

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const createContext = require("../services/materialPlanner/context");

test("MPC.1 ctx 暴露 all/get/run（路由文件会直接解构这三个）", () => {
  const db = new Database(":memory:");
  const ctx = createContext({}, db);
  for (const key of ["all", "get", "run"]) {
    assert.equal(typeof ctx[key], "function", `ctx.${key} 必须是函数`);
  }
  assert.equal(typeof ctx.getMaterialAlerts, "function");
  assert.equal(typeof ctx.getKitCheck, "function");
  db.close();
});

test("MPC.2 静态守卫：各 routes_*.js 从 ctx 解构的名字都在 ctx 里存在", () => {
  const db = new Database(":memory:");
  const ctx = createContext({}, db);
  const dir = path.join(__dirname, "..", "services", "materialPlanner");
  const files = fs.readdirSync(dir).filter((f) => /^routes_\d+\.js$/.test(f));
  assert.ok(files.length > 0, "应存在 routes_*.js");
  for (const file of files) {
    const src = fs.readFileSync(path.join(dir, file), "utf8");
    const m = src.match(/const\s*\{([^}]+)\}\s*=\s*ctx;?/);
    if (!m) continue;
    const names = m[1].split(",").map((s) => s.trim().split(":")[0].trim()).filter(Boolean);
    for (const name of names) {
      assert.ok(name in ctx, `${file} 解构了 ctx.${name}，但 context.js 没有返回它`);
    }
  }
  db.close();
});
