"use strict";
// tests/dataScope.test.js
// P1-1（2026-10-18）：权限点 × 数据范围（行级权限）。
// 覆盖：范围解析优先级、SQL 过滤生成、缺配置拒绝、范围不支持时的降级、单行 403 判定、
//       DB 加载、以及"同角色不同项目看到不同工单数量"的验收场景。

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const dataScope = require("../app/dataScope");

function ctx(scope, config = {}, userId = 1) {
  return { scope, config: dataScope.normalizeConfig(config), user_id: userId };
}

test("DS.1 resolveScope：用户覆盖 > 角色组 > 默认 all", () => {
  assert.equal(dataScope.resolveScope({ data_scope: "self" }, { data_scope: "instance", scope_config: "{}" }).scope, "self");
  assert.equal(dataScope.resolveScope({}, { data_scope: "workshop" }).source, "role_group");
  assert.equal(dataScope.resolveScope({}, null).scope, "all");
  assert.equal(dataScope.resolveScope({}, null).source, "default");
  // 非法值忽略
  assert.equal(dataScope.resolveScope({ data_scope: "bogus" }, { data_scope: "self" }).scope, "self");
});

test("DS.2 normalizeConfig：兼容 project_ids/instance_ids、去重、非法 JSON 不炸", () => {
  const c1 = dataScope.normalizeConfig({ project_ids: [1, "2", 2, null] });
  assert.deepEqual(c1.project_ids, [1, 2]);
  const c2 = dataScope.normalizeConfig({ instance_ids: [3] });
  assert.deepEqual(c2.project_ids, [3]);
  assert.deepEqual(dataScope.normalizeConfig("not-json").project_ids, []);
  assert.deepEqual(dataScope.normalizeConfig(null).workstation_ids, []);
});

test("DS.3 buildFilter：work_orders 五种范围", () => {
  assert.equal(dataScope.buildFilter("work_orders", ctx("all"), "wo").clause, "");
  const self = dataScope.buildFilter("work_orders", ctx("self"), "wo");
  assert.equal(self.clause, "wo.assigned_to = ?");
  assert.deepEqual(self.params, [1]);
  const inst = dataScope.buildFilter("work_orders", ctx("instance", { project_ids: [2, 3] }), "wo");
  assert.equal(inst.clause, "wo.equipment_instance_id IN (?,?)");
  assert.deepEqual(inst.params, [2, 3]);
  const ws = dataScope.buildFilter("work_orders", ctx("workshop", { subsystem_ids: [5] }), "wo");
  assert.equal(ws.clause, "wo.subsystem_id IN (?)");
  const station = dataScope.buildFilter("work_orders", ctx("workstation", { workstation_ids: [7] }), "wo");
  assert.equal(station.clause, "wo.workstation_id IN (?)");
});

test("DS.4 buildFilter：缺配置时默认拒绝（1=0），绝不放量", () => {
  const f = dataScope.buildFilter("work_orders", ctx("instance", {}), "wo");
  assert.equal(f.clause, "1 = 0");
  assert.equal(f.supported, true);
});

test("DS.5 buildFilter：实体不支持该范围 → 不过滤但 supported=false + warning", () => {
  const f = dataScope.buildFilter("work_orders", ctx("warehouse", { locations: ["A1"] }), "wo");
  assert.equal(f.clause, "");
  assert.equal(f.supported, false);
  assert.match(f.warning, /不支持数据范围/);
});

test("DS.6 buildFilter：qc_inspections 按工位/车间走工单子查询", () => {
  const byStation = dataScope.buildFilter("qc_inspections", ctx("workstation", { workstation_ids: [7, 8] }), "q");
  assert.match(byStation.clause, /q\.work_order_id IN \(SELECT id FROM work_orders WHERE workstation_id IN \(\?,\?\)\)/);
  assert.deepEqual(byStation.params, [7, 8]);
  const bySelf = dataScope.buildFilter("qc_inspections", ctx("self"), "q");
  assert.equal(bySelf.clause, "q.inspector_id = ?");
});

test("DS.7 buildFilter：material_movements 仓库范围（无配置=全部库房收发）", () => {
  const noCfg = dataScope.buildFilter("material_movements", ctx("warehouse"), "mm");
  assert.match(noCfg.clause, /from_location IS NOT NULL OR mm\.to_location IS NOT NULL/);
  const withCfg = dataScope.buildFilter("material_movements", ctx("warehouse", { locations: ["A1", "B2"] }), "mm");
  assert.match(withCfg.clause, /from_location IN \(\?,\?\) OR mm\.to_location IN \(\?,\?\)/);
  assert.deepEqual(withCfg.params, ["A1", "B2"]);
});

test("DS.8 rowInScope：详情越权判定", () => {
  const projectCtx = ctx("instance", { project_ids: [1] });
  assert.equal(dataScope.rowInScope("work_orders", projectCtx, { equipment_instance_id: 1 }), true);
  assert.equal(dataScope.rowInScope("work_orders", projectCtx, { equipment_instance_id: 2 }), false);
  const selfCtx = ctx("self", {}, 5);
  assert.equal(dataScope.rowInScope("work_orders", selfCtx, { assigned_to: 5 }), true);
  assert.equal(dataScope.rowInScope("work_orders", selfCtx, { assigned_to: 6 }), false);
  assert.equal(dataScope.rowInScope("qc_inspections", ctx("instance", { project_ids: [3] }), { equipment_instance_id: 3 }), true);
  assert.equal(dataScope.rowInScope("work_orders", ctx("all"), { id: 1 }), true);
  // 不支持的范围 → 不放行
  assert.equal(dataScope.rowInScope("work_orders", ctx("warehouse"), { id: 1 }), false);
});

test("DS.9 loadScope：从 DB 读用户覆盖 / 角色组继承", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role_code TEXT, role_group_id INTEGER, data_scope TEXT, data_scope_config TEXT);
    CREATE TABLE role_groups (id INTEGER PRIMARY KEY, data_scope TEXT, scope_config TEXT);
    INSERT INTO users VALUES (1, 'foreman', 1, NULL, NULL);
    INSERT INTO users VALUES (2, 'foreman', 1, 'self', NULL);
    INSERT INTO users VALUES (3, 'admin', NULL, NULL, NULL);
    INSERT INTO role_groups VALUES (1, 'instance', '{"project_ids":[2]}');
  `);
  const inherited = dataScope.loadScope(db, 1);
  assert.equal(inherited.scope, "instance");
  assert.equal(inherited.source, "role_group");
  assert.deepEqual(inherited.config.project_ids, [2]);
  const overridden = dataScope.loadScope(db, 2);
  assert.equal(overridden.scope, "self");
  assert.equal(overridden.source, "user");
  assert.equal(dataScope.loadScope(db, 3).scope, "all");
  assert.equal(dataScope.loadScope(db, 999).source, "missing_user");
  db.close();
});

test("DS.10 验收：同角色、不同项目配置 → 看到的工单数量不同（真实 SQL 过滤）", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role_code TEXT, role_group_id INTEGER, data_scope TEXT, data_scope_config TEXT);
    CREATE TABLE role_groups (id INTEGER PRIMARY KEY, data_scope TEXT, scope_config TEXT);
    CREATE TABLE work_orders (id INTEGER PRIMARY KEY, wo_code TEXT, equipment_instance_id INTEGER, subsystem_id INTEGER, workstation_id INTEGER, assigned_to INTEGER);
    INSERT INTO users VALUES (1, 'foreman', 1, NULL, NULL);
    INSERT INTO users VALUES (2, 'foreman', 2, NULL, NULL);
    INSERT INTO role_groups VALUES (1, 'instance', '{"project_ids":[1]}');
    INSERT INTO role_groups VALUES (2, 'instance', '{"project_ids":[2]}');
    INSERT INTO work_orders VALUES (1, 'WO-A', 1, 10, 100, 1), (2, 'WO-B', 2, 20, 200, 2), (3, 'WO-C', 1, 10, 100, 1);
  `);
  const countFor = (userId) => {
    const scope = dataScope.loadScope(db, userId);
    const filter = dataScope.buildFilter("work_orders", scope, "wo");
    let sql = "SELECT COUNT(*) c FROM work_orders wo WHERE 1=1";
    const params = [];
    if (filter.clause) { sql += " AND " + filter.clause; params.push(...filter.params); }
    return db.prepare(sql).get(params).c;
  };
  assert.equal(countFor(1), 2, "项目 1 只看到 2 张工单");
  assert.equal(countFor(2), 1, "项目 2 只看到 1 张工单");
  db.close();
});
