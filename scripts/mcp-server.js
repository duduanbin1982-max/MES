#!/usr/bin/env node
"use strict";
// scripts/mcp-server.js
// P1-2（2026-10-18）：TBM-MES 的 MCP（Model Context Protocol）只读工具服务。
//
// 设计原则（对应《开源 MES 对标分析》P1-2）：
//   1) **只读**：工具只调用 GET /api/*；没有任何写路径
//   2) **不绕过鉴权**：用本地 API + Bearer token（默认按 MES_MCP_USER_ID 现签一个短时 token），
//      因此天然受 RBAC 权限点 + P1-1 数据范围（行级权限）约束
//   3) **零依赖**：stdio + 换行分隔的 JSON-RPC 2.0，直接 node 运行，不需要 npm install
//
// 用法（MCP 客户端配置里把 command 指到本文件即可）：
//   node scripts/mcp-server.js
// 环境变量：
//   MES_API_BASE    默认 http://127.0.0.1:3890
//   MES_WEB_BASE    默认 http://127.0.0.1（用于返回可点击链接）
//   MES_MCP_USER_ID 默认 1（admin）。改成普通用户 id 即可继承其数据范围
//   MES_MCP_TOKEN   可选，直接给 token（不给就现签一个 1 小时的只读 token）
//
// 协议：initialize / notifications/initialized / tools/list / tools/call / ping

const http = require("node:http");
const path = require("node:path");
const readline = require("node:readline");

// 从仓库根目录加载 .env（JWT_SECRET 等）；没有 .env 时跳过
try { process.loadEnvFile(path.join(__dirname, "..", ".env")); } catch (_e) { /* 可选 */ }

const API_BASE = (process.env.MES_API_BASE || "http://127.0.0.1:3890").replace(/\/$/, "");
const WEB_BASE = (process.env.MES_WEB_BASE || "http://127.0.0.1").replace(/\/$/, "");
const USER_ID = Number(process.env.MES_MCP_USER_ID || 1);
const READ_PERMISSIONS = ["work_order:read", "pick:read", "quality:read", "report:read", "equipment:read"];
const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "tbm-mes", version: "1.0.0" };

// ---------------------------------------------------------------- HTTP（只读）
function httpGetJson(path, params = {}) {
  const url = new URL(API_BASE + path);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  const token = currentToken();
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: "GET", headers: { Authorization: "Bearer " + token } }, (res) => {
      let raw = "";
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        if (res.statusCode >= 400) {
          const error = new Error(`MES API ${res.statusCode} for ${path}: ${raw.slice(0, 200)}`);
          error.status = res.statusCode;
          return reject(error);
        }
        try { resolve(raw ? JSON.parse(raw) : null); } catch (_e) { resolve(raw); }
      });
    });
    req.on("error", reject);
    req.setTimeout(10000, () => { req.destroy(new Error("MES API timeout")); });
    req.end();
  });
}

let cachedToken = null;
let cachedTokenAt = 0;
function currentToken() {
  if (process.env.MES_MCP_TOKEN) return process.env.MES_MCP_TOKEN;
  const now = Date.now();
  if (cachedToken && now - cachedTokenAt < 50 * 60 * 1000) return cachedToken;
  const { signAccess } = require("../app/jwt");
  cachedToken = signAccess({ sub: USER_ID, role: "mcp_reader", permissions: READ_PERMISSIONS }).token;
  cachedTokenAt = now;
  return cachedToken;
}

// 可注入的 GET 传输（单测里替换成桩，避免真的打 API）
let getJson = httpGetJson;
function __setHttpGet(fn) { getJson = typeof fn === "function" ? fn : httpGetJson; }

// ---------------------------------------------------------------- 工具实现
function webLink(path) {
  return WEB_BASE + path;
}

function withinDays(dateText, days) {
  if (!days) return true;
  if (!dateText) return false;
  const t = Date.parse(String(dateText).replace(" ", "T"));
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= Number(days) * 86400000;
}

async function toolWorkOrderProgress(args) {
  const days = Number(args.days) || 30;
  const limit = Math.min(Number(args.limit) || 20, 100);
  const rows = await getJson("/api/work_orders", { status: args.status, equipment_instance_id: args.instance_id });
  const list = (Array.isArray(rows) ? rows : [])
    .filter((wo) => withinDays(wo.planned_start || wo.actual_start, days)
      || ["pending", "in_progress", "blocked"].includes(wo.status))
    .slice(0, limit)
    .map((wo) => ({
      wo_code: wo.wo_code,
      title: wo.title,
      status: wo.status,
      priority: wo.priority,
      instance: wo.instance_code || null,
      planned_start: wo.planned_start,
      planned_end: wo.planned_end,
      progress: wo.quantity_planned ? Math.round(((wo.quantity_completed || 0) / wo.quantity_planned) * 100) : null,
      link: webLink("/work-orders"),
    }));
  return {
    window_days: days,
    count: list.length,
    summary: {
      pending: list.filter((w) => w.status === "pending").length,
      in_progress: list.filter((w) => w.status === "in_progress").length,
      blocked: list.filter((w) => w.status === "blocked").length,
    },
    work_orders: list,
  };
}

async function toolMaterialShortage(args) {
  const days = Number(args.days) || 14;
  const maxWos = Math.min(Number(args.max_work_orders) || 20, 50);
  const rows = await getJson("/api/work_orders", { status: args.status || "pending", equipment_instance_id: args.instance_id });
  const candidates = (Array.isArray(rows) ? rows : []).slice(0, maxWos);
  const shortages = [];
  for (const wo of candidates) {
    let short;
    try {
      short = await getJson(`/api/work_orders/${wo.id}/kit-check/short`);
    } catch (_error) {
      continue;
    }
    const items = Array.isArray(short) ? short : (short && (short.items || short.shortages)) || [];
    if (items.length === 0) continue;
    shortages.push({
      wo_code: wo.wo_code,
      title: wo.title,
      instance: wo.instance_code || null,
      planned_start: wo.planned_start,
      shortage_items: items.slice(0, 10).map((item) => ({
        material_code: item.material_code || item.part_number,
        material_name: item.material_name || null,
        required: item.required_qty ?? item.required,
        available: item.available_qty ?? item.available,
        shortage: item.shortage_qty ?? item.shortage,
      })),
      link: webLink("/work-orders"),
    });
  }
  return {
    window_days: days,
    checked_work_orders: candidates.length,
    shortage_work_orders: shortages.length,
    shortages,
  };
}

async function toolOee(args) {
  const days = Number(args.days) || 30;
  const data = await getJson("/api/oee/overview", { days, instance_id: args.instance_id });
  return {
    period: data && data.period,
    oee: data && data.oee,
    basis: data && data.basis,
    losses_by_bucket: data && data.losses_by_bucket,
    top_losses: data && data.top_losses,
    data_quality: data && data.data_quality,
    sources: data && data.sources,
    link: webLink("/oee"),
  };
}

async function toolQcPassRate(args) {
  const days = Number(args.days) || 30;
  const stats = await getJson("/api/qc/stats");
  const recent = Array.isArray(stats && stats.recent_fail) ? stats.recent_fail : [];
  return {
    window_days: days,
    total: stats && stats.total,
    pass: stats && stats.pass,
    fail: stats && stats.fail,
    pass_rate_pct: stats && stats.pass_rate,
    by_type: stats && stats.by_type,
    recent_failures: recent.slice(0, Number(args.limit) || 10).map((row) => ({
      id: row.id,
      instance: row.instance_code || null,
      type: row.inspection_type,
      date: row.inspection_date,
      inspector: row.inspector_name,
    })),
    link: webLink("/quality"),
  };
}

async function toolAnomalies(args) {
  const days = Number(args.days) || 7;
  const limit = Math.min(Number(args.limit) || 20, 100);
  const rows = await getJson("/api/exceptions", { status: args.status, level: args.level });
  const items = (Array.isArray(rows) ? rows : (rows && rows.items) || [])
    .filter((item) => withinDays(item.created_at || item.raised_at, days))
    .slice(0, limit)
    .map((item) => ({
      id: item.id,
      title: item.title || item.description || item.exception_type,
      type: item.exception_type || item.type,
      level: item.level || item.severity,
      status: item.status,
      instance: item.instance_code || null,
      raised_at: item.created_at || item.raised_at,
      link: webLink("/exceptions"),
    }));
  return { window_days: days, count: items.length, anomalies: items, link: webLink("/exceptions") };
}

async function resolveInstanceId(args) {
  if (args.instance_id) return Number(args.instance_id);
  if (!args.instance_code) return null;
  const list = await getJson("/api/equipment_instances");
  const rows = Array.isArray(list) ? list : (list && (list.items || list.data)) || [];
  const found = rows.find((row) => String(row.instance_code) === String(args.instance_code));
  return found ? Number(found.id) : null;
}

async function toolCostVariance(args) {
  const instanceId = await resolveInstanceId(args || {});
  if (!instanceId) return { found: false, message: "需要 instance_id 或 instance_code（可用 mes_work_order_progress 里的 instance 字段）" };
  const data = await getJson(`/api/equipment_instances/${instanceId}/cost_variance`);
  if (!data || !data.totals) return { found: false, message: "该装备没有成本数据" };
  return {
    instance: data.equipment_instance,
    totals: data.totals,
    ledger: data.ledger,
    top_contributors: data.top_contributors,
    data_gaps: data.data_gaps,
    not_computed: data.not_computed,
    link: webLink("/cost-variance?instance_id=" + instanceId),
  };
}

async function toolTraceChain(args) {
  const keys = ["serial_no", "lot_no", "instance_code", "wo_code"];
  const query = {};
  for (const key of keys) if (args && args[key]) query[key] = args[key];
  if (!Object.keys(query).length) return { found: false, message: "需要 serial_no / lot_no / instance_code / wo_code 之一" };
  const data = await getJson("/api/trace/chain", query);
  if (!data || data.found === false) return { found: false, reason: data && data.reason, query };
  return {
    found: true,
    anchor: data.anchor,
    levels: data.levels,
    evidence_count: data.evidence_count,
    gaps: data.gaps,
    chain: {
      instance: data.chain.instance,
      work_orders: (data.chain.work_orders || []).slice(0, 10),
      operations: (data.chain.operations || []).slice(0, 10),
      serials: (data.chain.serials || []).slice(0, 10),
      lots: (data.chain.lots || []).slice(0, 10),
      inspections: (data.chain.inspections || []).slice(0, 10),
      documents: (data.chain.documents || []).slice(0, 10),
    },
    link: webLink("/trace"),
  };
}

async function toolWorkstationLoad(args) {
  const days = Math.min(Number(args && args.days) || 30, 90);
  const start = (args && args.start_date) || new Date().toISOString().slice(0, 10);
  const data = await getJson("/api/resources/gantt", { start_date: start, days });
  const grid = (data && data.heatmap && data.heatmap.grid) || [];
  const load = grid.map((row) => ({
    ws_id: row.ws_id,
    name: row.name,
    workshop: row.workshop,
    daily_capacity_hours: row.daily_capacity_hours,
    total_busy_hours: row.total_busy_hours,
    avg_utilization_pct: row.avg_utilization_pct,
    peak_utilization_pct: Math.max(0, ...(row.cells || []).map((cell) => Number(cell.utilization_pct) || 0)),
  })).sort((a, b) => b.peak_utilization_pct - a.peak_utilization_pct);
  return {
    period: { start, days, end: data && data.end_date },
    summary: data && data.summary,
    top_three: (data && data.bottlenecks && data.bottlenecks.top_overloaded) || [],
    idle_workstations: (data && data.bottlenecks && data.bottlenecks.top_idle) || [],
    workstations: load,
    link: webLink("/multi-schedule"),
  };
}

const TOOLS = [
  {
    name: "mes_work_order_progress",
    description: "查询工单进度：按状态/装备/时间窗返回工单列表、进度百分比与数量汇总（只读）。",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["pending", "in_progress", "blocked", "completed", "cancelled"], description: "工单状态" },
        instance_id: { type: "number", description: "装备实例 id" },
        days: { type: "number", description: "时间窗（天），默认 30" },
        limit: { type: "number", description: "返回条数上限，默认 20" },
      },
      additionalProperties: false,
    },
    handler: toolWorkOrderProgress,
  },
  {
    name: "mes_material_shortage",
    description: "查询缺料/齐套：对时间窗内的工单逐个做齐套检查，返回缺料明细（物料/需求/可用/缺口）与清单链接（只读）。",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "只看某状态工单，默认 pending" },
        instance_id: { type: "number", description: "装备实例 id" },
        days: { type: "number", description: "时间窗（天），默认 14" },
        max_work_orders: { type: "number", description: "最多检查多少张工单，默认 20" },
      },
      additionalProperties: false,
    },
    handler: toolMaterialShortage,
  },
  {
    name: "mes_oee",
    description: "查询 OEE（ISA-95 口径）：可用率/性能/质量/OEE、三层时间基线、损失分桶与数据质量（只读）。",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "统计天数，默认 30" },
        instance_id: { type: "number", description: "装备实例 id（不传=全厂）" },
      },
      additionalProperties: false,
    },
    handler: toolOee,
  },
  {
    name: "mes_qc_pass_rate",
    description: "查询质检合格率：总数/合格/不合格、按检验类型分组与最近不合格清单（只读）。",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "统计天数，默认 30" },
        limit: { type: "number", description: "最近不合格条数，默认 10" },
      },
      additionalProperties: false,
    },
    handler: toolQcPassRate,
  },
  {
    name: "mes_cost_variance",
    description: "查询项目成本三层差异：量差/价差/效率差、标准 vs 实际、成本台账（外协/折旧/返工）与账实核对（只读）。",
    inputSchema: {
      type: "object",
      properties: {
        instance_id: { type: "number", description: "装备实例 id（与 instance_code 二选一）" },
        instance_code: { type: "string", description: "装备编码，如 TBM-2026-001" },
      },
      additionalProperties: false,
    },
    handler: toolCostVariance,
  },
  {
    name: "mes_trace_chain",
    description: "查询追溯五级链路：装备 → 工单 → 工序 → 批次/序列号 → 检验与证据，返回每级状态与断点建议（只读）。",
    inputSchema: {
      type: "object",
      properties: {
        serial_no: { type: "string", description: "序列号" },
        lot_no: { type: "string", description: "批次号" },
        instance_code: { type: "string", description: "装备编码" },
        wo_code: { type: "string", description: "工单号" },
      },
      additionalProperties: false,
    },
    handler: toolTraceChain,
  },
  {
    name: "mes_workstation_load",
    description: "查询工位负荷：最紧三个工位、最空闲工位、各工位平均/峰值利用率（只读）。",
    inputSchema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "起始日期 YYYY-MM-DD，默认今天" },
        days: { type: "number", description: "统计天数，默认 30（上限 90）" },
      },
      additionalProperties: false,
    },
    handler: toolWorkstationLoad,
  },
  {
    name: "mes_anomalies",
    description: "查询异常中心：按时间窗/状态/级别返回异常清单与链接（只读）。",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "时间窗（天），默认 7" },
        status: { type: "string", description: "异常状态" },
        level: { type: "string", description: "异常级别" },
        limit: { type: "number", description: "返回条数上限，默认 20" },
      },
      additionalProperties: false,
    },
    handler: toolAnomalies,
  },
];

const TOOL_MAP = new Map(TOOLS.map((tool) => [tool.name, tool]));

async function callTool(name, args = {}) {
  const tool = TOOL_MAP.get(name);
  if (!tool) {
    const error = new Error(`未知工具: ${name}`);
    error.code = -32602;
    throw error;
  }
  const result = await tool.handler(args || {});
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: false };
}

// ---------------------------------------------------------------- JSON-RPC 分发
function jsonRpcError(id, code, message) {
  return { jsonrpc: "2.0", id: id === undefined ? null : id, error: { code, message } };
}

async function handleMessage(message) {
  const { id, method, params } = message || {};
  if (method === "initialize") {
    return { jsonrpc: "2.0", id, result: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
    } };
  }
  if (method === "notifications/initialized") return null;
  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } };
  }
  if (method === "tools/call") {
    try {
      const result = await callTool(params && params.name, (params && params.arguments) || {});
      return { jsonrpc: "2.0", id, result };
    } catch (error) {
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: String(error.message || error) }], isError: true } };
    }
  }
  return jsonRpcError(id, -32601, `Method not found: ${method}`);
}

function startServer() {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", async (line) => {
    const text = String(line || "").trim();
    if (!text) return;
    let message;
    try {
      message = JSON.parse(text);
    } catch (_error) {
      process.stdout.write(JSON.stringify(jsonRpcError(null, -32700, "Parse error")) + "\n");
      return;
    }
    const response = await handleMessage(message);
    if (response) process.stdout.write(JSON.stringify(response) + "\n");
  });
  process.stderr.write(`[tbm-mes-mcp] ready (api=${API_BASE}, user=${USER_ID}, tools=${TOOLS.length})\n`);
}

module.exports = { TOOLS, TOOL_MAP, callTool, handleMessage, httpGetJson, withinDays, webLink, __setHttpGet,
  resolveInstanceId, toolCostVariance, toolTraceChain, toolWorkstationLoad };

if (require.main === module) {
  startServer();
}
