"use strict";
// Shared utilities for modelTraining split.

function safeCode(value) {
  return String(value || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function parseJson(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function modelRow(row) {
  return {
    ...row,
    feature_schema: parseJson(row.feature_schema, []),
    parameters: parseJson(row.parameters, {}),
    metrics: parseJson(row.metrics, {}),
    data_quality: parseJson(row.data_quality, {}),
  };
}

module.exports = { safeCode, parseJson, modelRow };
