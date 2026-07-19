"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { isDdl } = require("./serviceMigrations");

function resolveLocalModule(request, fromFile, servicesRoot) {
  if (!request.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), request);
  const candidates = [base, `${base}.js`, path.join(base, "index.js")];
  const resolved = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (!resolved) return null;
  const relative = path.relative(servicesRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return resolved;
}

function collectServiceFiles(entry, servicesRoot) {
  const entryFile = resolveLocalModule(entry.module, path.join(servicesRoot, "register-all.js"), servicesRoot);
  if (!entryFile) throw new Error(`[service-schema] cannot resolve ${entry.name}: ${entry.module}`);

  const pending = [entryFile];
  const visited = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    const source = fs.readFileSync(file, "utf8");
    const requirePattern = /require\(\s*["']([^"']+)["']\s*\)/g;
    for (const match of source.matchAll(requirePattern)) {
      const dependency = resolveLocalModule(match[1], file, servicesRoot);
      if (dependency && !visited.has(dependency)) pending.push(dependency);
    }
  }
  return [...visited].sort();
}

function extractDdlLiterals(source) {
  const literals = [];
  const literalPattern = /`((?:\\[\s\S]|[^`])*)`|"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'/g;
  for (const match of source.matchAll(literalPattern)) {
    const value = match[1] ?? match[2] ?? match[3] ?? "";
    if (isDdl(value)) literals.push(value.replace(/\s+/g, " ").trim());
  }
  return literals;
}

function fingerprintService(entry, servicesRoot) {
  const statements = [];
  for (const file of collectServiceFiles(entry, servicesRoot)) {
    const relative = path.relative(servicesRoot, file).replaceAll(path.sep, "/");
    const source = fs.readFileSync(file, "utf8");
    for (const sql of extractDdlLiterals(source)) statements.push(`${relative}\0${sql}`);
  }
  statements.sort();
  const ddlFingerprint = statements.length
    ? crypto.createHash("sha256").update(statements.join("\n")).digest("hex")
    : null;
  return { schemaVersion: entry.schemaVersion, ddlFingerprint, ddlStatements: statements.length };
}

function buildManifest(entries, servicesRoot) {
  const services = {};
  for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
    services[entry.name] = fingerprintService(entry, servicesRoot);
  }
  return { version: 1, services };
}

module.exports = { buildManifest, collectServiceFiles, extractDdlLiterals, fingerprintService };
