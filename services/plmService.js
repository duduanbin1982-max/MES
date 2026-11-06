"use strict";
const { ApiError } = require('../app/errors');
const { wrap } = require('../middleware/asyncHandler');
// services/plmService.js
// P2-3 PLM Integration: Drawing version control + BOM linkage + CAD metadata + ECO sync
require("fs");
require("path");
require("crypto");

const logger = require("../app/logger").createLogger("plmService");
const audit = require("../app/audit");

function runMigration(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plm_drawings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drawing_no TEXT NOT NULL,
      revision TEXT NOT NULL DEFAULT 'A0',
      title TEXT NOT NULL,
      cad_software TEXT,
      cad_file_path TEXT,
      file_hash TEXT,
      file_size INTEGER,
      bom_node_id INTEGER,
      equipment_instance_id INTEGER,
      sheet_size TEXT,
      scale TEXT,
      designer TEXT,
      reviewer TEXT,
      approved_by TEXT,
      approved_at TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      effective_date TEXT,
      obsolete_date TEXT,
      predecessor_id INTEGER,
      change_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS plm_drawing_bom_link (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drawing_id INTEGER NOT NULL,
      bom_node_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(drawing_id, bom_node_id)
    );
    CREATE TABLE IF NOT EXISTS plm_eco_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      eco_no TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      change_type TEXT NOT NULL DEFAULT 'design',
      reason TEXT,
      requested_by TEXT,
      drawing_id INTEGER,
      bom_node_id INTEGER,
      equipment_instance_id INTEGER,
      old_revision TEXT,
      new_revision TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      approved_by TEXT,
      approved_at TEXT,
      implemented_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS plm_cad_metadata (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drawing_id INTEGER NOT NULL,
      file_format TEXT,
      part_count INTEGER,
      assembly_level INTEGER,
      extracted_bom_json TEXT,
      last_sync_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_plm_dwg_no ON plm_drawings(drawing_no);
    CREATE INDEX IF NOT EXISTS idx_plm_dwg_status ON plm_drawings(status);
    CREATE INDEX IF NOT EXISTS idx_plm_eco_status ON plm_eco_changes(status);
    CREATE INDEX IF NOT EXISTS idx_plm_dwg_bom ON plm_drawing_bom_link(drawing_id);
  `);
}

function makeHelpers(db) {
  return {
    all: (sql, p) => db.prepare(sql).all(...(p||[])),
    get: (sql, p) => db.prepare(sql).get(...(p||[])),
    run: (sql, p) => db.prepare(sql).run(...(p||[])),
  };
}

function nextEcoNo(db) {
  const r = db.prepare("SELECT COALESCE(MAX(CAST(SUBSTR(eco_no,4) AS INTEGER)),0)+1 AS n FROM plm_eco_changes").get();
  return "ECO" + String(r.n).padStart(6,"0");
}

function bumpRevision(rev) {
  const m = rev.match(/^([A-Z])(\d+)$/i);
  if (!m) return "A1";
  const letter = m[1], num = parseInt(m[2]);
  if (num < 9) return letter + (num + 1);
  return String.fromCharCode(letter.charCodeAt(0) + 1) + "0";
}

// === Drawings ===
function registerDrawings(app, db) {
  const { all, get, run } = makeHelpers(db);

  app.get("/api/plm/drawings", wrap((req, res) => {
    const { status, bom_node_id, instance_id, drawing_no } = req.query;
    let sql = "SELECT d.*, ei.instance_code FROM plm_drawings d LEFT JOIN equipment_instances ei ON d.equipment_instance_id=ei.id WHERE 1=1";
    const p = [];
    if (status) { sql += " AND d.status=?"; p.push(status); }
    if (bom_node_id) { sql += " AND d.bom_node_id=?"; p.push(bom_node_id); }
    if (instance_id) { sql += " AND d.equipment_instance_id=?"; p.push(instance_id); }
    if (drawing_no) { sql += " AND d.drawing_no LIKE ?"; p.push("%" + drawing_no + "%"); }
    sql += " ORDER BY d.updated_at DESC LIMIT 200";
    res.json(all(sql, p));
  }));

  app.get("/api/plm/drawings/:id", wrap((req, res) => {
    const d = get("SELECT d.*, ei.instance_code FROM plm_drawings d LEFT JOIN equipment_instances ei ON d.equipment_instance_id=ei.id WHERE d.id=?", [req.params.id]);
    if (!d) throw ApiError.notFound("Drawing not found")
    const links = all("SELECT * FROM plm_drawing_bom_link WHERE drawing_id=?", [req.params.id]);
    const eco = all("SELECT * FROM plm_eco_changes WHERE drawing_id=? ORDER BY created_at DESC", [req.params.id]);
    const cad = get("SELECT * FROM plm_cad_metadata WHERE drawing_id=?", [req.params.id]);
    const versions = all("SELECT id, revision, status, file_hash, effective_date, created_at FROM plm_drawings WHERE drawing_no=? ORDER BY revision DESC", [d.drawing_no]);
    res.json(Object.assign({}, d, { bom_links: links, ecos: eco, cad_meta: cad, versions }));
  }));

  app.post("/api/plm/drawings", wrap((req, res) => {
    const { drawing_no, revision, title, cad_software, cad_file_path, file_hash, file_size, bom_node_id, equipment_instance_id, sheet_size, scale, designer, reviewer, status, effective_date, change_reason } = req.body;
    if (!drawing_no || !title) throw ApiError.validation("drawing_no and title required")
    const r = run("INSERT INTO plm_drawings (drawing_no,revision,title,cad_software,cad_file_path,file_hash,file_size,bom_node_id,equipment_instance_id,sheet_size,scale,designer,reviewer,status,effective_date,change_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [drawing_no, revision||"A0", title, cad_software||null, cad_file_path||null, file_hash||null, file_size||null, bom_node_id||null, equipment_instance_id||null, sheet_size||null, scale||null, designer||null, reviewer||null, status||"draft", effective_date||null, change_reason||null]);
    res.json({ id: r.lastInsertRowid, drawing_no, revision: revision||"A0" });
  }));

  app.post("/api/plm/drawings/:id/revise", wrap((req, res) => {
    const old = get("SELECT * FROM plm_drawings WHERE id=?", [req.params.id]);
    if (!old) throw ApiError.notFound("Drawing not found")
    const newRev = req.body.new_revision || bumpRevision(old.revision);
    const r = run("INSERT INTO plm_drawings (drawing_no,revision,title,cad_software,cad_file_path,file_hash,file_size,bom_node_id,equipment_instance_id,sheet_size,scale,designer,reviewer,change_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [old.drawing_no, newRev, req.body.title||old.title, old.cad_software, old.cad_file_path, req.body.file_hash||null, req.body.file_size||null, old.bom_node_id, old.equipment_instance_id, old.sheet_size, old.scale, req.body.designer||old.designer, req.body.reviewer||null, req.body.change_reason||null]);
    run("UPDATE plm_drawings SET status='superseded', obsolete_date=date('now'), updated_at=datetime('now') WHERE id=?", [req.params.id]);
    res.json({ id: r.lastInsertRowid, drawing_no: old.drawing_no, revision: newRev, predecessor_id: old.id });
  }));

  app.put("/api/plm/drawings/:id/issue", wrap((req, res) => {
    run("UPDATE plm_drawings SET status='issued', effective_date=COALESCE(?,date('now')), approved_by=?, approved_at=datetime('now'), updated_at=datetime('now') WHERE id=?",
      [req.body.effective_date||null, req.body.approved_by||null, req.params.id]);
    res.json({ success: true });
  }));

  app.post("/api/plm/drawings/:id/bom-link", wrap((req, res) => {
    const { bom_node_id, quantity, notes } = req.body;
    if (!bom_node_id) throw ApiError.validation("bom_node_id required")
    run("INSERT OR REPLACE INTO plm_drawing_bom_link (drawing_id, bom_node_id, quantity, notes) VALUES (?,?,?,?)",
      [req.params.id, bom_node_id, quantity||1, notes||null]);
    res.json({ success: true });
  }));
}

// === ECO (Engineering Change Orders) ===
function registerEco(app, db) {
  const { all, get, run } = makeHelpers(db);

  app.get("/api/plm/ecos", wrap((req, res) => {
    const { status, instance_id, drawing_id } = req.query;
    let sql = "SELECT e.*, d.drawing_no, d.title AS drawing_title, ei.instance_code FROM plm_eco_changes e LEFT JOIN plm_drawings d ON e.drawing_id=d.id LEFT JOIN equipment_instances ei ON e.equipment_instance_id=ei.id WHERE 1=1";
    const p = [];
    if (status) { sql += " AND e.status=?"; p.push(status); }
    if (instance_id) { sql += " AND e.equipment_instance_id=?"; p.push(instance_id); }
    if (drawing_id) { sql += " AND e.drawing_id=?"; p.push(drawing_id); }
    sql += " ORDER BY e.created_at DESC LIMIT 200";
    res.json(all(sql, p));
  }));

  // 2026-11-07（ECO 审计）：补输入校验、状态机 guard 与审计（原实现任意状态都能重复 approve/implement）。
  app.post("/api/plm/ecos", wrap((req, res) => {
    const body = req.body || {};
    const title = String(body.title || "").trim();
    if (!title) throw ApiError.validation("title required");
    if (title.length > 200) throw ApiError.validation("title 长度不能超过 200");
    const changeType = String(body.change_type || "design").trim();
    if (!["design", "process", "material", "other"].includes(changeType)) {
      throw ApiError.validation("change_type 必须是 design / process / material / other");
    }
    const revisionRe = /^[A-Za-z]\d{1,3}$/;
    for (const [field, value] of [["old_revision", body.old_revision], ["new_revision", body.new_revision]]) {
      if (value && !revisionRe.test(String(value))) throw ApiError.validation(`${field} 需形如 A0/A1`);
    }
    if (body.drawing_id) {
      const drawing = get("SELECT id FROM plm_drawings WHERE id=?", [Number(body.drawing_id)]);
      if (!drawing) throw ApiError.validation("drawing_id 不存在");
    }
    if (body.equipment_instance_id) {
      const instance = get("SELECT id FROM equipment_instances WHERE id=?", [Number(body.equipment_instance_id)]);
      if (!instance) throw ApiError.validation("equipment_instance_id 不存在");
    }
    if (body.bom_node_id) {
      const bom = get("SELECT id, equipment_instance_id FROM instance_bom WHERE id=?", [Number(body.bom_node_id)]);
      if (!bom) throw ApiError.validation("bom_node_id 不存在");
      if (body.equipment_instance_id && Number(bom.equipment_instance_id) !== Number(body.equipment_instance_id)) {
        throw ApiError.validation("bom_node_id 不属于该装备实例");
      }
    }
    const ecoNo = nextEcoNo(db);
    let r;
    try {
      r = run("INSERT INTO plm_eco_changes (eco_no,title,change_type,reason,requested_by,drawing_id,bom_node_id,equipment_instance_id,old_revision,new_revision,status) VALUES (?,?,?,?,?,?,?,?,?,?,'draft')",
        [ecoNo, title, changeType, body.reason || null, body.requested_by || null, body.drawing_id || null, body.bom_node_id || null, body.equipment_instance_id || null, body.old_revision || null, body.new_revision || null]);
    } catch (error) {
      if (/UNIQUE/i.test(String(error.message))) throw ApiError.conflict("ECO 编号冲突，请重试");
      throw error;
    }
    audit.record(db, req, {
      action: "plm_eco.create",
      resource_type: "plm_eco_changes",
      resource_id: r.lastInsertRowid,
      after: { eco_no: ecoNo, title, change_type: changeType, drawing_id: body.drawing_id || null },
      diff_summary: `创建 PLM ECO ${ecoNo}`,
    });
    res.json({ id: r.lastInsertRowid, eco_no: ecoNo });
  }));

  app.put("/api/plm/ecos/:id/approve", wrap((req, res) => {
    const eco = get("SELECT * FROM plm_eco_changes WHERE id=?", [req.params.id]);
    if (!eco) throw ApiError.notFound("ECO not found");
    if (eco.status !== "draft") throw ApiError.conflict(`ECO 当前状态 ${eco.status}，只有 draft 可批准`);
    run("UPDATE plm_eco_changes SET status='approved', approved_by=?, approved_at=datetime('now') WHERE id=?",
      [req.body.approved_by||null, req.params.id]);
    if (eco.drawing_id && eco.new_revision) {
      run("UPDATE plm_drawings SET revision=?, updated_at=datetime('now') WHERE id=? AND status='issued'",
        [eco.new_revision, eco.drawing_id]);
    }
    audit.record(db, req, {
      action: "plm_eco.approve",
      resource_type: "plm_eco_changes",
      resource_id: eco.id,
      before: { status: eco.status },
      after: { status: "approved", approved_by: req.body.approved_by || null },
      diff_summary: `批准 PLM ECO ${eco.eco_no}`,
    });
    res.json({ success: true });
  }));

  app.put("/api/plm/ecos/:id/implement", wrap((req, res) => {
    const eco = get("SELECT * FROM plm_eco_changes WHERE id=?", [req.params.id]);
    if (!eco) throw ApiError.notFound("ECO not found");
    if (eco.status !== "approved") throw ApiError.conflict(`ECO 当前状态 ${eco.status}，只有 approved 可实施`);
    run("UPDATE plm_eco_changes SET status='implemented', implemented_at=datetime('now') WHERE id=?", [req.params.id]);
    audit.record(db, req, {
      action: "plm_eco.implement",
      resource_type: "plm_eco_changes",
      resource_id: eco.id,
      before: { status: eco.status },
      after: { status: "implemented" },
      diff_summary: `实施 PLM ECO ${eco.eco_no}`,
    });
    res.json({ success: true });
  }));
}

// === CAD Metadata ===
function registerCadMeta(app, db) {
  const { all, get, run } = makeHelpers(db);

  app.get("/api/plm/cad-meta", wrap((req, res) => {
    const { drawing_id, software } = req.query;
    let sql = "SELECT * FROM plm_cad_metadata WHERE 1=1";
    const p = [];
    if (drawing_id) { sql += " AND drawing_id=?"; p.push(drawing_id); }
    if (software) { sql += " AND cad_software=?"; p.push(software); }
    sql += " ORDER BY created_at DESC";
    res.json(all(sql, p));
  }));
  app.post("/api/plm/cad-meta", wrap((req, res) => {
    const { drawing_id, file_format, part_count, assembly_level, extracted_bom_json } = req.body;
    if (!drawing_id) throw ApiError.validation("drawing_id required")
    run("INSERT OR REPLACE INTO plm_cad_metadata (drawing_id, file_format, part_count, assembly_level, extracted_bom_json, last_sync_at) VALUES (?,?,?,?,?,datetime('now'))",
      [drawing_id, file_format||null, part_count||null, assembly_level||null, extracted_bom_json ? JSON.stringify(extracted_bom_json) : null]);
    res.json({ success: true, drawing_id });
  }));

  app.post("/api/plm/cad-meta/extract-bom", wrap((req, res) => {
    const { drawing_id } = req.body;
    if (!drawing_id) throw ApiError.validation("drawing_id required")
    const dwg = get("SELECT * FROM plm_drawings WHERE id=?", [drawing_id]);
    if (!dwg) throw ApiError.notFound("Drawing not found")
    const simulatedBom = {
      drawing_no: dwg.drawing_no, revision: dwg.revision,
      cad_software: dwg.cad_software || "SolidWorks",
      extracted_at: new Date().toISOString(),
      parts: [
        { part_no: dwg.drawing_no + "-01", name: "底座焊接件", qty: 1, material: "Q235B", weight_kg: 45.2 },
        { part_no: dwg.drawing_no + "-02", name: "侧板", qty: 2, material: "Q235B", weight_kg: 12.8 },
        { part_no: dwg.drawing_no + "-03", name: "加强筋", qty: 4, material: "Q235B", weight_kg: 3.5 }
      ]
    };
    run("INSERT OR REPLACE INTO plm_cad_metadata (drawing_id, file_format, part_count, assembly_level, extracted_bom_json, last_sync_at) VALUES (?,?,?,?,?,datetime('now'))",
      [drawing_id, dwg.cad_software, simulatedBom.parts.length, 1, JSON.stringify(simulatedBom)]);
    res.json(simulatedBom);
  }));
}

// === Dashboard ===
function registerDashboard(app, db) {
  const { all } = makeHelpers(db);

  app.get("/api/plm/dashboard", wrap((req, res) => {
    const totalDrawings = db.prepare("SELECT COUNT(*) AS c FROM plm_drawings").get().c;
    const issuedDrawings = db.prepare("SELECT COUNT(*) AS c FROM plm_drawings WHERE status='issued'").get().c;
    const pendingEcos = db.prepare("SELECT COUNT(*) AS c FROM plm_eco_changes WHERE status='draft'").get().c;
    const recentChanges = all("SELECT e.*, d.drawing_no FROM plm_eco_changes e LEFT JOIN plm_drawings d ON e.drawing_id=d.id ORDER BY e.created_at DESC LIMIT 10");
    const drawingsByStatus = all("SELECT status, COUNT(*) AS cnt FROM plm_drawings GROUP BY status");
    res.json({
      drawings: { total: totalDrawings, issued: issuedDrawings, draft: totalDrawings - issuedDrawings },
      eco: { pending: pendingEcos },
      recent_ecos: recentChanges,
      by_status: drawingsByStatus
    });
  }));
}

function register(app, db) {
  runMigration(db);
  registerDrawings(app, db);
  registerEco(app, db);
  registerCadMeta(app, db);
  registerDashboard(app, db);
  logger.info("[plmService] PLM integration registered (Drawings + ECO + CAD Meta + Dashboard)");
}

module.exports = { register };