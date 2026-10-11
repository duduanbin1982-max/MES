"use strict";
// services/andon/ 拆分的回归守卫 (2026-10-11)
//
// andonService 原本只有 { register } 一个导出，全部逻辑都塞在 register 的闭包里。
// 拆分后最容易静默出错的正是"路由少一条/多一条"和"闭包变量没接上"，
// 所以这里逐条比对路由清单，并真的触发一次告警。

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MODULE_DIR = path.join(PROJECT_ROOT, "services", "andon");
const andon = require("../services/andon");

// 拆分前 services/andonService.js 里注册的 18 条路由
const EXPECTED_ROUTES = [
  ["GET", "/api/andon/alerts"],
  ["GET", "/api/andon/alerts/:id"],
  ["POST", "/api/andon/alerts/:id/ack"],
  ["POST", "/api/andon/alerts/:id/resolve"],
  ["GET", "/api/andon/stats"],
  ["POST", "/api/andon/trigger"],
  ["GET", "/api/andon/rules"],
  ["POST", "/api/andon/rules"],
  ["PUT", "/api/andon/rules/:id"],
  ["POST", "/api/andon/scan"],
  ["POST", "/api/andon/channels"],
  ["GET", "/api/andon/channels"],
  ["PUT", "/api/andon/channels/:id"],
  ["DELETE", "/api/andon/channels/:id"],
  ["POST", "/api/andon/channels/:id/test"],
  ["GET", "/api/andon/escalation-rules"],
  ["POST", "/api/andon/escalation-rules"],
  ["PUT", "/api/andon/escalation-rules/:id"],
];

const ALERTS_DDL = `
  CREATE TABLE andon_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alert_type TEXT, source_type TEXT, source_id INTEGER,
    title TEXT, message TEXT, severity TEXT,
    triggered_by TEXT, data_json TEXT,
    status TEXT DEFAULT 'open',
    acknowledged_by INTEGER, acknowledged_at TEXT,
    resolved_by INTEGER, resolved_at TEXT, resolution_note TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`;

function makeApp() {
  const routes = [];
  const push = (method) => (routePath) => routes.push([method, routePath]);
  return {
    routes,
    get: push("GET"),
    post: push("POST"),
    put: push("PUT"),
    delete: push("DELETE"),
  };
}

test("ANDON.1 公共面保留 register，并额外暴露可测的内部件", () => {
  for (const name of ["register", "ensureSchema", "createAlertEngine", "createNotifier"]) {
    assert.equal(typeof andon[name], "function", `missing export: ${name}`);
  }
});

test("ANDON.2 拆分目录里每个相对 require 都能解析", () => {
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

test("ANDON.3 register 装配的 18 条路由与拆分前逐条一致", () => {
  const db = new Database(":memory:");
  const app = makeApp();
  andon.register(app, db);
  const sortKey = (pair) => `${pair[0]} ${pair[1]}`;
  assert.deepEqual(app.routes.map(sortKey).sort(), EXPECTED_ROUTES.map(sortKey).sort());
  db.close();
});

test("ANDON.4 ensureSchema 建出通知渠道表与升级规则表", () => {
  const db = new Database(":memory:");
  andon.ensureSchema(db);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((row) => row.name);
  assert.ok(tables.includes("andon_notify_channels"));
  assert.ok(tables.includes("andon_escalation_rules"));
  const channelColumns = db.prepare("PRAGMA table_info(andon_notify_channels)").all().map((c) => c.name);
  assert.ok(channelColumns.includes("webhook_url"));
  assert.ok(channelColumns.includes("notify_severities"));
  db.close();
});

test("ANDON.5 register 暴露的 app._andonTrigger 仍按冷却窗口去重", () => {
  const db = new Database(":memory:");
  db.exec(ALERTS_DDL);
  const app = makeApp();
  andon.register(app, db);

  assert.equal(typeof app._andonTrigger, "function", "app._andonTrigger 必须仍然暴露");
  const first = app._andonTrigger("t_low", "material", 7, "标题", "正文", "danger", { a: 1 }, 60);
  assert.ok(Number.isInteger(first) && first > 0, "首次触发应返回告警 id");

  const row = db.prepare("SELECT * FROM andon_alerts WHERE id = ?").get(first);
  assert.equal(row.alert_type, "t_low");
  assert.equal(row.source_id, 7);
  assert.equal(row.severity, "danger");
  assert.equal(row.triggered_by, "system");
  assert.deepEqual(JSON.parse(row.data_json), { a: 1 });

  const second = app._andonTrigger("t_low", "material", 7, "标题", "正文", "danger", { a: 1 }, 60);
  assert.equal(second, null, "冷却窗口内的同源同类告警应被去重");
  db.close();
});
