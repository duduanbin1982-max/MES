"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const digitalTwin = require("../services/digitalTwinService");
const criticalParts = require("../services/criticalPartsService");
const { deviceReadiness } = require("../services/iotService");

test("GLB validation accepts binary glTF magic only", () => {
  const valid = Buffer.alloc(20);
  valid.write("glTF", 0, "ascii");
  assert.equal(digitalTwin.validateGlb(valid, "tbm.glb"), true);
  assert.throws(() => digitalTwin.validateGlb(Buffer.from("not-a-model-file-1234"), "tbm.glb"), /GLB/);
  assert.throws(() => digitalTwin.validateGlb(valid, "tbm.obj"), /.glb/);
});

test("production device readiness requires connection and active points", () => {
  assert.equal(deviceReadiness({ protocol: "modbus", ip_address: null, port: 502 }, 3).configured, false);
  assert.equal(deviceReadiness({ protocol: "modbus", ip_address: "192.0.2.10", port: 502 }, 0).configured, false);
  assert.equal(deviceReadiness({ protocol: "modbus", ip_address: "192.0.2.10", port: 502 }, 3).configured, true);
  assert.equal(deviceReadiness({ protocol: "mqtt", connection_string: "mqtt://broker" }, 1).configured, true);
});

test("critical part certificates gain canonical document reference", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE critical_part_certificates (id INTEGER PRIMARY KEY, part_id INTEGER, file_path TEXT)");
  criticalParts.ensureSchema(db);
  const columns = new Set(db.prepare("PRAGMA table_info(critical_part_certificates)").all().map((column) => column.name));
  assert.ok(columns.has("document_id"));
});
