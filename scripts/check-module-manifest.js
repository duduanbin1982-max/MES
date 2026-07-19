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

function fail(messages) {
  console.error("Module manifest check failed:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}

function basePath(entry) {
  return String(entry || "").split("?")[0].replace(/\/$/, "") || "/";
}

function collectManifestModules(manifest) {
  const modules = [];
  for (const section of manifest.sections || []) {
    if (!section.key || !section.title) {
      modules.push({ error: `section missing key/title: ${JSON.stringify(section)}` });
      continue;
    }
    for (const module of section.modules || []) {
      modules.push({ ...module, section: section.key, path: basePath(module.path || module.entry) });
    }
  }
  return modules;
}

function collectMenuItems(source) {
  const itemPattern = /\{\s*key:\s*'([^']+)'\s*,\s*title:\s*'([^']*)'\s*,\s*to:\s*'([^']+)'\s*,\s*icon:\s*'([^']+)'/g;
  const items = [];
  let match;
  while ((match = itemPattern.exec(source)) !== null) {
    items.push({ key: match[1], title: match[2], entry: match[3], path: basePath(match[3]), icon: match[4] });
  }
  return items;
}

function collectRouterPaths(source) {
  const routePattern = /(?:path|redirect):\s*'([^']+)'/g;
  const paths = new Set();
  let match;
  while ((match = routePattern.exec(source)) !== null) paths.add(basePath(match[1]));
  return paths;
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

const manifest = JSON.parse(read(manifestPath));
const manifestModules = collectManifestModules(manifest);
const menuItems = collectMenuItems(read(menuPath));
const routerPaths = collectRouterPaths(read(routerPath));
const errors = [];

for (const module of manifestModules) {
  if (module.error) errors.push(module.error);
  if (!module.key || !module.title || !module.path) errors.push(`manifest module missing key/title/path: ${JSON.stringify(module)}`);
}

for (const key of duplicates(manifestModules.map((module) => module.key))) errors.push(`duplicate manifest module key: ${key}`);
for (const key of duplicates(menuItems.map((item) => item.key))) errors.push(`duplicate menu item key: ${key}`);

const manifestByKey = new Map(manifestModules.map((module) => [module.key, module]));
const menuByKey = new Map(menuItems.map((item) => [item.key, item]));

for (const item of menuItems) {
  const module = manifestByKey.get(item.key);
  if (!module) {
    errors.push(`menu item missing from manifest: ${item.key}`);
    continue;
  }
  if (module.title !== item.title) errors.push(`title mismatch for ${item.key}: manifest=${module.title}, menu=${item.title}`);
  if (module.path !== item.path) errors.push(`path mismatch for ${item.key}: manifest=${module.path}, menu=${item.path}`);
  if (!routerPaths.has(item.path)) errors.push(`menu path has no router path/redirect: ${item.key} -> ${item.path}`);
}

for (const module of manifestModules) {
  if (!menuByKey.has(module.key)) errors.push(`manifest module missing from menu: ${module.key}`);
  if (!routerPaths.has(module.path)) errors.push(`manifest path has no router path/redirect: ${module.key} -> ${module.path}`);
}

if (errors.length) fail(errors);

console.log(`Module manifest OK (${manifestModules.length} modules, ${routerPaths.size} router paths)`);
