"use strict";

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const servicesRoot = path.join(projectRoot, "services");
const routesRoot = path.join(projectRoot, "routes");

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : entry.isFile() && entry.name.endsWith(".js") ? [target] : [];
  });
}

function resolveRequire(request, sourceFile) {
  if (!request.startsWith(".")) return null;
  const base = path.resolve(path.dirname(sourceFile), request);
  return [base, `${base}.js`, path.join(base, "index.js")]
    .find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || null;
}

function findViolations() {
  const violations = [];
  const requirePattern = /require\(\s*["']([^"']+)["']\s*\)/g;
  for (const file of walk(servicesRoot)) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(requirePattern)) {
      const resolved = resolveRequire(match[1], file);
      if (!resolved) continue;
      const relativeToRoutes = path.relative(routesRoot, resolved);
      if (!relativeToRoutes.startsWith("..") && !path.isAbsolute(relativeToRoutes)) {
        violations.push(`${path.relative(projectRoot, file)} -> ${path.relative(projectRoot, resolved)}`);
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
  console.log("[layer-boundary] OK: services do not depend on routes");
}

if (require.main === module) main();

module.exports = { findViolations, resolveRequire };
