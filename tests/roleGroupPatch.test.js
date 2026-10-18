"use strict";
// tests/roleGroupPatch.test.js
// P1-1（2026-10-18）：角色组 PATCH 参数规范化 —— 修的线上 bug：
//   el-switch 提交布尔 is_active=true 时 better-sqlite3 无法绑定 → 500「服务内部错误」。
const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeRoleGroupPatch } = require("../services/userManagement");

test("RG.1 is_active 布尔 → 0/1（修复 500 的根因）", () => {
  assert.deepEqual(normalizeRoleGroupPatch({ is_active: true }).params, [1]);
  assert.deepEqual(normalizeRoleGroupPatch({ is_active: false }).params, [0]);
  assert.deepEqual(normalizeRoleGroupPatch({ is_active: 0 }).params, [0]);
});

test("RG.2 scope_config 接受对象 → JSON 字符串；字符串原样校验", () => {
  assert.deepEqual(normalizeRoleGroupPatch({ scope_config: { subsystem_ids: [1] } }).params, ['{"subsystem_ids":[1]}']);
  assert.deepEqual(normalizeRoleGroupPatch({ scope_config: '{"project_ids":[2]}' }).params, ['{"project_ids":[2]}']);
  assert.deepEqual(normalizeRoleGroupPatch({ scope_config: {} }).params, ["{}"]);
  assert.deepEqual(normalizeRoleGroupPatch({ scope_config: null }).params, ["{}"]);
});

test("RG.3 非法 JSON / 非法 data_scope → 抛 400 错误", () => {
  assert.throws(() => normalizeRoleGroupPatch({ scope_config: "{bad" }), /不是合法 JSON/);
  assert.throws(() => normalizeRoleGroupPatch({ data_scope: "bogus" }), /data_scope 非法/);
});

test("RG.4 data_scope 合法值通过；空值归一为 all", () => {
  assert.deepEqual(normalizeRoleGroupPatch({ data_scope: "workshop" }).params, ["workshop"]);
  assert.deepEqual(normalizeRoleGroupPatch({ data_scope: null }).params, ["all"]);
});

test("RG.5 只更新传入字段（不误改其它列）", () => {
  const { sets, params } = normalizeRoleGroupPatch({ group_name: "生产部", is_active: true });
  assert.deepEqual(sets, ["group_name = ?", "is_active = ?"]);
  assert.deepEqual(params, ["生产部", 1]);
  // 空 body → 没有可更新字段（路由层据此返回 400）
  assert.deepEqual(normalizeRoleGroupPatch({}).sets, []);
});
