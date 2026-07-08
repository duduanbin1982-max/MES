"use strict";
// scripts/check-duplicate-routes.js
// Fails CI when the same HTTP method + literal path is registered more than once.

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SCAN_DIRS = ["server.js", "routes", "services"];
const IGNORE_PARTS = new Set(["node_modules", "frontend", "archive", "backups", "logs"]);
const ROUTE_RE = /\bapp\.(get|post|put|patch|delete)\s*\(\s*(["'`])([^"'`]+)\2/g;

function walk(entry, files = []) {
  const full = path.join(ROOT, entry);
  if (!fs.existsSync(full)) return files;
  const stat = fs.statSync(full);
  if (stat.isFile()) {
    if (/\.(js|ts)$/.test(full) && !/\.bak(?:\.|$|-)/.test(full)) files.push(full);
    return files;
  }
  for (const item of fs.readdirSync(full, { withFileTypes: true })) {
    if (IGNORE_PARTS.has(item.name) || item.name.startsWith(".")) continue;
    walk(path.relative(ROOT, path.join(full, item.name)), files);
  }
  return files;
}

const seen = new Map();
const duplicates = [];

for (const rootEntry of SCAN_DIRS) {
  for (const file of walk(rootEntry)) {
    const rel = path.relative(ROOT, file).replace(/\\/g, "/");
    const source = fs.readFileSync(file, "utf8");
    let match;
    while ((match = ROUTE_RE.exec(source))) {
      const method = match[1].toUpperCase();
      const routePath = match[3];
      const key = `${method} ${routePath}`;
      const line = source.slice(0, match.index).split(/\r?\n/).length;
      const hit = `${rel}:${line}`;
      if (seen.has(key)) {
        duplicates.push({ key, first: seen.get(key), duplicate: hit });
      } else {
        seen.set(key, hit);
      }
    }
  }
}

if (duplicates.length) {
  console.error("Duplicate Express routes detected:");
  for (const item of duplicates) {
    console.error(`- ${item.key}`);
    console.error(`  first:     ${item.first}`);
    console.error(`  duplicate: ${item.duplicate}`);
  }
  process.exit(1);
}

console.log(`Route uniqueness OK (${seen.size} literal routes scanned)`);
