"use strict";
// tests/mcpServer.test.js
// P1-2（2026-10-18）：MCP 只读工具服务 —— 协议分发、工具清单、调用参数、只读约束、链接输出。

const test = require("node:test");
const assert = require("node:assert/strict");

const mcp = require("../scripts/mcp-server");

test("MCP.1 tools/list：5 个工具，schema 完整且必填描述", () => {
  const names = mcp.TOOLS.map((tool) => tool.name);
  assert.deepEqual(names.sort(), [
    "mes_anomalies",
    "mes_cost_variance",
    "mes_material_shortage",
    "mes_oee",
    "mes_qc_pass_rate",
    "mes_trace_chain",
    "mes_work_order_progress",
    "mes_workstation_load",
  ]);
  for (const tool of mcp.TOOLS) {
    assert.ok(tool.description.length > 10, tool.name + " 缺描述");
    assert.equal(tool.inputSchema.type, "object");
    assert.ok(tool.inputSchema.properties, tool.name + " 缺 properties");
    assert.equal(typeof tool.handler, "function");
  }
});

test("MCP.2 handleMessage：initialize 返回协议版本与 tools 能力", async () => {
  const res = await mcp.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  assert.equal(res.result.protocolVersion, "2024-11-05");
  assert.ok(res.result.capabilities.tools);
  assert.equal(res.result.serverInfo.name, "tbm-mes");
});

test("MCP.3 handleMessage：tools/list 返回 name/description/inputSchema", async () => {
  const res = await mcp.handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.equal(res.result.tools.length, 8);
  const wo = res.result.tools.find((tool) => tool.name === "mes_work_order_progress");
  assert.ok(wo.inputSchema.properties.status.enum.includes("in_progress"));
});

test("MCP.4 handleMessage：未知方法 → -32601；未知工具 → isError", async () => {
  const unknown = await mcp.handleMessage({ jsonrpc: "2.0", id: 3, method: "nope" });
  assert.equal(unknown.error.code, -32601);
  const badTool = await mcp.handleMessage({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "nope" } });
  assert.equal(badTool.result.isError, true);
  assert.match(badTool.result.content[0].text, /未知工具/);
});

test("MCP.5 withinDays：时间窗过滤（无日期不计入）", () => {
  const now = new Date().toISOString().slice(0, 10);
  assert.equal(mcp.withinDays(now, 7), true);
  assert.equal(mcp.withinDays("2020-01-01", 7), false);
  assert.equal(mcp.withinDays(null, 7), false);
  assert.equal(mcp.withinDays(null, 0), true, "days=0 表示不限");
});

test("MCP.6 webLink：返回可点击深链（验收要求）", () => {
  assert.match(mcp.webLink("/work-orders"), /^http:\/\/127\.0\.0\.1\/work-orders$/);
});

test("MCP.7 工具只读：HTTP 层固定 GET，且没有写接口调用", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "scripts", "mcp-server.js"), "utf8");
  assert.ok(source.includes('method: "GET"'), "HTTP 层必须固定 GET");
  assert.ok(!source.includes('method: "POST"'), "不允许 POST");
  for (const forbidden of ["/dispatch", "/pick-list", "/kit-sync", "/report"]) {
    assert.ok(!source.includes(forbidden), "不允许调用写接口: " + forbidden);
  }
});

test("MCP.8 工具调用：缺料聚合用 GET /kit-check/short 并带清单链接（桩替换 HTTP）", async () => {
  const calls = [];
  // 用桩替换模块内的 GET 传输（避免真的打 API）
  mcp.__setHttpGet(async (path, params) => {
    calls.push({ path, params });
    if (path === "/api/work_orders") {
      return [{ id: 11, wo_code: "WO-011", title: "前盾焊接", status: "pending", instance_code: "TBM-2026-001", planned_start: new Date().toISOString() }];
    }
    if (path === "/api/work_orders/11/kit-check/short") {
      return [{ material_code: "M-001", material_name: "Q355 钢板", required_qty: 10, available_qty: 4, shortage_qty: 6 }];
    }
    return null;
  });
  try {
    const tool = mcp.TOOL_MAP.get("mes_material_shortage");
    const result = await tool.handler({ days: 30 });
    assert.equal(result.shortage_work_orders, 1);
    assert.equal(result.shortages[0].shortage_items[0].shortage, 6);
    assert.match(result.shortages[0].link, /work-orders$/);
    const paths = calls.map((call) => call.path);
    assert.deepEqual(paths, ["/api/work_orders", "/api/work_orders/11/kit-check/short"]);
  } finally {
    mcp.__setHttpGet(null);
  }
});

test("MCP.9 mes_workstation_load：返回最紧三工位与各工位利用率（桩替换 HTTP）", async () => {
  mcp.__setHttpGet(async (path) => {
    if (path === "/api/resources/gantt") {
      return {
        start_date: "2026-06-01", end_date: "2026-06-30", summary: { workstation_count: 2 },
        bottlenecks: { top_overloaded: [{ name: "焊接工位 1", peak_utilization_pct: 300 }], top_idle: [] },
        heatmap: { grid: [
          { ws_id: 3, name: "焊接工位 1", workshop: "焊接", daily_capacity_hours: 8, total_busy_hours: 80, avg_utilization_pct: 33, cells: [{ utilization_pct: 300 }, { utilization_pct: 115 }] },
          { ws_id: 5, name: "镗孔工位", workshop: "机加", daily_capacity_hours: 8, total_busy_hours: 40, avg_utilization_pct: 17, cells: [{ utilization_pct: 110 }] },
        ] },
      };
    }
    return null;
  });
  try {
    const result = await mcp.toolWorkstationLoad({ start_date: "2026-06-01", days: 30 });
    assert.equal(result.top_three[0].name, "焊接工位 1");
    assert.equal(result.workstations[0].peak_utilization_pct, 300, "峰值取 cells 最大值");
    assert.equal(result.workstations.length, 2);
    assert.match(result.link, /multi-schedule$/);
  } finally {
    mcp.__setHttpGet(null);
  }
});

test("MCP.10 mes_cost_variance：按 instance_code 解析 id 并返回三层差异（桩替换 HTTP）", async () => {
  mcp.__setHttpGet(async (path) => {
    if (path === "/api/equipment_instances") return [{ id: 1, instance_code: "TBM-2026-001" }];
    if (path === "/api/equipment_instances/1/cost_variance") {
      return { equipment_instance: { id: 1, instance_code: "TBM-2026-001" },
        totals: { total_variance: 380, quantity_variance: 380, price_variance: 0, efficiency_variance: 0, standard_cost: 380, actual_cost: 760, confidence: "partial" },
        ledger: { entries: 4, other_costs: 0 }, top_contributors: [], data_gaps: ["27 种物料未领料"] };
    }
    return null;
  });
  try {
    const result = await mcp.toolCostVariance({ instance_code: "TBM-2026-001" });
    assert.equal(result.instance.instance_code, "TBM-2026-001");
    assert.equal(result.totals.total_variance, 380);
    assert.equal(result.ledger.entries, 4);
    assert.match(result.link, /cost-variance/);
    const missing = await mcp.toolCostVariance({});
    assert.equal(missing.found, false);
  } finally {
    mcp.__setHttpGet(null);
  }
});
