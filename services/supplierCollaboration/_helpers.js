"use strict";
// services/supplierCollaboration/_helpers.js
// 小工具: prepared statement 包装 + 单号生成 + JSON 解析。
// (原 services/supplierCollaborationService.js 第 84-102 行)

function all(db, sql, params = []) { return db.prepare(sql).all(params); }
function get(db, sql, params = []) { return db.prepare(sql).get(params); }
function run(db, sql, params = []) { return db.prepare(sql).run(params); }

function nextNo(db, table, column, prefix) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const head = `${prefix}-${today}-`;
  const row = get(db, `SELECT ${column} AS no FROM ${table} WHERE ${column} LIKE ? ORDER BY id DESC LIMIT 1`, [head + "%"]);
  let seq = 1;
  if (row?.no) {
    const n = parseInt(String(row.no).split("-").pop(), 10);
    if (!Number.isNaN(n)) seq = n + 1;
  }
  return head + String(seq).padStart(3, "0");
}

function parseJson(text, fallback) {
  try { return JSON.parse(text || ""); } catch (_e) { return fallback; }
}

module.exports = { all, get, run, nextNo, parseJson };
