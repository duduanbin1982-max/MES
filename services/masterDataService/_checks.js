"use strict";
// 主数据体检规则（原 masterDataService.js 的 register() 前置逻辑）

module.exports = function createChecks(h) {
  const { all, get, has, columns, tableExists, MDM_ALLOWED_TABLES, issue, stableIssueId, ignoredIssueIds, severityRank } = h;

  function firstTable(names) {
    return names.find(tableExists);
  }

  function countRows(table) {
    if (!MDM_ALLOWED_TABLES.has(table)) throw new Error("Invalid table name: " + table);
    const row = tableExists(table) ? get(`SELECT COUNT(*) AS c FROM ${table}`) : null;
    return row ? Number(row.c || 0) : 0;
  }

  function checkMaterials(issues) {
    if (!tableExists("materials")) return { domain: "materials", label: "物料编码", total: 0, issues: 0, score: 100 };
    const codeCol = has("materials", "material_code") ? "material_code" : has("materials", "code") ? "code" : null;
    const nameCol = has("materials", "material_name") ? "material_name" : has("materials", "name") ? "name" : null;
    const total = countRows("materials");
    if (!codeCol) {
      issue(issues, { domain: "materials", rule: "missing_code_column", severity: "critical", title: "物料表缺少编码字段", detail: "materials 表没有 material_code/code 字段", source: "materials", refId: null, path: "/materials" });
      return { domain: "materials", label: "物料编码", total, issues: 1, score: 40 };
    }

    for (const r of all(`SELECT id, ${codeCol} AS code, ${nameCol || "''"} AS name FROM materials WHERE ${codeCol} IS NULL OR trim(${codeCol}) = '' LIMIT 100`)) {
      issue(issues, { domain: "materials", rule: "missing_code", severity: "critical", title: "物料缺少编码", detail: `${r.name || "未命名物料"} 没有物料编码`, source: "materials", refId: r.id, path: "/materials" });
    }
    for (const r of all(`SELECT ${codeCol} AS code, COUNT(*) AS c FROM materials WHERE ${codeCol} IS NOT NULL AND trim(${codeCol}) <> '' GROUP BY ${codeCol} HAVING COUNT(*) > 1 LIMIT 100`)) {
      issue(issues, { domain: "materials", rule: "duplicate_code", severity: "critical", title: "物料编码重复", detail: `${r.code} 出现 ${r.c} 次`, source: "materials", refId: r.code, path: "/materials" });
    }
    for (const r of all(`SELECT id, ${codeCol} AS code, ${nameCol || "''"} AS name FROM materials WHERE ${codeCol} IS NOT NULL AND (length(trim(${codeCol})) < 4 OR instr(${codeCol}, '-') = 0 OR ${codeCol} GLOB '*[^A-Z0-9._-]*') LIMIT 100`)) {
      issue(issues, { domain: "materials", rule: "code_pattern", severity: "warning", title: "物料编码格式异常", detail: `${r.code} 建议使用大写分类前缀 + 分隔符`, source: "materials", refId: r.id, path: "/materials" });
    }
    if (nameCol) {
      for (const r of all(`SELECT ${nameCol} AS name, COUNT(*) AS c FROM materials WHERE ${nameCol} IS NOT NULL AND trim(${nameCol}) <> '' GROUP BY ${nameCol} HAVING COUNT(*) > 1 LIMIT 50`)) {
        issue(issues, { domain: "materials", rule: "duplicate_name", severity: "warning", title: "物料名称重复", detail: `${r.name} 出现 ${r.c} 次，需确认是否一物多码`, source: "materials", refId: r.name, path: "/materials" });
      }
    }
    return domainSummary("materials", "物料编码", total, issues);
  }

  function checkBom(issues) {
    const table = firstTable(["instance_bom", "bom_nodes", "equipment_bom", "bom_items", "bom_components"]);
    if (!table) return { domain: "bom", label: "BOM 层级", total: 0, issues: 0, score: 100 };
    const total = countRows(table);
    const idCol = has(table, "id") ? "id" : "rowid";
    const levelCol = ["level_code", "level_no", "level", "tier", "hierarchy"].find((c) => has(table, c));
    const parentCol = ["parent_id", "parent_node_id"].find((c) => has(table, c));
    const qtyCol = ["quantity", "qty", "net_qty"].find((c) => has(table, c));
    const partCol = ["part_number", "material_code", "item_code", "code"].find((c) => has(table, c));
    const versionCol = ["version", "revision", "rev"].find((c) => has(table, c));

    if (!levelCol) issue(issues, { domain: "bom", rule: "missing_level", severity: "critical", title: "BOM 缺少层级号", detail: `${table} 未发现 level_code/level_no/level 字段`, source: table, refId: null, path: "/bom" });
    if (!parentCol) issue(issues, { domain: "bom", rule: "missing_parent", severity: "high", title: "BOM 缺少父子关系字段", detail: `${table} 未发现 parent_id 字段`, source: table, refId: null, path: "/bom" });
    if (!versionCol) issue(issues, { domain: "bom", rule: "missing_version", severity: "warning", title: "BOM 缺少版本字段", detail: `${table} 未发现 version/revision 字段`, source: table, refId: null, path: "/bom" });
    if (qtyCol) {
      if (!MDM_ALLOWED_TABLES.has(table)) throw new Error("Invalid table name: " + table);
      for (const r of all(`SELECT ${idCol} AS id, ${qtyCol} AS qty FROM ${table} WHERE COALESCE(${qtyCol}, 0) <= 0 LIMIT 100`)) {
        issue(issues, { domain: "bom", rule: "invalid_qty", severity: "high", title: "BOM 用量异常", detail: `节点 ${r.id} 的数量为 ${r.qty || 0}`, source: table, refId: r.id, path: "/bom" });
      }
    }
    if (partCol) {
      if (!MDM_ALLOWED_TABLES.has(table)) throw new Error("Invalid table name: " + table);
      for (const r of all(`SELECT ${idCol} AS id FROM ${table} WHERE ${partCol} IS NULL OR trim(${partCol}) = '' LIMIT 100`)) {
        issue(issues, { domain: "bom", rule: "missing_part", severity: "high", title: "BOM 节点缺少物料/图号", detail: `节点 ${r.id} 未填写物料编码或图号`, source: table, refId: r.id, path: "/bom" });
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
      issue(issues, { domain: "documents", rule: "missing_version_column", severity: "critical", title: "文档缺少版本字段", detail: "documents 表未发现 version/revision 字段", source: "documents", refId: null, path: "/documents" });
    } else {
      for (const r of all(`SELECT id, title, ${versionCol} AS version FROM documents WHERE ${versionCol} IS NULL OR trim(${versionCol}) = '' LIMIT 100`)) {
        issue(issues, { domain: "documents", rule: "missing_version", severity: "high", title: "图纸/文档缺少版本", detail: `${r.title || r.id} 未填写版本`, source: "documents", refId: r.id, path: "/documents" });
      }
    }
    if (codeCol && versionCol) {
      for (const r of all(`SELECT ${codeCol} AS code, ${versionCol} AS version, COUNT(*) AS c FROM documents WHERE ${codeCol} IS NOT NULL GROUP BY ${codeCol}, ${versionCol} HAVING COUNT(*) > 1 LIMIT 50`)) {
        issue(issues, { domain: "documents", rule: "duplicate_code_version", severity: "high", title: "图纸编码版本重复", detail: `${r.code}/${r.version || "-"} 出现 ${r.c} 次`, source: "documents", refId: r.code, path: "/documents" });
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
      if (!MDM_ALLOWED_TABLES.has(table)) throw new Error("Invalid table name: " + table);
      for (const r of all(`SELECT rowid AS id FROM ${table} WHERE ${nameCol} IS NULL OR trim(${nameCol}) = '' LIMIT 100`)) {
        issue(issues, { domain: "suppliers", rule: "missing_name", severity: "high", title: "供应商缺少名称", detail: `供应商记录 ${r.id} 未填写名称`, source: table, refId: r.id, path: "/purchase" });
      }
    }
    if (!codeCol) issue(issues, { domain: "suppliers", rule: "missing_code_column", severity: "warning", title: "供应商缺少编码字段", detail: `${table} 未发现 supplier_code/code 字段`, source: table, refId: null, path: "/purchase" });
    return domainSummary("suppliers", "供应商", total, issues);
  }

  function checkProcessAndStations(issues) {
    let total = 0;
    if (tableExists("workstations")) {
      total += countRows("workstations");
      if (has("workstations", "code")) {
        for (const r of all("SELECT code, COUNT(*) AS c FROM workstations WHERE code IS NOT NULL GROUP BY code HAVING COUNT(*) > 1 LIMIT 50")) {
          issue(issues, { domain: "process", rule: "duplicate_station_code", severity: "high", title: "工位编码重复", detail: `${r.code} 出现 ${r.c} 次`, source: "workstations", refId: r.code, path: "/resources" });
        }
      }
      if (has("workstations", "capacity_per_day")) {
        for (const r of all("SELECT id, code, name FROM workstations WHERE COALESCE(capacity_per_day, 0) <= 0 LIMIT 100")) {
          issue(issues, { domain: "process", rule: "missing_capacity", severity: "warning", title: "工位缺少产能", detail: `${r.code || r.name || r.id} 未设置日产能`, source: "workstations", refId: r.id, path: "/resources" });
        }
      }
    }
    if (tableExists("process_nodes")) {
      total += countRows("process_nodes");
      const stdCol = ["standard_hours", "standard_minutes", "planned_hours", "estimated_hours"].find((c) => has("process_nodes", c));
      if (!stdCol) {
        issue(issues, { domain: "process", rule: "missing_standard_time_column", severity: "warning", title: "工序缺少标准工时字段", detail: "process_nodes 未发现 standard_hours/standard_minutes 字段", source: "process_nodes", refId: null, path: "/process-tree" });
      } else {
        for (const r of all(`SELECT id, operation_name FROM process_nodes WHERE COALESCE(${stdCol}, 0) <= 0 LIMIT 100`)) {
          issue(issues, { domain: "process", rule: "missing_standard_time", severity: "warning", title: "工序缺少标准工时", detail: `${r.operation_name || r.id} 未设置标准工时`, source: "process_nodes", refId: r.id, path: "/process-tree" });
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
        issue(issues, { domain: "labor", rule: "missing_certificate", severity: "high", title: "关键岗位缺少资质证书", detail: `${r.full_name || r.id} (${r.role_code}) 未维护证书编号`, source: "users", refId: r.id, path: "/labor" });
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

  return { firstTable, countRows, checkMaterials, checkBom, checkDocuments, checkSuppliers, checkProcessAndStations, checkLabor, domainSummary };
};
