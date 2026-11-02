"use strict";
// scripts/check-module-boundaries.js
// 2026-11-02：模块边界检查（跨域只读 / 跨服务 require 白名单 / 跨域触发器）
//
// 规则：
//   1. 服务只能写「自己拥有的表」；跨域写必须走对方服务或只读视图。
//   2. 服务之间只允许 require 白名单里的模块（默认禁止）。
//   3. 不允许在别人的表上建触发器（跨域副作用，需白名单）。
//   表归属 = 声明该表的文件所属服务（按文件路径判定，不按调用图）；
//   共享文件（services 根级、或一个目录被多个服务共用）里声明的表视为 shared。
//
// 用法：
//   node scripts/check-module-boundaries.js            # 检查（有违规退出码 1）
//   node scripts/check-module-boundaries.js --json     # 输出 JSON 报告
//   node scripts/check-module-boundaries.js --verbose  # 打印每条违规位置
//
// 白名单：config/moduleBoundaries.json

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SERVICES_ROOT = path.join(ROOT, "services");
const CONFIG_PATH = path.join(ROOT, "config", "moduleBoundaries.json");

const { SERVICES } = require(path.join(SERVICES_ROOT, "registry"));
const { collectServiceFiles, extractDdlLiterals } = require(path.join(ROOT, "db", "serviceSchemaManifest"));

const INFRA_PREFIXES = ["app/", "middleware/", "db/", "routes/", "shared/", "config/", "scripts/"];

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (_error) {
    return { allowedRequires: [], allowedWrites: [], allowedTriggers: [], sharedTables: [] };
  }
}

function buildServiceIndex() {
  const map = new Map();
  for (const entry of SERVICES) {
    const entryFile = require.resolve(path.join(SERVICES_ROOT, entry.module.replace(/^\.\//, "")));
    const relative = path.relative(SERVICES_ROOT, entryFile).replaceAll(path.sep, "/");
    map.set(entry.name, { entry, entryFile, relative, serviceDir: relative.split("/")[0] });
  }
  return map;
}

/**
 * 文件归属：按路径判定，避免"被哪个服务的调用图扫到就算谁的"导致的归属漂移。
 *   services/<dir>/...        -> 该 dir 只对应一个服务时归它；多个服务共用则视为共享
 *   services/<file>.js        -> 仅当它是某个服务的入口文件时归该服务
 *   其它（共享文件）           -> null（表视为 shared，不参与跨域检查）
 */
function buildFileOwnership(serviceIndex) {
  const dirServices = new Map();
  const rootFileEntries = new Map();
  for (const [name, info] of serviceIndex) {
    if (info.relative.split("/").length === 1) {
      rootFileEntries.set(info.relative, name);
      continue;
    }
    if (!dirServices.has(info.serviceDir)) dirServices.set(info.serviceDir, []);
    dirServices.get(info.serviceDir).push(name);
  }
  return { dirServices, rootFileEntries };
}

function ownerOfFile(absFile, ownership) {
  const rel = path.relative(SERVICES_ROOT, absFile).replaceAll(path.sep, "/");
  if (rel.startsWith("..")) return null;
  const parts = rel.split("/");
  if (parts.length === 1) return ownership.rootFileEntries.get(rel) || null;
  const list = ownership.dirServices.get(parts[0]);
  return list && list.length === 1 ? list[0] : null;
}

function extractRequires(source) {
  const out = [];
  for (const match of source.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) out.push(match[1]);
  return out;
}

function resolveRequire(specifier, fromFile) {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [base, `${base}.js`, path.join(base, "index.js")];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || null;
}

/** 表 -> 拥有它的服务（只看"归属于某服务"的文件里的 CREATE TABLE） */
function buildTableOwners(serviceFiles, ownership) {
  const owners = new Map();
  const conflicts = [];
  for (const [name, files] of serviceFiles) {
    for (const file of files) {
      if (ownerOfFile(file, ownership) !== name) continue;
      const source = fs.readFileSync(file, "utf8");
      for (const sql of extractDdlLiterals(source)) {
        for (const match of sql.matchAll(/CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?([A-Za-z_][A-Za-z0-9_]*)["'`]?/gi)) {
          const table = match[1];
          if (!owners.has(table)) owners.set(table, name);
          else if (owners.get(table) !== name) {
            conflicts.push({ table, first: owners.get(table), second: name, file: path.relative(ROOT, file).replaceAll(path.sep, "/") });
          }
        }
      }
    }
  }
  return { owners, conflicts };
}

function extractWrites(sql) {
  const out = [];
  const patterns = [
    /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+["'`]?([A-Za-z_][A-Za-z0-9_]*)/gi,
    /REPLACE\s+INTO\s+["'`]?([A-Za-z_][A-Za-z0-9_]*)/gi,
    /UPDATE\s+(?:OR\s+\w+\s+)?["'`]?([A-Za-z_][A-Za-z0-9_]*)/gi,
    /DELETE\s+FROM\s+["'`]?([A-Za-z_][A-Za-z0-9_]*)/gi,
    /CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?([A-Za-z_][A-Za-z0-9_]*)/gi,
    /ALTER\s+TABLE\s+["'`]?([A-Za-z_][A-Za-z0-9_]*)/gi,
    /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?["'`]?([A-Za-z_][A-Za-z0-9_]*)/gi,
  ];
  for (const pattern of patterns) for (const match of sql.matchAll(pattern)) out.push(match[1]);
  return out;
}

/** CREATE TRIGGER <name> AFTER|BEFORE|INSTEAD OF <event> ON <table> → 被挂触发器的表 */
function extractTriggerTargets(sql) {
  const out = [];
  const pattern = /CREATE\s+TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?([A-Za-z_][A-Za-z0-9_]*)["'`]?\s+(?:BEFORE|AFTER|INSTEAD\s+OF)\s+(?:INSERT|UPDATE|DELETE)\s+ON\s+["'`]?([A-Za-z_][A-Za-z0-9_]*)["'`]?/gi;
  for (const match of sql.matchAll(pattern)) out.push({ name: match[1], table: match[2] });
  return out;
}

function analyze() {
  const config = loadConfig();
  const serviceIndex = buildServiceIndex();
  const ownership = buildFileOwnership(serviceIndex);

  const serviceFiles = new Map();
  for (const [name, info] of serviceIndex) {
    try {
      serviceFiles.set(name, collectServiceFiles(info.entry, SERVICES_ROOT));
    } catch (_error) {
      serviceFiles.set(name, []);
    }
  }

  const { owners, conflicts } = buildTableOwners(serviceFiles, ownership);
  const allowedRequires = new Set((config.allowedRequires || []).map((row) => `${row.from}->${row.to}`));
  const allowedWrites = new Set((config.allowedWrites || []).map((row) => `${row.from}->${row.table}`));
  const allowedTriggers = new Set((config.allowedTriggers || []).map((row) => `${row.from}->${row.table}`));
  const sharedTables = new Set((config.sharedTables || []).map((row) => (typeof row === "string" ? row : row.table)));

  const requireViolations = [];
  const writeViolations = [];
  const triggerViolations = [];
  const dynamicWriteSites = [];
  const seen = new Set();

  for (const [name, files] of serviceFiles) {
    for (const file of files) {
      const owner = ownerOfFile(file, ownership);
      if (owner !== name) continue;
      const source = fs.readFileSync(file, "utf8");
      const relative = path.relative(ROOT, file).replaceAll(path.sep, "/");

      for (const specifier of extractRequires(source)) {
        const resolved = resolveRequire(specifier, file);
        if (!resolved) continue;
        const targetRelative = path.relative(ROOT, resolved).replaceAll(path.sep, "/");
        if (INFRA_PREFIXES.some((prefix) => targetRelative.startsWith(prefix))) continue;
        if (!targetRelative.startsWith("services/")) continue;
        const targetService = ownerOfFile(resolved, ownership);
        if (!targetService || targetService === owner) continue;
        const key = `${owner}->${targetService}`;
        const dedupe = `R:${key}@${relative}`;
        if (allowedRequires.has(key) || seen.has(dedupe)) continue;
        seen.add(dedupe);
        requireViolations.push({ owner, target: targetService, key, file: relative, specifier });
      }

      for (const sql of extractDdlLiterals(source)) {
        for (const table of extractWrites(sql)) {
          if (!owners.has(table)) continue;
          const tableOwner = owners.get(table);
          if (tableOwner === owner || sharedTables.has(table)) continue;
          const key = `${owner}->${table}`;
          const dedupe = `W:${key}@${relative}`;
          if (allowedWrites.has(key) || seen.has(dedupe)) continue;
          seen.add(dedupe);
          writeViolations.push({ owner, table, tableOwner, key, file: relative });
        }
        for (const trigger of extractTriggerTargets(sql)) {
          if (!owners.has(trigger.table)) continue;
          const tableOwner = owners.get(trigger.table);
          if (tableOwner === owner) continue;
          const key = `${owner}->${trigger.table}`;
          const dedupe = `T:${key}@${relative}`;
          if (allowedTriggers.has(key) || seen.has(dedupe)) continue;
          seen.add(dedupe);
          triggerViolations.push({ owner, table: trigger.table, tableOwner, trigger: trigger.name, key, file: relative });
        }
      }

      if (/`\s*(?:INSERT|UPDATE|DELETE|ALTER|DROP)[^`]*\$\{/i.test(source)) dynamicWriteSites.push(relative);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    services: serviceIndex.size,
    tablesOwned: owners.size,
    tableConflicts: conflicts,
    requireViolations,
    writeViolations,
    triggerViolations,
    dynamicWriteSites,
    ok: requireViolations.length === 0 && writeViolations.length === 0 && triggerViolations.length === 0,
  };
}

function run() {
  const args = process.argv.slice(2);
  const result = analyze();
  if (args.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
    return;
  }
  const verbose = args.includes("--verbose");
  console.log(`模块边界检查：${result.services} 个服务，${result.tablesOwned} 张表有明确归属`);
  if (result.tableConflicts.length) {
    console.log(`\n⚠️ 同一张表被多个服务声明（${result.tableConflicts.length}）：`);
    for (const row of result.tableConflicts) console.log(`  - ${row.table}: ${row.first} / ${row.second} (${row.file})`);
  }
  if (result.requireViolations.length) {
    console.log(`\n❌ 跨服务 require 未白名单（${result.requireViolations.length}）：`);
    for (const row of result.requireViolations) console.log(`  - ${row.owner} -> ${row.target}${verbose ? `  ${row.file}` : ""}`);
  }
  if (result.writeViolations.length) {
    console.log(`\n❌ 跨域写（${result.writeViolations.length}）：`);
    for (const row of result.writeViolations) console.log(`  - ${row.owner} 写 ${row.table}（属于 ${row.tableOwner}）${verbose ? `  ${row.file}` : ""}`);
  }
  if (result.triggerViolations.length) {
    console.log(`\n❌ 跨域触发器（${result.triggerViolations.length}）：`);
    for (const row of result.triggerViolations) console.log(`  - ${row.owner} 在 ${row.table}（属于 ${row.tableOwner}）上建触发器 ${row.trigger}${verbose ? `  ${row.file}` : ""}`);
  }
  if (result.dynamicWriteSites.length) {
    console.log(`\nℹ️ 动态 SQL（表名来自变量，无法静态判定）：${result.dynamicWriteSites.length} 个文件`);
    if (verbose) for (const file of result.dynamicWriteSites) console.log(`  - ${file}`);
  }
  console.log(result.ok ? "\n✅ 模块边界检查通过" : "\n❌ 模块边界检查失败：跨域写/跨服务 require/跨域触发器 未在白名单");
  process.exit(result.ok ? 0 : 1);
}

if (require.main === module) run();

module.exports = {
  analyze,
  buildServiceIndex,
  buildFileOwnership,
  ownerOfFile,
  buildTableOwners,
  extractWrites,
  extractRequires,
  extractTriggerTargets,
};
