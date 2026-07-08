"use strict";
// app/middleware/auditTrail.js
// Generic API write audit trail. Business-specific audit.wrap still records
// detailed diffs; this middleware guarantees every mutating API call has
// at least one trace row for compliance and incident review.

const audit = require("../audit");

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SKIP_PREFIXES = ["/auth/"];

function normalizedParts(path) {
  const parts = String(path || "").split("/").filter(Boolean);
  if (parts[0] === "api") parts.shift();
  return parts;
}

function resourceFromPath(path) {
  const parts = normalizedParts(path);
  return parts[0] || "api";
}

function resourceIdFromPath(path) {
  const parts = normalizedParts(path);
  const numeric = parts.find((part) => /^\d+$/.test(part));
  return numeric || null;
}

function auditTrail(db) {
  return (req, res, next) => {
    if (!WRITE_METHODS.has(req.method) || SKIP_PREFIXES.some((prefix) => req.path.startsWith(prefix))) {
      return next();
    }

    const startedAt = Date.now();
    res.on("finish", () => {
      const status = res.statusCode >= 400 ? "failed" : "success";
      audit.record(db, req, {
        action: "api." + req.method.toLowerCase(),
        resource_type: resourceFromPath(req.path),
        resource_id: resourceIdFromPath(req.path),
        diff_summary: req.method + " " + req.originalUrl + " -> " + res.statusCode + " (" + (Date.now() - startedAt) + "ms)",
        status,
        error: status === "failed" ? "HTTP " + res.statusCode : null,
      });
    });
    next();
  };
}

module.exports = auditTrail;
