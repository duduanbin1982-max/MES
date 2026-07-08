"use strict";
const { ApiError } = require('../app/errors');
// services/digitalTwinService.js
const { wrap } = require("../middleware/asyncHandler");
// P2-4 Digital Twin: 3D model registry + Assembly status overlay + Real-time position data
const fs = require("fs");
const path = require("path");

function runMigration(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dt_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_code TEXT NOT NULL UNIQUE,
      model_name TEXT NOT NULL,
      equipment_instance_id INTEGER,
      file_format TEXT NOT NULL DEFAULT 'glb',
      file_path TEXT,
      file_size INTEGER,
      polygon_count INTEGER,
      bounding_box TEXT,
      pivot_point TEXT,
      scale_factor REAL NOT NULL DEFAULT 1.0,
      version TEXT NOT NULL DEFAULT '1.0',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS dt_part_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id INTEGER NOT NULL,
      part_name TEXT NOT NULL,
      material_id INTEGER,
      bom_node_id INTEGER,
      mesh_name TEXT,
      position_x REAL DEFAULT 0,
      position_y REAL DEFAULT 0,
      position_z REAL DEFAULT 0,
      rotation_x REAL DEFAULT 0,
      rotation_y REAL DEFAULT 0,
      rotation_z REAL DEFAULT 0,
      color_hex TEXT DEFAULT '#888888',
      highlight_color TEXT DEFAULT '#00ff00',
      assembly_step INTEGER,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (model_id) REFERENCES dt_models(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS dt_assembly_status (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id INTEGER NOT NULL,
      part_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      progress_pct REAL DEFAULT 0,
      assigned_worker TEXT,
      started_at TEXT,
      completed_at TEXT,
      qc_result TEXT,
      notes TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (model_id) REFERENCES dt_models(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS dt_overlay_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_code TEXT NOT NULL,
      model_id INTEGER,
      part_name TEXT,
      metric_name TEXT NOT NULL,
      metric_value REAL,
      metric_unit TEXT,
      color_hex TEXT,
      animation_state TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_dt_models_instance ON dt_models(equipment_instance_id);
    CREATE INDEX IF NOT EXISTS idx_dt_parts_model ON dt_part_mappings(model_id);
    CREATE INDEX IF NOT EXISTS idx_dt_asm_model ON dt_assembly_status(model_id);
    CREATE INDEX IF NOT EXISTS idx_dt_overlay_device ON dt_overlay_data(device_code);
  `);
}

function makeHelpers(db) {
  return {
    all: (sql, p) => db.prepare(sql).all(...(p||[])),
    get: (sql, p) => db.prepare(sql).get(...(p||[])),
    run: (sql, p) => db.prepare(sql).run(...(p||[])),
  };
}

// === 3D Models ===
function registerModels(app, db) {
  const { all, get, run } = makeHelpers(db);

  app.get("/api/dt/models", wrap((req, res) => {
    const { instance_id, status, format } = req.query;
    let sql = "SELECT m.*, ei.instance_code, ei.instance_name FROM dt_models m LEFT JOIN equipment_instances ei ON m.equipment_instance_id=ei.id WHERE 1=1";
    const p = [];
    if (instance_id) { sql += " AND m.equipment_instance_id=?"; p.push(instance_id); }
    if (status) { sql += " AND m.status=?"; p.push(status); }
    if (format) { sql += " AND m.file_format=?"; p.push(format); }
    sql += " ORDER BY m.id";
    res.json(all(sql, p));
  }));

  app.get("/api/dt/models/:id", wrap((req, res) => {
    const m = get("SELECT m.*, ei.instance_code FROM dt_models m LEFT JOIN equipment_instances ei ON m.equipment_instance_id=ei.id WHERE m.id=?", [req.params.id]);
    if (!m) throw ApiError.notFound("Model not found")
    const parts = all("SELECT * FROM dt_part_mappings WHERE model_id=? ORDER BY assembly_step, id", [req.params.id]);
    const asm = all("SELECT * FROM dt_assembly_status WHERE model_id=? ORDER BY id", [req.params.id]);
    res.json(Object.assign({}, m, { parts, assembly_status: asm }));
  }));

  app.post("/api/dt/models", wrap((req, res) => {
    const { model_code, model_name, equipment_instance_id, file_format, file_path, file_size, polygon_count, bounding_box, pivot_point, scale_factor, version } = req.body;
    if (!model_code || !model_name) throw ApiError.validation("model_code and model_name required")
    const r = run("INSERT INTO dt_models (model_code,model_name,equipment_instance_id,file_format,file_path,file_size,polygon_count,bounding_box,pivot_point,scale_factor,version) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [model_code, model_name, equipment_instance_id||null, file_format||"glb", file_path||null, file_size||null, polygon_count||null, bounding_box||null, pivot_point||null, scale_factor||1.0, version||"1.0"]);
    res.json({ id: r.lastInsertRowid, model_code });
  }));

  app.put("/api/dt/models/:id", wrap((req, res) => {
    const { model_name, file_path, file_size, polygon_count, bounding_box, scale_factor, version, status } = req.body;
    run("UPDATE dt_models SET model_name=COALESCE(?,model_name), file_path=COALESCE(?,file_path), file_size=COALESCE(?,file_size), polygon_count=COALESCE(?,polygon_count), bounding_box=COALESCE(?,bounding_box), scale_factor=COALESCE(?,scale_factor), version=COALESCE(?,version), status=COALESCE(?,status), updated_at=datetime('now') WHERE id=?",
      [model_name||null, file_path||null, file_size||null, polygon_count||null, bounding_box||null, scale_factor||null, version||null, status||null, req.params.id]);
    res.json({ success: true });
  }));
}

// === Part Mappings ===
function registerParts(app, db) {
  const { all, get, run } = makeHelpers(db);

  app.get("/api/dt/models/:id/parts", wrap((req, res) => {
    res.json(all("SELECT * FROM dt_part_mappings WHERE model_id=? ORDER BY assembly_step, id", [req.params.id]));
  }));

  app.post("/api/dt/models/:id/parts", wrap((req, res) => {
    const { part_name, material_id, bom_node_id, mesh_name, position_x, position_y, position_z, rotation_x, rotation_y, rotation_z, color_hex, highlight_color, assembly_step, notes } = req.body;
    if (!part_name) throw ApiError.validation("part_name required")
    const r = run("INSERT INTO dt_part_mappings (model_id,part_name,material_id,bom_node_id,mesh_name,position_x,position_y,position_z,rotation_x,rotation_y,rotation_z,color_hex,highlight_color,assembly_step,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [req.params.id, part_name, material_id||null, bom_node_id||null, mesh_name||null, position_x||0, position_y||0, position_z||0, rotation_x||0, rotation_y||0, rotation_z||0, color_hex||"#888888", highlight_color||"#00ff00", assembly_step||null, notes||null]);
    res.json({ id: r.lastInsertRowid, part_name });
  }));
}

// === Assembly Status ===
function registerAssembly(app, db) {
  const { all, get, run } = makeHelpers(db);

  app.get("/api/dt/assembly-status", wrap((req, res) => {
    const { model_id, status } = req.query;
    let sql = "SELECT a.*, m.model_name, m.model_code FROM dt_assembly_status a JOIN dt_models m ON a.model_id=m.id WHERE 1=1";
    const p = [];
    if (model_id) { sql += " AND a.model_id=?"; p.push(model_id); }
    if (status) { sql += " AND a.status=?"; p.push(status); }
    sql += " ORDER BY a.model_id, a.id";
    res.json(all(sql, p));
  }));

  app.put("/api/dt/assembly-status/:id", wrap((req, res) => {
    const { status, progress_pct, assigned_worker, qc_result, notes } = req.body;
    const now = status === "completed" ? ", completed_at=datetime('now')" : (status === "started" ? ", started_at=datetime('now')" : "");
    run("UPDATE dt_assembly_status SET status=COALESCE(?,status), progress_pct=COALESCE(?,progress_pct), assigned_worker=COALESCE(?,assigned_worker), qc_result=COALESCE(?,qc_result), notes=COALESCE(?,notes), updated_at=datetime('now')" + now + " WHERE id=?",
      [status||null, progress_pct||null, assigned_worker||null, qc_result||null, notes||null, req.params.id]);
    res.json({ success: true });
  }));

  app.get("/api/dt/assembly-progress/:model_id", wrap((req, res) => {
    const total = db.prepare("SELECT COUNT(*) AS c FROM dt_assembly_status WHERE model_id=?").get(req.params.id).c;
    const completed = db.prepare("SELECT COUNT(*) AS c FROM dt_assembly_status WHERE model_id=? AND status='completed'").get(req.params.id).c;
    const inProgress = db.prepare("SELECT COUNT(*) AS c FROM dt_assembly_status WHERE model_id=? AND status='started'").get(req.params.id).c;
    const parts = all("SELECT part_name, status, progress_pct, assigned_worker, updated_at FROM dt_assembly_status WHERE model_id=? ORDER BY id", [req.params.id]);
    res.json({ model_id: parseInt(req.params.id), total_parts: total, completed, in_progress: inProgress, pending: total - completed - inProgress, progress_pct: total > 0 ? Math.round(completed / total * 100) : 0, parts });
  }));
}

// === Real-time Overlay (for 3D viewer) ===
function registerOverlay(app, db) {
  const { all, get, run } = makeHelpers(db);

  app.post("/api/dt/overlay", wrap((req, res) => {
    const { device_code, model_id, part_name, metric_name, metric_value, metric_unit, color_hex, animation_state } = req.body;
    if (!device_code || !metric_name) throw ApiError.validation("device_code and metric_name required")
    run("INSERT OR REPLACE INTO dt_overlay_data (device_code, model_id, part_name, metric_name, metric_value, metric_unit, color_hex, animation_state, updated_at) VALUES (?,?,?,?,?,?,?,?,datetime('now'))",
      [device_code, model_id||null, part_name||null, metric_name, metric_value||null, metric_unit||null, color_hex||null, animation_state||null]);
    res.json({ success: true });
  }));

  app.get("/api/dt/overlay", wrap((req, res) => {
    const { model_id, device_code } = req.query;
    let sql = "SELECT * FROM dt_overlay_data WHERE 1=1";
    const p = [];
    if (model_id) { sql += " AND model_id=?"; p.push(model_id); }
    if (device_code) { sql += " AND device_code=?"; p.push(device_code); }
    sql += " ORDER BY updated_at DESC";
    res.json(all(sql, p));
  }));

  // Full scene data (model + parts + assembly + overlay + IoT readings)
  app.get("/api/dt/scene/:model_id", wrap((req, res) => {
    const mid = req.params.model_id;
    const model = get("SELECT m.*, ei.instance_code FROM dt_models m LEFT JOIN equipment_instances ei ON m.equipment_instance_id=ei.id WHERE m.id=?", [mid]);
    if (!model) throw ApiError.notFound("Model not found")
    const parts = all("SELECT * FROM dt_part_mappings WHERE model_id=? ORDER BY assembly_step, id", [mid]);
    const asm = all("SELECT part_name, status, progress_pct, assigned_worker, qc_result, updated_at FROM dt_assembly_status WHERE model_id=? ORDER BY id", [mid]);
    const overlay = all("SELECT * FROM dt_overlay_data WHERE model_id=?", [mid]);
    const iotLatest = all(
      "SELECT d.device_code, r.value, r.read_at, dp.point_name, dp.unit FROM iot_readings r JOIN iot_devices d ON r.device_id=d.id LEFT JOIN iot_data_points dp ON r.point_id=dp.id WHERE r.id IN (SELECT MAX(id) FROM iot_readings GROUP BY device_id) AND d.is_active=1"
    );
    res.json({ model, parts, assembly_status: asm, overlay, iot_latest: iotLatest, generated_at: new Date().toISOString() });
  }));
}

// === Dashboard ===
function registerDashboard(app, db) {
  const { all, get, run } = makeHelpers(db);
  app.get("/api/dt/dashboard", wrap((req, res) => {
    const modelCount = db.prepare("SELECT COUNT(*) AS c FROM dt_models WHERE status='active'").get().c;
    const partCount = db.prepare("SELECT COUNT(*) AS c FROM dt_part_mappings").get().c;
    const asmCompleted = db.prepare("SELECT COUNT(*) AS c FROM dt_assembly_status WHERE status='completed'").get().c;
    const asmTotal = db.prepare("SELECT COUNT(*) AS c FROM dt_assembly_status").get().c;
    const overlayCount = db.prepare("SELECT COUNT(*) AS c FROM dt_overlay_data").get().c;
    res.json({
      models: modelCount,
      parts: partCount,
      assembly: { completed: asmCompleted, total: asmTotal, pct: asmTotal > 0 ? Math.round(asmCompleted / asmTotal * 100) : 0 },
      overlay_data_points: overlayCount
    });
  }));
}

function register(app, db) {
  runMigration(db);
  registerModels(app, db);
  registerParts(app, db);
  registerAssembly(app, db);
  registerOverlay(app, db);
  registerDashboard(app, db);
  console.log("[digitalTwinService] Digital Twin registered (Models + Parts + Assembly + Overlay + Scene)");
}

module.exports = { register };