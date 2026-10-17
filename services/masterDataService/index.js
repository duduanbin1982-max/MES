"use strict";

const createContext = require("./context");
const registerRoutes1 = require("./routes_1");
const registerRoutes2 = require("./routes_2");

function register(app, db) {
  const ctx = createContext(app, db);
  registerRoutes1(app, db, ctx);
  registerRoutes2(app, db, ctx);
}


function collectForException(db) {
    let collected = null;
  const originalJson = (payload) => { collected = payload; };
  register({
    get(path, handler) {
      if (path === "/api/mdm/overview") {
        handler({}, { json: originalJson });
      }
    },
    post() {},
  }, db);
  return collected || { summary: {}, domains: [], issues: [] };
}

function waiveIssue(db, issueId, reason) {
  db.exec(`CREATE TABLE IF NOT EXISTS mdm_issue_waivers (
    issue_id TEXT PRIMARY KEY,
    domain TEXT,
    rule TEXT,
    source TEXT,
    ref_id TEXT,
    reason TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    closed_at TEXT
  )`);
  db.prepare(`INSERT OR REPLACE INTO mdm_issue_waivers
    (issue_id, reason, active, closed_at)
    VALUES (?, ?, 1, datetime('now'))`).run(issueId, reason || "异常中心关闭");
}

function reopenIssue(db, issueId) {
  const waiverTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get("mdm_issue_waivers");
  if (!waiverTable) return;
  db.prepare("UPDATE mdm_issue_waivers SET active = 0 WHERE issue_id = ?").run(issueId);
}

module.exports = { register, collectForException, waiveIssue, reopenIssue };
