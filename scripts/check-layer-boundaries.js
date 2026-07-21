"use strict";

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(target);
    return entry.isFile() && /\.(js|ts|vue)$/.test(entry.name) ? [target] : [];
  });
}

function resolveImport(request, sourceFile) {
  if (!request.startsWith(".")) return null;
  const base = path.resolve(path.dirname(sourceFile), request);
  return [base, `${base}.js`, `${base}.ts`, `${base}.vue`, path.join(base, "index.js"), path.join(base, "index.ts")]
    .find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || null;
}

function isInside(parent, target) {
  const relative = path.relative(parent, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function importRequests(source) {
  const requests = new Set();
  for (const pattern of [
    /require\(\s*["']([^"']+)["']\s*\)/g,
    /(?:from\s+|import\s*\()\s*["']([^"']+)["']/g,
  ]) {
    for (const match of source.matchAll(pattern)) requests.add(match[1]);
  }
  return requests;
}

function createRules(root = projectRoot) {
  const at = (...segments) => path.join(root, ...segments);
  return [
    {
      name: "services -> routes",
      source: at("services"),
      forbiddenPaths: [at("routes")],
      forbiddenPackages: [],
    },
    {
      name: "frontend composables -> views",
      source: at("frontend", "src", "composables"),
      forbiddenPaths: [at("frontend", "src", "views")],
      forbiddenPackages: [],
    },
    {
      name: "domain -> infrastructure",
      source: at("app", "domain"),
      forbiddenPaths: [at("services"), at("routes"), at("db"), at("middleware"), at("app", "middleware"), at("app", "ws")],
      forbiddenPackages: ["express", "better-sqlite3", "ws"],
    },
    {
      name: "frontend domain -> UI/API",
      source: at("frontend", "src", "domain"),
      forbiddenPaths: [
        at("frontend", "src", "api"),
        at("frontend", "src", "components"),
        at("frontend", "src", "router"),
        at("frontend", "src", "services"),
        at("frontend", "src", "stores"),
        at("frontend", "src", "views"),
      ],
      forbiddenPackages: ["vue", "vue-router", "element-plus"],
    },
  ];
}

function findViolations(root = projectRoot) {
  const violations = [];
  for (const rule of createRules(root)) {
    for (const file of walk(rule.source)) {
      const source = fs.readFileSync(file, "utf8");
      for (const request of importRequests(source)) {
        if (rule.forbiddenPackages.some((name) => request === name || request.startsWith(`${name}/`))) {
          violations.push(`${rule.name}: ${path.relative(root, file)} -> ${request}`);
          continue;
        }
        const resolved = resolveImport(request, file);
        if (resolved && rule.forbiddenPaths.some((directory) => isInside(directory, resolved))) {
          violations.push(`${rule.name}: ${path.relative(root, file)} -> ${path.relative(root, resolved)}`);
        }
      }
    }
  }
  return violations;
}

function main() {
  const violations = findViolations();
  if (violations.length) {
    for (const violation of violations) console.error(`[layer-boundary] ${violation}`);
    process.exitCode = 1;
    return;
  }
  console.log("[layer-boundary] OK: service, backend domain, and frontend domain boundaries are valid");
}

if (require.main === module) main();

module.exports = { createRules, findViolations, importRequests, isInside, resolveImport };
