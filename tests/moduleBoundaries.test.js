"use strict";
// tests/moduleBoundaries.test.js
// 2026-11-02：模块边界检查器（scripts/check-module-boundaries.js）的自测 + 棘轮。
//
// 棘轮含义：当前仓库必须"零违规"。新增跨服务 require / 跨域写时：
//   · 要么改代码（走对方服务或只读视图）；
//   · 要么在 config/moduleBoundaries.json 登记原因。

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const boundaries = require("../scripts/check-module-boundaries");
const { SERVICES } = require("../services/registry");

const CONFIG_PATH = path.join(ROOT, "config", "moduleBoundaries.json");

test("MB.1 当前仓库模块边界零违规（棘轮）", () => {
  const result = boundaries.analyze();
  if (!result.ok) {
    const lines = [
      ...result.requireViolations.map((row) => `跨服务 require: ${row.owner} -> ${row.target} (${row.file})`),
      ...result.writeViolations.map((row) => `跨域写: ${row.owner} 写 ${row.table}（属于 ${row.tableOwner}）(${row.file})`),
    ];
    assert.fail(`模块边界出现新违规（改代码或在 config/moduleBoundaries.json 登记原因）：\n  ${lines.join("\n  ")}`);
  }
  assert.equal(result.tableConflicts.length, 0, "同一张表不应被多个服务声明");
});

test("MB.2 白名单条目都指向真实服务，且都写了原因（无僵尸条目）", () => {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  const names = new Set(SERVICES.map((entry) => entry.name));
  for (const row of config.allowedRequires || []) {
    assert.ok(names.has(row.from), `allowedRequires.from 不存在: ${row.from}`);
    assert.ok(names.has(row.to), `allowedRequires.to 不存在: ${row.to}`);
    assert.ok((row.reason || "").length >= 8, `allowedRequires ${row.from}->${row.to} 缺少原因`);
  }
  for (const row of config.allowedWrites || []) {
    assert.ok(names.has(row.from), `allowedWrites.from 不存在: ${row.from}`);
    assert.ok(typeof row.table === "string" && row.table.length > 0, "allowedWrites 必须写 table");
    assert.ok((row.reason || "").length >= 8, `allowedWrites ${row.from}->${row.table} 缺少原因`);
  }
});

test("MB.3 extractWrites：识别 INSERT/UPDATE/DELETE/ALTER/DROP/CREATE", () => {
  const sql = `
    INSERT OR REPLACE INTO t_insert (a) VALUES (1);
    UPDATE t_update SET a = 1;
    DELETE FROM t_delete WHERE id = 1;
    ALTER TABLE t_alter ADD COLUMN b TEXT;
    DROP TABLE IF EXISTS t_drop;
    CREATE TABLE IF NOT EXISTS t_create (id INTEGER);
    CREATE VIEW v_x AS SELECT 1;
  `;
  const writes = boundaries.extractWrites(sql);
  for (const table of ["t_insert", "t_update", "t_delete", "t_alter", "t_drop", "t_create"]) {
    assert.ok(writes.includes(table), `应识别 ${table}，实际: ${writes.join(",")}`);
  }
  assert.ok(!writes.includes("v_x"), "CREATE VIEW 不算表写入");
});

test("MB.4 ownerOfFile：按路径判定归属，共享文件不归属任何服务", () => {
  const serviceIndex = boundaries.buildServiceIndex();
  const ownership = boundaries.buildFileOwnership(serviceIndex);
  const owned = boundaries.ownerOfFile(path.join(ROOT, "services", "cost", "rollup", "readModel.js"), ownership);
  assert.equal(owned, "cost", "cost 目录下的文件归 cost");
  const sharedRoot = boundaries.ownerOfFile(path.join(ROOT, "services", "fieldServiceSchema.js"), ownership);
  assert.equal(sharedRoot, null, "services 根级非入口文件视为共享");
  const entryFile = boundaries.ownerOfFile(path.join(ROOT, "services", "scanner.js"), ownership);
  assert.equal(entryFile, "scanner", "根级入口文件归对应服务");
});

test("MB.5 归属表数量与 DDL 声明一致（防止归属算法失效后静默通过）", () => {
  const result = boundaries.analyze();
  assert.ok(result.tablesOwned >= 40, `应有 >=40 张表有明确归属，实际 ${result.tablesOwned}`);
  assert.ok(result.services >= 45, `应扫描 >=45 个服务，实际 ${result.services}`);
});

test("MB.6 extractTriggerTargets：识别 CREATE TRIGGER 挂在哪张表", () => {
  const sql = `
    CREATE TRIGGER trg_a AFTER INSERT ON process_nodes BEGIN SELECT 1; END;
    CREATE TRIGGER IF NOT EXISTS trg_b BEFORE UPDATE ON work_orders BEGIN SELECT 1; END;
    CREATE TRIGGER trg_c AFTER DELETE ON equipment_instances BEGIN SELECT 1; END;
    CREATE TABLE t_x (id INTEGER);
  `;
  const targets = boundaries.extractTriggerTargets(sql);
  assert.deepEqual(targets, [
    { name: "trg_a", table: "process_nodes" },
    { name: "trg_b", table: "work_orders" },
    { name: "trg_c", table: "equipment_instances" },
  ]);
});

test("MB.7 跨域触发器必须白名单（进度回写触发器已登记）", () => {
  const result = boundaries.analyze();
  assert.equal(result.triggerViolations.length, 0, "存在未登记的跨域触发器");
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  const triggers = config.allowedTriggers || [];
  assert.ok(triggers.some((row) => row.from === "equipment" && row.table === "process_nodes"));
  assert.ok(triggers.some((row) => row.from === "equipment" && row.table === "work_orders"));
});