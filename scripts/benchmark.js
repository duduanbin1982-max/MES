"use strict";
require("dotenv").config();
// scripts/benchmark.js
// P1-2 性能压测: 覆盖关键 API 端点, 测 QPS/延迟/慢查询
// Usage: node scripts/benchmark.js [--host=http://127.0.0.1:3890] [--token=<jwt>]
// Author: 三狗子 | Date: 2026-06-25

const http = require("http");
const https = require("https");
const { signAccess } = require("../app/jwt");

const HOST = process.env.BENCH_HOST || "http://127.0.0.1:3890";
const CONCURRENCY = parseInt(process.env.BENCH_CONCURRENCY || "10", 10);
const ITERATIONS = parseInt(process.env.BENCH_ITERATIONS || "5", 10);

// 生成测试 token
const token = signAccess({ sub: 1, role: "admin", permissions: ["*"], full_name: "Benchmark" }).token;

const endpoints = [
  // 健康检查
  { name: "health",          method: "GET",  path: "/api/health" },
  // 只读查询
  { name: "instances",       method: "GET",  path: "/api/equipment_instances" },
  { name: "workstations",    method: "GET",  path: "/api/workstations" },
  { name: "materials_list",  method: "GET",  path: "/api/materials" },
  { name: "work_orders",     method: "GET",  path: "/api/work_orders" },
  { name: "inventory",       method: "GET",  path: "/api/inventory" },
  { name: "bom_tree",        method: "GET",  path: "/api/equipment_instances/1/bom" },
  { name: "process_tree",    method: "GET",  path: "/api/equipment_instances/1/process_tree" },
  { name: "eco_list",        method: "GET",  path: "/api/equipment_instances/1/eco" },
  { name: "cost_rollup",     method: "GET",  path: "/api/equipment_instances/1/cost/rollup" },
  { name: "suppliers",       method: "GET",  path: "/api/suppliers" },
  { name: "audit_logs",      method: "GET",  path: "/api/audit" },
  { name: "key_components",  method: "GET",  path: "/api/key_components" },
  { name: "purchase_orders", method: "GET",  path: "/api/purchase_orders" },
  { name: "material_lots",   method: "GET",  path: "/api/material_lots" },
  { name: "roles",           method: "GET",  path: "/api/roles" },
  { name: "users",           method: "GET",  path: "/api/users" },
  { name: "inventory_alerts",method: "GET",  path: "/api/inventory/alerts" },
  { name: "settings",        method: "GET",  path: "/api/settings" },
  { name: "db_stats",        method: "GET",  path: "/api/debug/db-stats" },
];

function request(method, urlPath) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlPath, HOST);
    const mod = u.protocol === "https:" ? https : http;
    const opts = {
      hostname: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + u.search,
      method,
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      rejectUnauthorized: false,
      timeout: 10000,
    };
    const start = process.hrtime.bigint();
    const req = mod.request(opts, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        const dur = Number(process.hrtime.bigint() - start) / 1e6;
        resolve({ status: res.statusCode, duration_ms: Math.round(dur * 100) / 100, size: body.length, ok: res.statusCode < 400 });
      });
    });
    req.on("error", (e) => {
      const dur = Number(process.hrtime.bigint() - start) / 1e6;
      resolve({ status: 0, duration_ms: Math.round(dur * 100) / 100, size: 0, ok: false, error: e.message });
    });
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, duration_ms: 10000, size: 0, ok: false, error: "timeout" }); });
    req.end();
  });
}

async function run() {
  console.log("=== P1-2 性能压测 ===");
  console.log("Host: " + HOST);
  console.log("Concurrency: " + CONCURRENCY);
  console.log("Iterations: " + ITERATIONS);
  console.log("Endpoints: " + endpoints.length);
  console.log("");

  const results = {};

  for (const ep of endpoints) {
    const times = [];
    let errors = 0;

    // Warm-up
    await request(ep.method, ep.path);

    for (let round = 0; round < ITERATIONS; round++) {
      const batch = [];
      for (let c = 0; c < CONCURRENCY; c++) {
        batch.push(request(ep.method, ep.path));
      }
      const responses = await Promise.all(batch);
      for (const r of responses) {
        if (r.ok) times.push(r.duration_ms);
        else errors++;
      }
    }

    const n = times.length;
    times.sort((a, b) => a - b);
    const avg = n ? Math.round(times.reduce((s, t) => s + t, 0) / n * 100) / 100 : 0;
    const p50 = n ? times[Math.floor(n * 0.5)] : 0;
    const p95 = n ? times[Math.floor(n * 0.95)] : 0;
    const p99 = n ? times[Math.floor(n * 0.99)] : 0;
    const min = n ? times[0] : 0;
    const max = n ? times[n - 1] : 0;
    const qps = avg > 0 ? Math.round(1000 / avg) : 0;

    results[ep.name] = { avg, p50, p95, p99, min, max, n, errors, qps };
    const flag = avg > 200 ? "🔴" : avg > 100 ? "🟡" : "🟢";
    console.log(flag + " " + ep.name.padEnd(20) + " avg=" + String(avg).padStart(7) + "ms  p95=" + String(p95).padStart(7) + "ms  qps=" + String(qps).padStart(5) + "  n=" + n + (errors ? "  ERR=" + errors : ""));
  }

  // Summary
  const allAvg = Object.values(results).reduce((s, r) => s + r.avg, 0) / Object.keys(results).length;
  const slow = Object.entries(results).filter(([, r]) => r.avg > 100).sort((a, b) => b[1].avg - a[1].avg);
  console.log("\n=== Summary ===");
  console.log("Overall avg: " + Math.round(allAvg) + "ms");
  console.log("Slow endpoints (>100ms): " + slow.length);
  if (slow.length) {
    console.log("Top slow:");
    slow.slice(0, 5).forEach(([name, r]) => console.log("  " + name + ": avg=" + r.avg + "ms p95=" + r.p95 + "ms"));
  }

  // Fetch DB stats
  console.log("\n=== DB Stats ===");
  const statsRes = await request("GET", "/api/debug/db-stats");
  if (statsRes.ok) {
    // get the body by re-fetching
    const u = new URL("/api/debug/db-stats", HOST);
    const mod = u.protocol === "https:" ? https : http;
    const body = await new Promise((resolve) => {
      mod.get(u.pathname, { headers: { Authorization: "Bearer " + token }, rejectUnauthorized: false }, (res) => {
        let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => resolve(b));
      });
    });
    try {
      const stats = JSON.parse(body);
      console.log("  Total queries: " + stats.calls);
      console.log("  Avg duration: " + Math.round(stats.avgMs * 100) / 100 + "ms");
      console.log("  Max duration: " + Math.round(stats.maxMs * 100) / 100 + "ms");
      console.log("  Slow queries (>50ms): " + stats.slowCount);
      console.log("  QPS: " + stats.qps);
      console.log("  Uptime: " + stats.uptime_sec + "s");
    } catch (_e) { console.log("  (parse error)"); }
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
