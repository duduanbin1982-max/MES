"use strict";
// scripts/audit-modules-sweep.js
// 2026-11-05：剩余模块批量审计（广度优先）。
//
// 做什么：
//   1. 从 config/moduleManifest.json 找出「未审计」模块，映射到前端路由组件；
//   2. 从组件/其 composable 里抽取 GET 接口路径；
//   3. 用 admin 探活（状态码/耗时/条数），并抽 planner/foreman/worker/qc/sales 探权限；
//   4. 静态扫描乱码文案 / ApiError 参数错位 / 写入用 toISOString / TODO 数量；
//   5. 输出 Markdown + JSON 报告到 logs/audit/。
//
// 用法：
//   node scripts/audit-modules-sweep.js            # 全量（默认跳过已审计模块）
//   node scripts/audit-modules-sweep.js --all      # 连已审计模块也探
//   node scripts/audit-modules-sweep.js --json     # 只输出 JSON 摘要
require("dotenv").config({ quiet: true });
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const ROOT = path.resolve(__dirname, "..");
const BASE = process.env.AUDIT_BASE_URL || "http://127.0.0.1:3890";
const args = process.argv.slice(2);
const ALL = args.includes("--all");
const JSON_ONLY = args.includes("--json");

const AUDITED = new Set(["dashboard", "gantt", "multi-schedule", "schedule", "work-orders", "instances", "oee", "quality", "ncr", "incoming-qc", "process-qc", "final-qc"]);
const ROLES = ["admin", "planner", "foreman", "worker", "qc", "sales"];

const { signAccess } = require("../app/jwt");
const { DEFAULT_ROLE_PERMISSIONS } = require("../app/permissions");
const manifest = require("../config/moduleManifest.json");

function tokenFor(role) {
  const permissions = role === "admin" ? ["*"] : (DEFAULT_ROLE_PERMISSIONS[role] || []);
  return signAccess({ sub: 1, role, permissions }).token;
}

function get(urlPath, token) {
  return new Promise((resolve) => {
    const started = Date.now();
    const url = new URL(urlPath, BASE);
    const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: "GET", headers: { Authorization: "Bearer " + token } }, (res) => {
      let raw = "";
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: raw, ms: Date.now() - started }));
    });
    req.on("error", (error) => resolve({ status: 0, body: error.message, ms: Date.now() - started }));
    req.end();
  });
}

function readFile(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), "utf8"); } catch { return ""; }
}

function modulePermissionMap() {
  const source = readFile("frontend/src/config/menuCatalog.ts");
  const parseMap = (name) => {
    const match = source.match(new RegExp(name + "\\s*=\\s*\\{([\\s\\S]*?)\\n\\}", "m"));
    const map = {};
    if (!match) return map;
    for (const line of match[1].split("\n")) {
      const hit = line.match(/['"]?([a-zA-Z][\w-]*)['"]?\s*:\s*['"]([^'"]+)['"]/);
      if (hit) map[hit[1]] = hit[2];
    }
    return map;
  };
  const section = readFile("frontend/src/config/menuCatalog.ts");
  return {
    module: parseMap("MODULE_PERMISSION"),
    section: (() => {
      const match = section.match(/SECTION_PERMISSION\s*=\s*\{([\s\S]*?)\n\}/m);
      const map = {};
      if (!match) return map;
      for (const line of match[1].split("\n")) {
        const hit = line.match(/['"]?([a-zA-Z][\w-]*)['"]?\s*:\s*['"]([^'"]+)['"]/);
        if (hit) map[hit[1]] = hit[2];
      }
      return map;
    })(),
  };
}

function routerMap() {
  const source = readFile("frontend/src/router/index.ts");
  const map = {};
  const regex = /path:\s*'([^']+)'[^}]*?import\('\.\.\/views\/([\w/.-]+\.vue)'\)/g;
  let hit;
  while ((hit = regex.exec(source))) map[hit[1]] = hit[2];
  return map;
}

function extractApis(viewRelative) {
  const SRC = path.join(ROOT, "frontend", "src");
  const files = new Set();
  const visited = new Set();
  const resolveImport = (fromRel, spec) => {
    if (!spec.startsWith(".")) return null;
    const baseDir = path.posix.dirname(fromRel);
    const target = path.posix.normalize(path.posix.join(baseDir, spec));
    for (const ext of [".ts", ".vue", ".js"]) {
      const abs = path.join(SRC, target + ext);
      if (fs.existsSync(abs)) return path.posix.relative(SRC, abs);
    }
    for (const ext of [".ts", ".vue", ".js"]) {
      const abs = path.join(SRC, target, "index" + ext);
      if (fs.existsSync(abs)) return path.posix.relative(SRC, abs);
    }
    return null;
  };
  const isSharedBarrel = (rel) => {
    const normalized = rel.replaceAll("\\", "/");
    if (normalized.startsWith("api/") && /(^|\/)index\.(ts|js)$/.test(normalized)) return true;
    if (normalized.startsWith("api/client")) return true;
    if (normalized.startsWith("stores/")) return true;
    if (normalized.startsWith("router/")) return true;
    return false;
  };
  const walk = (rel, depth) => {
    if (visited.has(rel) || depth > 3) return;
    visited.add(rel);
    if (!isSharedBarrel(rel)) files.add(rel);
    const abs = path.join(SRC, rel);
    const source = fs.readFileSync(abs, "utf8");
    for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const resolved = resolveImport(rel, match[1]);
      if (resolved && !isSharedBarrel(resolved)) walk(resolved, depth + 1);
    }
  };
  walk(path.posix.join("views", viewRelative), 0);

  const NOISE = [/^\/(?:auth|health|permissions|catalog|dashboard|reports|delivery|shopfloor)\b/];
  const apis = new Set();
  for (const rel of files) {
    const source = fs.readFileSync(path.join(SRC, rel), "utf8");
    const regex = /(?:Api|api)\.(get|post|put|patch|delete|del)\(\s*[`'"]([^`'"]+)[`'"]/g;
    let hit;
    while ((hit = regex.exec(source))) {
      const value = hit[2];
      if (!value.startsWith("/")) continue;
      const api = value.replace(/\$\{[^}]+\}/g, "1").split("?")[0];
      if (NOISE.some((pattern) => pattern.test(api))) continue;
      apis.add(api);
    }
  }
  return [...apis].slice(0, 10);
}

function staticScan(viewRelative) {
  const source = readFile("frontend/src/views/" + viewRelative);
  const findings = [];
  if (/'[^']*\?\?\s*[^']*'/.test(source)) findings.push("存在 `??` 乱码文案");
  if (/error\?\.message\s*\|\|/.test(source) && /data\?\.message/.test(source) === false) findings.push("错误提示可能未取后端 message");
  if (/toISOString\(\)/.test(source)) findings.push("前端使用 toISOString（注意时区）");
  const todos = (source.match(/TODO|FIXME/g) || []).length;
  if (todos > 0) findings.push(`TODO/FIXME ${todos} 处`);
  return findings;
}

const backendScan = (() => {
  const findings = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (!["node_modules", ".git", "logs", "data", "frontend"].includes(entry.name)) walk(full); continue; }
      if (!entry.name.endsWith(".js")) continue;
      const source = fs.readFileSync(full, "utf8");
      const relative = path.relative(ROOT, full).replaceAll(path.sep, "/");
      const issues = [];
      const mojibake = source.match(/['"][^'"]*\?\?[^'"]*['"]/g);
      if (mojibake) issues.push(`疑似乱码文案 ${mojibake.length} 处（如 ${mojibake[0].slice(0, 40)}）`);
      const wronglyConstructed = source.match(/new ApiError\(\s*4\d\d\s*,/g);
      if (wronglyConstructed) issues.push(`ApiError 参数错位 ${wronglyConstructed.length} 处`);
      if (issues.length) findings[relative] = issues;
    }
  };
  walk(path.join(ROOT, "services"));
  walk(path.join(ROOT, "middleware"));
  walk(path.join(ROOT, "routes"));
  return findings;
})();

async function main() {
  const tokens = Object.fromEntries(ROLES.map((role) => [role, tokenFor(role)]));
  const permissions = modulePermissionMap();
  const routers = routerMap();
  const flat = [];
  for (const section of manifest.sections || manifest) {
    if (!section.modules) continue;
    for (const module of section.modules) flat.push({ section: section.key, ...module });
  }

  const uniquePaths = [...new Map(flat.map((row) => [row.path, row])).values()];
  const rows = [];
  for (const module of uniquePaths) {
    if (!ALL && flat.filter((row) => row.path === module.path).every((row) => AUDITED.has(row.key))) continue;
    const view = routers[module.path];
    if (!view) { rows.push({ path: module.path, view: null, apis: [], status: "no-view" }); continue; }
    const apis = extractApis(view);
    const probes = [];
    for (const api of apis) {
      const admin = await get(api, tokens.admin);
      const roleStatus = {};
      for (const role of ["planner", "foreman", "worker", "qc", "sales"]) {
        roleStatus[role] = (await get(api, tokens[role])).status;
      }
      let size = null;
      try { const parsed = JSON.parse(admin.body); size = Array.isArray(parsed) ? parsed.length : (parsed && (parsed.items || parsed.rows || parsed.total)); } catch { /* 非 JSON 响应忽略 */ }
      probes.push({ api, admin: admin.status, ms: admin.ms, size, roles: roleStatus });
    }
    rows.push({
      path: module.path,
      view,
      keys: flat.filter((row) => row.path === module.path).map((row) => row.key),
      permission: permissions.module[flat.find((row) => row.path === module.path)?.key] || module.permission || null,
      apis,
      probes,
      static: staticScan(view),
    });
  }

  const report = { generated_at: new Date().toISOString(), base: BASE, modules: rows.length, rows, backend_scan: backendScan };
  const dir = path.join(ROOT, "logs", "audit");
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  fs.writeFileSync(path.join(dir, `remaining-modules-${ts}.json`), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(dir, "remaining-modules-latest.json"), JSON.stringify(report, null, 2));

  if (JSON_ONLY) { console.log(JSON.stringify(report, null, 2)); return; }

  const failures = [];
  const lines = ["# 剩余模块批量审计（自动探活 + 静态扫描）", "", `- 生成时间：${report.generated_at}`, `- 服务：${BASE}`, `- 模块（去重路径）：${rows.length}`, ""];
  lines.push("| 模块路径 | 组件 | 权限 | 探活 | 说明 |", "|---|---|---|---|---|");
  for (const row of rows) {
    const bad = row.probes.filter((probe) => probe.admin >= 400);
    const empty = row.probes.filter((probe) => probe.admin === 200 && probe.size === 0);
    const notes = [];
    if (bad.length) notes.push(`接口 ${bad.length}/${row.probes.length} 失败（${bad.map((p) => `${p.api}=${p.admin}`).join(", ")}）`);
    if (empty.length) notes.push(`${empty.length} 个接口返回空`);
    if (row.static.length) notes.push(row.static.join("；"));
    lines.push(`| \`${row.path}\` | ${row.view || "—"} | ${row.permission || "—"} | ${bad.length ? "❌" : "✅"} | ${notes.join("；") || ""} |`);
    for (const probe of row.probes) {
      if (probe.admin >= 400) failures.push({ path: row.path, api: probe.api, status: probe.admin, body: String(probe.body || "").slice(0, 160) });
    }
    // 权限错配：菜单可见（用模块权限判断）但接口对相应角色 403
    if (row.permission) {
      for (const probe of row.probes) {
        for (const role of ["planner", "foreman", "worker", "qc", "sales"]) {
          const permissionsOfRole = DEFAULT_ROLE_PERMISSIONS[role] || [];
          const hasMenu = permissionsOfRole.includes("*") || permissionsOfRole.includes(row.permission);
          if (hasMenu && probe.roles[role] === 403) {
            failures.push({ path: row.path, api: probe.api, role, status: 403, type: "menu-visible-but-api-403" });
          }
        }
      }
    }
  }
  lines.push("", "## 接口失败 / 权限错配明细", "");
  if (failures.length === 0) lines.push("无");
  else for (const failure of failures) lines.push(`- ${failure.type ? `[权限错配] ` : ""}\`${failure.path}\` \`${failure.api}\` ${failure.role ? `role=${failure.role} ` : ""}status=${failure.status} ${failure.body || ""}`);
  lines.push("", "## 后端静态扫描（乱码文案 / ApiError 参数错位）", "");
  const backendEntries = Object.entries(backendScan).sort((a, b) => b[1].length - a[1].length);
  if (backendEntries.length === 0) lines.push("无");
  else for (const [file, issues] of backendEntries.slice(0, 40)) lines.push(`- \`${file}\`：${issues.join("；")}`);
  const mdPath = path.join(dir, `remaining-modules-${ts}.md`);
  fs.writeFileSync(mdPath, lines.join("\n"));

  console.log(`模块（去重路径）：${rows.length}`);
  console.log(`探活失败：${rows.filter((row) => row.probes.some((probe) => probe.admin >= 400)).length} 个路径`);
  console.log(`权限错配：${failures.filter((item) => item.type === "menu-visible-but-api-403").length} 处`);
  console.log(`后端疑似乱码文件：${backendEntries.length} 个`);
  console.log(`报告：${mdPath}`);
  console.log(`JSON：${path.join(dir, "remaining-modules-latest.json")}`);
  for (const row of rows.slice(0, 20)) {
    const bad = row.probes.filter((probe) => probe.admin >= 400);
    console.log(`  ${bad.length ? "❌" : "✅"} ${row.path.padEnd(20)} ${row.view || ""} ${bad.map((p) => `${p.api}=${p.admin}`).join(", ")}`);
  }
  process.exitCode = 0;
}

main().catch((error) => { console.error("审计脚本失败：", error); process.exitCode = 1; });
