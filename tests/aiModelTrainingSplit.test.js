"use strict";
// Regression guard for the services/ai/modelTraining.js -> services/ai/modelTraining/ split.
//
// Covers two real defects introduced while splitting the module:
//   1) broken relative require depths (module failed to load at all);
//   2) `new ApiError.validation(...)` on a static factory method, which throws
//      "TypeError: ... is not a constructor" and turned a 400 into a 500.
//
// Author: dsh | Date: 2026-10-10

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const modelTraining = require("../services/ai/modelTraining");
const { ApiError } = require("../app/errors");

const PROJECT_ROOT = path.resolve(__dirname, "..");

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE ai_predictions (id INTEGER PRIMARY KEY AUTOINCREMENT);
    CREATE TABLE iot_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_code TEXT NOT NULL,
      device_name TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE iot_data_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      point_code TEXT NOT NULL,
      point_name TEXT,
      unit TEXT,
      alarm_low REAL,
      alarm_high REAL,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE iot_reading_hourly (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      point_id INTEGER NOT NULL,
      bucket_hour TEXT NOT NULL,
      avg_value REAL,
      sample_count INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'production'
    );
    CREATE TABLE qc_inspections (id INTEGER PRIMARY KEY AUTOINCREMENT);
  `);
  modelTraining.runMigration(db);
  return db;
}

function stubApp() {
  const routes = [];
  return {
    routes,
    get(routePath, handler) {
      routes.push({ method: "GET", path: routePath, handler });
    },
    post(routePath, handler) {
      routes.push({ method: "POST", path: routePath, handler });
    },
  };
}

function callHandler(handler, req) {
  return new Promise((resolve) => {
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
    handler({ query: {}, body: {}, id: "test", ...req }, res, (err) => resolve({ ok: false, err }));
  });
}

test("split module keeps the backward-compatible public surface", () => {
  for (const name of ["predictFaultWithModels", "register", "runMigration", "trainModels"]) {
    assert.equal(typeof modelTraining[name], "function", `missing export: ${name}`);
  }
});

test("every relative require inside the split module resolves", () => {
  const dir = path.join(PROJECT_ROOT, "services", "ai", "modelTraining");
  const requirePattern = /require\(\s*["']([^"']+)["']\s*\)/g;
  const missing = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".js")) continue;
    const source = fs
      .readFileSync(path.join(dir, file), "utf8")
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
      })
      .join("\n");
    for (const match of source.matchAll(requirePattern)) {
      const request = match[1];
      if (!request.startsWith(".")) continue;
      const base = path.resolve(dir, request);
      const resolved = ["", ".js", ".json", "/index.js"].some((suffix) => fs.existsSync(`${base}${suffix}`));
      if (!resolved) missing.push(`${file}: ${request}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("POST /api/ai/models/train reports a 400 ApiError when nothing is trainable", async () => {
  const db = makeDb();
  const app = stubApp();
  modelTraining.register(app, db);
  const route = app.routes.find((item) => item.method === "POST" && item.path === "/api/ai/models/train");
  assert.ok(route, "train route must be registered");

  const result = await callHandler(route.handler, { body: {}, user: null });
  assert.equal(result.ok, false, "train route must reject when no series qualifies");
  assert.ok(result.err instanceof ApiError, `expected ApiError, got ${result.err && result.err.constructor.name}: ${result.err && result.err.message}`);
  assert.equal(result.err.status, 400);
  assert.equal(result.err.code, "VALIDATION_ERROR");
  assert.match(result.err.message, /没有达到训练门槛/);
  db.close();
});

test("GET /api/ai/models/readiness answers with readiness payload", async () => {
  const db = makeDb();
  const app = stubApp();
  modelTraining.register(app, db);
  const route = app.routes.find((item) => item.method === "GET" && item.path === "/api/ai/models/readiness");
  assert.ok(route, "readiness route must be registered");

  const result = await callHandler(route.handler, {});
  assert.equal(result.ok, true);
  assert.equal(result.res.statusCode, 200);
  assert.equal(result.res.body.iot.status, "insufficient_data");
  assert.equal(result.res.body.active_models, 0);
  db.close();
});

test("simulator training is refused outside IOT_MODE=simulator", () => {
  const previous = process.env.IOT_MODE;
  process.env.IOT_MODE = "production";
  const db = makeDb();
  try {
    assert.throws(
      () => modelTraining.trainModels(db, { data_source: "simulator" }),
      (error) => error instanceof ApiError && error.status === 400 && /禁止使用模拟数据训练模型/.test(error.message),
    );
  } finally {
    if (previous === undefined) delete process.env.IOT_MODE;
    else process.env.IOT_MODE = previous;
    db.close();
  }
});

test("predictFaultWithModels returns null when no active model exists", () => {
  const db = makeDb();
  try {
    assert.equal(modelTraining.predictFaultWithModels(db, "NO-SUCH-DEVICE", 168), null);
  } finally {
    db.close();
  }
});

test("no ApiError static factory is invoked with new (would throw TypeError)", () => {
  const offenders = [];
  const scanRoots = ["services", "routes", "middleware", "app"];
  const pattern = /new\s+ApiError\./;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(full);
      } else if (entry.name.endsWith(".js")) {
        const source = fs.readFileSync(full, "utf8");
        source.split("\n").forEach((line, index) => {
          if (pattern.test(line)) offenders.push(`${path.relative(PROJECT_ROOT, full)}:${index + 1}`);
        });
      }
    }
  };
  for (const root of scanRoots) {
    const full = path.join(PROJECT_ROOT, root);
    if (fs.existsSync(full)) walk(full);
  }
  assert.deepEqual(offenders, []);
});
