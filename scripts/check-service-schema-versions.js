"use strict";

require("dotenv").config({ quiet: true });
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = "service-schema-static-scan-only-secret";
}

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { buildManifest } = require("../db/serviceSchemaManifest");
const { SERVICES } = require("../services/registry");

const projectRoot = path.resolve(__dirname, "..");
const servicesRoot = path.join(projectRoot, "services");
const manifestPath = path.join(projectRoot, "db", "service-schema-manifest.json");

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readManifestFromGit(ref) {
  try {
    const source = childProcess.execFileSync(
      "git",
      ["show", `${ref}:db/service-schema-manifest.json`],
      { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
    return JSON.parse(source);
  } catch (_error) {
    return null;
  }
}

function hasWorktreeChanges() {
  return childProcess.execFileSync("git", ["status", "--porcelain"], { cwd: projectRoot, encoding: "utf8" }).trim() !== "";
}

function parseOptions(argv) {
  const options = { write: false, base: process.env.SCHEMA_GUARD_BASE || "" };
  for (const argument of argv) {
    if (argument === "--write") options.write = true;
    if (argument.startsWith("--base=")) options.base = argument.slice("--base=".length);
  }
  if (!options.base && process.env.GITHUB_BASE_REF) options.base = `origin/${process.env.GITHUB_BASE_REF}`;
  if (!options.base && hasWorktreeChanges()) options.base = "HEAD";
  return options;
}

function validateVersionBumps(previous, current) {
  if (!previous?.services) return [];
  const errors = [];
  for (const [name, schema] of Object.entries(current.services)) {
    const before = previous.services[name];
    if (!before || before.ddlFingerprint === schema.ddlFingerprint) continue;
    if (schema.schemaVersion <= before.schemaVersion) {
      errors.push(
        `${name}: DDL fingerprint changed but schemaVersion stayed at ${schema.schemaVersion}; ` +
        `increment it above ${before.schemaVersion}`
      );
    }
  }
  return errors;
}

function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  const current = buildManifest(SERVICES, servicesRoot);
  const previous = options.base ? readManifestFromGit(options.base) : null;
  const errors = validateVersionBumps(previous, current);
  if (errors.length) {
    for (const error of errors) console.error(`[service-schema] ${error}`);
    process.exitCode = 1;
    return;
  }

  if (options.write) {
    fs.writeFileSync(manifestPath, stableJson(current));
    console.log(`[service-schema] wrote ${path.relative(projectRoot, manifestPath)}`);
    return;
  }

  if (!fs.existsSync(manifestPath)) {
    console.error("[service-schema] manifest missing; run npm run schema:write");
    process.exitCode = 1;
    return;
  }
  const recorded = readJson(manifestPath);
  if (stableJson(recorded) !== stableJson(current)) {
    console.error("[service-schema] manifest is stale; increment affected schemaVersion and run npm run schema:write");
    process.exitCode = 1;
    return;
  }

  const ddlServices = Object.values(current.services).filter((service) => service.ddlFingerprint).length;
  console.log(`[service-schema] OK: ${Object.keys(current.services).length} services, ${ddlServices} with DDL`);
}

if (require.main === module) main();

module.exports = { main, parseOptions, validateVersionBumps };
