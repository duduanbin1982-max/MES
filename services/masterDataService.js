"use strict";
const { wrap } = require("../middleware/asyncHandler");

function register(app, db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mdm_issue_waivers (
      issue_id TEXT PRIMARY KEY,
      domain TEXT,
      rule TEXT,
      source TEXT,
      ref_id TEXT,
      reason TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      closed_at TEXT
    );
  `);
  const tableCache = new Map();
  const columnCache = new Map();

  function tableExists(name) {
    if (!tableCache.has(name)) {
      tableCache.set(name, !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
    }
    return tableCache.get(name);
  }

  function columns(table) {
    if (!columnCache.has(table)) {
      columnCache.set(table, tableExists(table) ? new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)) : new Set());
    }
    return columnCache.get(table);
  }

  function has(table, col) {
    return columns(table).has(col);
  }

  function all(sql, params = []) {
    try { return db.prepare(sql).all(params); } catch (_e) { return []; }
  }

  function get(sql, params = []) {
    try { return db.prepare(sql).get(params) || null; } catch (_e) { return null; }
  }

  function stableIssueId(domain, rule, source, refId, title) {
    const raw = [domain, rule, source || "-", refId == null ? "-" : String(refId), title || ""].join("|");
    let hash = 0;
    for (let i = 0; i < raw.length; i += 1) hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
    return `${domain}_${rule}_${Math.abs(hash)}`;
  }

  function ignoredIssueIds() {
    if (!tableExists("mdm_issue_waivers")) return new Set();
    return new Set(all("SELECT issue_id FROM mdm_issue_waivers WHERE active = 1").map((r) => r.issue_id));
  }

  function issue(list, domain, rule, severity, title, detail, source, refId, path) {
    list.push({
      id: stableIssueId(domain, rule, source, refId, title),
      domain,
      rule,
      severity,
      title,
      detail,
      source,
      ref_id: refId == null ? null : String(refId),
      source_path: path,
    });
  }

  function severityRank(sev) {
    return { critical: 4, high: 3, warning: 2, info: 1 }[sev] || 0;
  }

  function firstTable(names) {
    return names.find(tableExists);
  }

  function countRows(table) {
    const row = tableExists(table) ? get(`SELECT COUNT(*) AS c FROM ${table}`) : null;
    return row ? Number(row.c || 0) : 0;
  }

  function checkMaterials(issues) {
    if (!tableExists("materials")) return { domain: "materials", label: "物料编码", total: 0, issues: 0, score: 100 };
    const codeCol = has("materials", "material_code") ? "material_code" : has("materials", "code") ? "code" : null;
    const nameCol = has("materials", "material_name") ? "material_name" : has("materials", "name") ? "name" : null;
    const total = countRows("materials");
    if (!codeCol) {
      issue(issues, "materials", "missing_code_column", "critical", "物料表缺少编码字段", "materials 表没有 material_code/code 字段", "materials", null, "/materials");
      return { domain: "materials", label: "物料编码", total, issues: 1, score: 40 };
    }

    for (const r of all(`SELECT id, ${codeCol} AS code, ${nameCol || "''"} AS name FROM materials WHERE ${codeCol} IS NULL OR trim(${codeCol}) = '' LIMIT 100`)) {
      issue(issues, "materials", "missing_code", "critical", "物料缺少编码", `${r.name || "未命名物料"} 没有物料编码`, "materials", r.id, "/materials");
    }
    for (const r of all(`SELECT ${codeCol} AS code, COUNT(*) AS c FROM materials WHERE ${codeCol} IS NOT NULL AND trim(${codeCol}) <> '' GROUP BY ${codeCol} HAVING COUNT(*) > 1 LIMIT 100`)) {
      issue(issues, "materials", "duplicate_code", "critical", "物料编码重复", `${r.code} 出现 ${r.c} 次`, "materials", r.code, "/materials");
    }
    for (const r of all(`SELECT id, ${codeCol} AS code, ${nameCol || "''"} AS name FROM materials WHERE ${codeCol} IS NOT NULL AND (length(trim(${codeCol})) < 4 OR instr(${codeCol}, '-') = 0 OR ${codeCol} GLOB '*[^A-Z0-9._-]*') LIMIT 100`)) {
      issue(issues, "materials", "code_pattern", "warning", "物料编码格式异常", `${r.code} 建议使用大写分类前缀 + 分隔符`, "materials", r.id, "/materials");
    }
    if (nameCol) {
      for (const r of all(`SELECT ${nameCol} AS name, COUNT(*) AS c FROM materials WHERE ${nameCol} IS NOT NULL AND trim(${nameCol}) <> '' GROUP BY ${nameCol} HAVING COUNT(*) > 1 LIMIT 50`)) {
        issue(issues, "materials", "duplicate_name", "warning", "物料名称重复", `${r.name} 出现 ${r.c} 次，需确认是否一物多码`, "materials", r.name, "/materials");
      }
    }
    return domainSummary("materials", "物料编码", total, issues);
  }

  function checkBom(issues) {
    const table = firstTable(["bom_nodes", "equipment_bom", "bom_items", "bom_components"]);
    if (!table) return { domain: "bom", label: "BOM 层级", total: 0, issues: 0, score: 100 };
    const total = countRows(table);
    const idCol = has(table, "id") ? "id" : "rowid";
    const levelCol = ["level_code", "level_no", "level", "hierarchy"].find((c) => has(table, c));
    const parentCol = ["parent_id", "parent_node_id"].find((c) => has(table, c));
    const qtyCol = ["quantity", "qty", "net_qty"].find((c) => has(table, c));
    const partCol = ["part_number", "material_code", "item_code", "code"].find((c) => has(table, c));
    const versionCol = ["version", "revision", "rev"].find((c) => has(table, c));

    if (!levelCol) issue(issues, "bom", "missing_level", "critical", "BOM 缺少层级号", `${table} 未发现 level_code/level_no/level 字段`, table, null, "/bom");
    if (!parentCol) issue(issues, "bom", "missing_parent", "high", "BOM 缺少父子关系字段", `${table} 未发现 parent_id 字段`, table, null, "/bom");
    if (!versionCol) issue(issues, "bom", "missing_version", "warning", "BOM 缺少版本字段", `${table} 未发现 version/revision 字段`, table, null, "/bom");
    if (qtyCol) {
      for (const r of all(`SELECT ${idCol} AS id, ${qtyCol} AS qty FROM ${table} WHERE COALESCE(${qtyCol}, 0) <= 0 LIMIT 100`)) {
        issue(issues, "bom", "invalid_qty", "high", "BOM 用量异常", `节点 ${r.id} 的数量为 ${r.qty || 0}`, table, r.id, "/bom");
      }
    }
    if (partCol) {
      for (const r of all(`SELECT ${idCol} AS id FROM ${table} WHERE ${partCol} IS NULL OR trim(${partCol}) = '' LIMIT 100`)) {
        issue(issues, "bom", "missing_part", "high", "BOM 节点缺少物料/图号", `节点 ${r.id} 未填写物料编码或图号`, table, r.id, "/bom");
      }
    }
    return domainSummary("bom", "BOM 层级", total, issues);
  }

  function checkDocuments(issues) {
    if (!tableExists("documents")) return { domain: "documents", label: "图纸版本", total: 0, issues: 0, score: 100 };
    const total = countRows("documents");
    const codeCol = ["doc_code", "document_code", "drawing_no", "file_code"].find((c) => has("documents", c));
    const versionCol = ["version", "revision", "rev"].find((c) => has("documents", c));
    if (!versionCol) {
      issue(issues, "documents", "missing_version_column", "critical", "文档缺少版本字段", "documents 表未发现 version/revision 字段", "documents", null, "/documents");
    } else {
      for (const r of all(`SELECT id, title, ${versionCol} AS version FROM documents WHERE ${versionCol} IS NULL OR trim(${versionCol}) = '' LIMIT 100`)) {
        issue(issues, "documents", "missing_version", "high", "图纸/文档缺少版本", `${r.title || r.id} 未填写版本`, "documents", r.id, "/documents");
      }
    }
    if (codeCol && versionCol) {
      for (const r of all(`SELECT ${codeCol} AS code, ${versionCol} AS version, COUNT(*) AS c FROM documents WHERE ${codeCol} IS NOT NULL GROUP BY ${codeCol}, ${versionCol} HAVING COUNT(*) > 1 LIMIT 50`)) {
        issue(issues, "documents", "duplicate_code_version", "high", "图纸编码版本重复", `${r.code}/${r.version || "-"} 出现 ${r.c} 次`, "documents", r.code, "/documents");
      }
    }
    return domainSummary("documents", "图纸版本", total, issues);
  }

  function checkSuppliers(issues) {
    const table = firstTable(["suppliers", "purchase_suppliers"]);
    if (!table) return { domain: "suppliers", label: "供应商", total: 0, issues: 0, score: 100 };
    const total = countRows(table);
    const nameCol = ["supplier_name", "name", "vendor_name"].find((c) => has(table, c));
    const codeCol = ["supplier_code", "code", "vendor_code"].find((c) => has(table, c));
    if (nameCol) {
      for (const r of all(`SELECT rowid AS id FROM ${table} WHERE ${nameCol} IS NULL OR trim(${nameCol}) = '' LIMIT 100`)) {
        issue(issues, "suppliers", "missing_name", "high", "供应商缺少名称", `供应商记录 ${r.id} 未填写名称`, table, r.id, "/purchase");
      }
    }
    if (!codeCol) issue(issues, "suppliers", "missing_code_column", "warning", "供应商缺少编码字段", `${table} 未发现 supplier_code/code 字段`, table, null, "/purchase");
    return domainSummary("suppliers", "供应商", total, issues);
  }

  function checkProcessAndStations(issues) {
    let total = 0;
    if (tableExists("workstations")) {
      total += countRows("workstations");
      if (has("workstations", "code")) {
        for (const r of all("SELECT code, COUNT(*) AS c FROM workstations WHERE code IS NOT NULL GROUP BY code HAVING COUNT(*) > 1 LIMIT 50")) {
          issue(issues, "process", "duplicate_station_code", "high", "工位编码重复", `${r.code} 出现 ${r.c} 次`, "workstations", r.code, "/resources");
        }
      }
      if (has("workstations", "capacity_per_day")) {
        for (const r of all("SELECT id, code, name FROM workstations WHERE COALESCE(capacity_per_day, 0) <= 0 LIMIT 100")) {
          issue(issues, "process", "missing_capacity", "warning", "工位缺少产能", `${r.code || r.name || r.id} 未设置日产能`, "workstations", r.id, "/resources");
        }
      }
    }
    if (tableExists("process_nodes")) {
      total += countRows("process_nodes");
      const stdCol = ["standard_hours", "standard_minutes", "planned_hours", "estimated_hours"].find((c) => has("process_nodes", c));
      if (!stdCol) {
        issue(issues, "process", "missing_standard_time_column", "warning", "工序缺少标准工时字段", "process_nodes 未发现 standard_hours/standard_minutes 字段", "process_nodes", null, "/process-tree");
      } else {
        for (const r of all(`SELECT id, operation_name FROM process_nodes WHERE COALESCE(${stdCol}, 0) <= 0 LIMIT 100`)) {
          issue(issues, "process", "missing_standard_time", "warning", "工序缺少标准工时", `${r.operation_name || r.id} 未设置标准工时`, "process_nodes", r.id, "/process-tree");
        }
      }
    }
    return domainSummary("process", "工序工位", total, issues);
  }

  function checkLabor(issues) {
    if (!tableExists("users")) return { domain: "labor", label: "人员资质", total: 0, issues: 0, score: 100 };
    const total = countRows("users");
    if (has("users", "role_code") && has("users", "cert_no")) {
      for (const r of all("SELECT id, full_name, role_code FROM users WHERE role_code IN ('worker','welder','qc') AND (cert_no IS NULL OR trim(cert_no) = '') LIMIT 100")) {
        issue(issues, "labor", "missing_certificate", "high", "关键岗位缺少资质证书", `${r.full_name || r.id} (${r.role_code}) 未维护证书编号`, "users", r.id, "/labor");
      }
    }
    return domainSummary("labor", "人员资质", total, issues);
  }

  function domainSummary(domain, label, total, allIssues) {
    const issues = allIssues.filter((i) => i.domain === domain).length;
    const critical = allIssues.filter((i) => i.domain === domain && i.severity === "critical").length;
    const high = allIssues.filter((i) => i.domain === domain && i.severity === "high").length;
    const penalty = critical * 25 + high * 12 + (issues - critical - high) * 5;
    return { domain, label, total, issues, score: Math.max(0, Math.min(100, 100 - penalty)) };
  }

  function collect() {
    const issues = [];
    const domains = [
      checkMaterials(issues),
      checkBom(issues),
      checkDocuments(issues),
      checkSuppliers(issues),
      checkProcessAndStations(issues),
      checkLabor(issues),
    ];
    const ignored = ignoredIssueIds();
    for (let i = issues.length - 1; i >= 0; i -= 1) {
      if (ignored.has(issues[i].id)) issues.splice(i, 1);
    }
    issues.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
    const bySeverity = { critical: 0, high: 0, warning: 0, info: 0 };
    for (const i of issues) bySeverity[i.severity] = (bySeverity[i.severity] || 0) + 1;
    const avgScore = domains.length ? Math.round(domains.reduce((s, d) => s + d.score, 0) / domains.length) : 100;
    return { summary: { domains: domains.length, total_records: domains.reduce((s, d) => s + d.total, 0), issue_count: issues.length, avg_score: avgScore, by_severity: bySeverity }, domains, issues };
  }

  app.get("/api/mdm/overview", wrap((_req, res) => res.json(collect())));
  app.post("/api/mdm/issues/:id/waive", wrap((req, res) => {
    const data = collect();
    const item = data.issues.find((i) => i.id === req.params.id);
    if (!item) {
      db.prepare(`INSERT OR REPLACE INTO mdm_issue_waivers
        (issue_id, reason, active, closed_at)
        VALUES (?, ?, 1, datetime('now'))`).run(req.params.id, req.body?.reason || "异常中心关闭");
      return res.json({ ok: true, missing: true });
    }
    db.prepare(`INSERT OR REPLACE INTO mdm_issue_waivers
      (issue_id, domain, rule, source, ref_id, reason, active, closed_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))`).run(
      item.id, item.domain, item.rule, item.source, item.ref_id, req.body?.reason || "异常中心关闭"
    );
    res.json({ ok: true, issue: item });
  }));

  app.post("/api/mdm/issues/:id/reopen", wrap((req, res) => {
    db.prepare("UPDATE mdm_issue_waivers SET active = 0 WHERE issue_id = ?").run(req.params.id);
    res.json({ ok: true });
  }));

  app.get("/api/mdm/issues", wrap((req, res) => {
    const data = collect();
    let issues = data.issues;
    if (req.query.domain) issues = issues.filter((i) => i.domain === req.query.domain);
    if (req.query.severity) issues = issues.filter((i) => i.severity === req.query.severity);
    res.json({ summary: data.summary, issues: issues.slice(0, Math.min(Number(req.query.limit || 300), 500)) });
  }));
}


function collectForException(db) {
  const fakeApp = { get() {}, post() {} };
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
  try { db.prepare("UPDATE mdm_issue_waivers SET active = 0 WHERE issue_id = ?").run(issueId); } catch (_e) {}
}

module.exports = { register, collectForException, waiveIssue, reopenIssue };
