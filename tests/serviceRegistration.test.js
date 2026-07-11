"use strict";

require("dotenv").config({ quiet: true });
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { SERVICES } = require("../services/registry");

const names = new Set(SERVICES.map((service) => service.name));

test("registers all dashboard services used by frontend routes", () => {
  for (const name of ["maintenanceDashboardService", "criticalPartsService", "supplierDashboardService"]) {
    assert.ok(names.has(name), `${name} must be listed in services/registry.js`);
  }
});

test("registered dashboard service modules exist", () => {
  for (const name of ["maintenanceDashboardService", "criticalPartsService", "supplierDashboardService"]) {
    const service = SERVICES.find((entry) => entry.name === name);
    const modulePath = path.resolve(__dirname, "../services", service.module.replace(/^\.\//, "") + ".js");
    assert.ok(fs.existsSync(modulePath), `${modulePath} must exist`);
  }
});

test("digital twin frontend uses registered dt API namespace", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../frontend/src/views/DigitalTwin.vue"), "utf8");
  assert.match(source, /Api\.get\("\/dt\/models"/);
  assert.doesNotMatch(source, /Api\.get\("\/digital-twin\/parts"\)/);
});
