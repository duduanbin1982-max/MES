"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const manifestPath = path.join(root, "config", "moduleManifest.json");
const menuPath = path.join(root, "frontend", "src", "config", "menuCatalog.ts");
const routerPath = path.join(root, "frontend", "src", "router", "index.ts");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function basePath(entry) {
  return String(entry || "").split("?")[0].replace(/\/$/, "") || "/";
}

function duplicates(values) {
  const seen = new Set();
  const duplicate = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicate.add(value);
    seen.add(value);
  }
  return Array.from(duplicate);
}

function fail(messages) {
  console.error("Module manifest check failed:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}

const manifest = JSON.parse(read(manifestPath));
const routerSource = read(routerPath);
const menuSource = read(menuPath);
const routePattern = /(?:path|redirect):\s*'([^']+)'/g;
const routerPaths = new Set();
let routeMatch;
while ((routeMatch = routePattern.exec(routerSource)) !== null) routerPaths.add(basePath(routeMatch[1]));

const errors = [];
const sections = manifest.sections || [];
const modules = sections.flatMap((section) => (section.modules || []).map((module) => ({ ...module, section: section.key })));
for (const section of sections) {
  if (!section.key || !section.title || !section.icon) errors.push(`section missing key/title/icon: ${JSON.stringify(section)}`);
}
for (const module of modules) {
  if (!module.key || !module.title || !module.path || !module.entry || !module.icon) errors.push(`module missing key/title/path/entry/icon: ${JSON.stringify(module)}`);
  if (basePath(module.path) !== basePath(module.entry)) errors.push(`path/entry mismatch for ${module.key}: ${module.path} vs ${module.entry}`);
  if (!routerPaths.has(basePath(module.path))) errors.push(`module path has no router path/redirect: ${module.key} -> ${module.path}`);
}
for (const key of duplicates(sections.map((section) => section.key))) errors.push(`duplicate section key: ${key}`);
for (const key of duplicates(modules.map((module) => module.key))) errors.push(`duplicate module key: ${key}`);
if (!menuSource.includes("config/moduleManifest.json")) errors.push("menuCatalog.ts must derive menu structure from config/moduleManifest.json");
if (errors.length) fail(errors);

console.log(`Module manifest OK (${modules.length} modules, ${routerPaths.size} router paths, generated menu)`);
