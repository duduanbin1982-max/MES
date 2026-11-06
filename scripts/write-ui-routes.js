"use strict";
// scripts/write-ui-routes.js
// 2026-11-07（角色组审计 RG-7）：从前端路由生成 config/uiRoutes.json，
// 用于后端校验角色组 default_home 是否是真实页面路由。
// 用法：node scripts/write-ui-routes.js
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const ROUTER = path.join(ROOT, "frontend", "src", "router", "index.ts");
const OUT = path.join(ROOT, "config", "uiRoutes.json");

function main() {
  const source = fs.readFileSync(ROUTER, "utf8");
  const routes = [];
  for (const match of source.matchAll(/path:\s*['"]([^'"]+)['"]/g)) {
    const route = match[1];
    if (!route || route.includes("*")) continue;
    if (route === "") continue; // 子路由空路径 = 父布局首页
    routes.push(route);
  }
  const unique = [...new Set(routes)].sort();
  fs.writeFileSync(OUT, JSON.stringify({ generated_at: new Date().toISOString(), source: "frontend/src/router/index.ts", routes: unique }, null, 2) + "\n");
  console.log(`[ui-routes] 写入 ${unique.length} 条路由到 ${path.relative(ROOT, OUT)}`);
}

module.exports = { main };
if (require.main === module) main();
