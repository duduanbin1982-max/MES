"use strict";
const { ApiError } = require("../app/errors");
const { wrap } = require("../middleware/asyncHandler");

const STATION_TYPES = [
  { value: "assembly", label: "装配工位", default_skills: ["assembly", "crane", "mechanical"] },
  { value: "welding", label: "焊接工位", default_skills: ["welding", "ndt"] },
  { value: "machining", label: "机加工位", default_skills: ["machining", "cnc"] },
  { value: "inspection", label: "检验工位", default_skills: ["qc", "ndt", "measurement"] },
  { value: "cutting", label: "下料工位", default_skills: ["cutting"] },
  { value: "forming", label: "成型工位", default_skills: ["forming"] },
  { value: "commissioning", label: "调试工位", default_skills: ["commissioning", "hydraulic", "electric"] },
  { value: "warehouse", label: "仓储工位", default_skills: ["warehouse", "forklift"] },
  { value: "general", label: "通用工位", default_skills: [] },
];

function safeJson(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (_error) {
    return String(value)
      .split(/[,\uFF0C;；、]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

function jsonText(value) {
  return JSON.stringify(safeJson(value));
}

function inferStationType(row) {
  const text = `${row.code || ""} ${row.name || ""} ${row.workshop || ""}`.toLowerCase();
  if (/焊|weld/.test(text)) return "welding";
  if (/机加|镗|铣|车|cnc|machining|boring/.test(text)) return "machining";
  if (/检|质|探伤|qc|inspect|ndt|measurement/.test(text)) return "inspection";
  if (/装配|总装|assembly/.test(text)) return "assembly";
  if (/切割|下料|cut/.test(text)) return "cutting";
  if (/折弯|卷制|成型|form/.test(text)) return "forming";
  if (/调试|试压|commission|test/.test(text)) return "commissioning";
  if (/仓|库|warehouse/.test(text)) return "warehouse";
  return "general";
}

function typeLabel(type) {
  return STATION_TYPES.find((item) => item.value === type)?.label || type || "通用工位";
}

function runMigration(db) {
  const columnNames = (table) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((col) => col.name));
  const addColumn = (table, name, ddl) => {
    if (!columnNames(table).has(name)) db.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run();
  };

  for (const col of [
    { name: "workstation_id", def: "workstation_id INTEGER REFERENCES workstations(id)" },
    { name: "availability", def: "availability TEXT DEFAULT 'offline'" },
    { name: "skills", def: "skills TEXT" },
  ]) addColumn("users", col.name, col.def);

  for (const col of [
    { name: "station_type", def: "station_type TEXT DEFAULT 'general'" },
    { name: "status", def: "status TEXT DEFAULT 'available'" },
    { name: "capability_tags", def: "capability_tags TEXT" },
    { name: "required_skills", def: "required_skills TEXT" },
    { name: "max_workers", def: "max_workers INTEGER DEFAULT 1" },
    { name: "location", def: "location TEXT" },
    { name: "shift", def: "shift TEXT DEFAULT 'day'" },
    { name: "notes", def: "notes TEXT" },
  ]) addColumn("workstations", col.name, col.def);

  db.prepare(`
    CREATE TABLE IF NOT EXISTS resource_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      workstation_id INTEGER,
      equipment_instance_id INTEGER,
      assigned_at TEXT DEFAULT (datetime('now')),
      released_at TEXT,
      status TEXT DEFAULT 'active',
      notes TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (workstation_id) REFERENCES workstations(id),
      FOREIGN KEY (equipment_instance_id) REFERENCES equipment_instances(id)
    )
  `).run();
  addColumn("resource_allocations", "work_order_id", "work_order_id INTEGER");

  db.prepare("UPDATE workstations SET station_type = NULL WHERE code LIKE 'WS-SMOKE-%'").run();
  db.prepare("DELETE FROM workstations WHERE code LIKE 'WS-SMOKE-%'").run();

  const rows = db.prepare("SELECT * FROM workstations").all();
  const update = db.prepare("UPDATE workstations SET station_type = ?, status = COALESCE(status, 'available'), max_workers = COALESCE(max_workers, capacity_per_day, 1), required_skills = COALESCE(required_skills, ?), capability_tags = COALESCE(capability_tags, ?), shift = COALESCE(shift, 'day') WHERE id = ?");
  for (const row of rows) {
    const type = row.station_type && row.station_type !== "general" ? row.station_type : inferStationType(row);
    const defaults = STATION_TYPES.find((item) => item.value === type)?.default_skills || [];
    update.run(type, JSON.stringify(defaults), JSON.stringify(defaults), row.id);
  }

  const hasInspection = db.prepare("SELECT id FROM workstations WHERE is_active = 1 AND (station_type = 'inspection' OR name LIKE '%检验%' OR workshop LIKE '%检验%' OR workshop LIKE '%质检%') LIMIT 1").get();
  if (!hasInspection) {
    db.prepare(`
      INSERT INTO workstations (code, name, workshop, capacity_per_day, is_active, station_type, status, capability_tags, required_skills, max_workers, location, shift, notes)
      VALUES ('WS-QC-01', '检验工位 1', '质检', 12, 1, 'inspection', 'available', ?, ?, 3, '质检区', 'day', '补齐标准四类工位：检验/探伤/尺寸测量')
    `).run(JSON.stringify(["qc", "ndt", "measurement"]), JSON.stringify(["qc", "ndt", "measurement"]));
  }

  db.prepare("CREATE INDEX IF NOT EXISTS idx_workstations_station_type ON workstations(station_type)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_workstations_status ON workstations(status)").run();
}

function register(app, db) {
  runMigration(db);

  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const get = (sql, ...p) => db.prepare(sql).get(...p);
  const run = (sql, ...p) => db.prepare(sql).run(...p);

  function decorateWorkstation(ws) {
    const assigned = all(
      "SELECT u.id, u.full_name FROM users u WHERE u.workstation_id = ? AND u.availability IN ('busy','online')",
      ws.id
    );
    const activeOrders = all(
      "SELECT id, wo_code, title, status FROM work_orders WHERE workstation_id = ? AND status IN ('pending','in_progress','paused') ORDER BY priority, id LIMIT 5",
      ws.id
    );
    const equipment = all(
      "SELECT id, code, name, status FROM equipment WHERE workstation_id = ? ORDER BY id",
      ws.id
    );
    const maxWorkers = Number(ws.max_workers || ws.capacity_per_day || 1);
    const utilization = maxWorkers ? Math.min(100, Math.round((assigned.length / maxWorkers) * 100)) : 0;
    return {
      ...ws,
      station_type_label: typeLabel(ws.station_type),
      capability_tags: safeJson(ws.capability_tags),
      required_skills: safeJson(ws.required_skills),
      assigned_workers: assigned,
      assigned_count: assigned.length,
      active_work_orders: activeOrders,
      active_work_order_count: activeOrders.length,
      equipment,
      equipment_count: equipment.length,
      max_workers: maxWorkers,
      utilization,
      available_slots: Math.max(0, maxWorkers - assigned.length),
    };
  }

  app.get("/api/resources/workstation-types", wrap((_req, res) => {
    res.json(STATION_TYPES);
  }));

  app.get("/api/resources/workers", wrap((_req, res) => {
    const workers = all(`
      SELECT u.id, u.full_name, u.role_code, u.availability,
             u.skills, u.cert_type, u.is_active, u.workstation_id,
             w.name AS workstation_name, w.workshop, w.station_type
      FROM users u
      LEFT JOIN workstations w ON u.workstation_id = w.id
      ORDER BY u.id
    `).map((worker) => ({ ...worker, skills: safeJson(worker.skills) }));

    const summary = {
      total: workers.length,
      available: workers.filter((w) => ["idle", "online"].includes(w.availability)).length,
      busy: workers.filter((w) => w.availability === "busy").length,
      offline: workers.filter((w) => !w.availability || w.availability === "offline").length,
      leave: workers.filter((w) => w.availability === "leave").length,
    };

    res.json({ workers, summary });
  }));

  app.put("/api/resources/workers/:id/station", wrap((req, res) => {
    const userId = parseInt(req.params.id, 10);
    const { workstation_id, equipment_instance_id, work_order_id, notes } = req.body || {};
    if (!workstation_id) throw ApiError.validation("workstation_id is required");

    const user = get("SELECT id, availability FROM users WHERE id = ? AND is_active = 1", userId);
    if (!user) throw ApiError.notFound("Worker not found");

    const ws = get("SELECT id, max_workers, capacity_per_day FROM workstations WHERE id = ? AND is_active = 1 AND status != 'disabled'", workstation_id);
    if (!ws) throw ApiError.notFound("Workstation not found or inactive");

    const busy = get("SELECT COUNT(*) c FROM users WHERE workstation_id = ? AND availability = 'busy'", workstation_id).c || 0;
    const maxWorkers = Number(ws.max_workers || ws.capacity_per_day || 1);
    if (busy >= maxWorkers) throw ApiError.validation("工位人员容量已满");

    run("UPDATE resource_allocations SET released_at = datetime('now'), status = 'released' WHERE user_id = ? AND status = 'active'", userId);
    run("UPDATE users SET workstation_id = ?, availability = ? WHERE id = ?", workstation_id, "busy", userId);

    const result = run(
      "INSERT INTO resource_allocations (user_id, workstation_id, equipment_instance_id, work_order_id, status, notes) VALUES (?, ?, ?, ?, ?, ?)",
      userId, workstation_id, equipment_instance_id || null, work_order_id || null, "active", notes || null
    );

    res.json({ ok: true, user_id: userId, workstation_id, allocation_id: result.lastInsertRowid });
  }));

  app.put("/api/resources/workers/:id/release", wrap((req, res) => {
    const userId = parseInt(req.params.id, 10);
    const user = get("SELECT id FROM users WHERE id = ?", userId);
    if (!user) throw ApiError.notFound("Worker not found");

    run("UPDATE resource_allocations SET released_at = datetime('now'), status = 'released' WHERE user_id = ? AND status = 'active'", userId);
    run("UPDATE users SET workstation_id = NULL, availability = ? WHERE id = ?", "idle", userId);
    res.json({ ok: true, user_id: userId });
  }));

  app.put("/api/resources/workers/:id/availability", wrap((req, res) => {
    const userId = parseInt(req.params.id, 10);
    const { availability } = req.body || {};
    const valid = ["idle", "online", "busy", "offline", "leave"];
    if (!availability || !valid.includes(availability)) throw ApiError.validation(`availability must be one of: ${valid.join(", ")}`);
    const user = get("SELECT id FROM users WHERE id = ?", userId);
    if (!user) throw ApiError.notFound("Worker not found");
    run("UPDATE users SET availability = ? WHERE id = ?", availability, userId);
    if (!["busy", "online"].includes(availability)) {
      run("UPDATE resource_allocations SET released_at = datetime('now'), status = 'released' WHERE user_id = ? AND status = 'active'", userId);
      if (availability !== "idle") run("UPDATE users SET workstation_id = NULL WHERE id = ?", userId);
    }
    res.json({ ok: true, user_id: userId, availability });
  }));

  app.get("/api/resources/equipment", wrap((_req, res) => {
    const equipment = all(`
      SELECT ei.id, ei.instance_code, ei.instance_name, ei.status,
             ei.lifecycle_stage, ei.progress_pct, ei.customer_name
      FROM equipment_instances ei
      ORDER BY ei.id
    `);
    const summary = {
      total: equipment.length,
      in_progress: equipment.filter((e) => !["delivered", "operation", "archived", "completed"].includes(e.status)).length,
      completed: equipment.filter((e) => ["delivered", "operation", "completed"].includes(e.status)).length,
      delayed: equipment.filter((e) => e.status === "delayed").length,
    };
    res.json({ equipment, summary });
  }));

  app.get("/api/resources/workstations", wrap((req, res) => {
    const { station_type, status } = req.query;
    let sql = `
      SELECT w.id, w.code, w.name, w.workshop, w.capacity_per_day, w.is_active,
             w.station_type, w.status, w.capability_tags, w.required_skills,
             w.max_workers, w.location, w.shift, w.notes
      FROM workstations w
      WHERE w.is_active = 1
    `;
    const params = [];
    if (station_type) { sql += " AND w.station_type = ?"; params.push(station_type); }
    if (status) { sql += " AND w.status = ?"; params.push(status); }
    sql += " ORDER BY CASE w.station_type WHEN 'assembly' THEN 1 WHEN 'welding' THEN 2 WHEN 'machining' THEN 3 WHEN 'inspection' THEN 4 ELSE 9 END, w.id";
    res.json({ workstations: all(sql, ...params).map(decorateWorkstation) });
  }));

  app.post("/api/resources/workstations", wrap((req, res) => {
    const {
      code, name, workshop, capacity_per_day, is_active, station_type = "general", status = "available",
      capability_tags = [], required_skills = [], max_workers, location, shift = "day", notes,
    } = req.body || {};
    if (!code || !name) throw ApiError.validation("code / name is required");
    if (!STATION_TYPES.some((item) => item.value === station_type)) throw ApiError.validation("station_type is invalid");
    const dup = get("SELECT id FROM workstations WHERE code = ?", code);
    if (dup) throw ApiError.validation("workstation code already exists: " + code);
    const result = run(`
      INSERT INTO workstations (code, name, workshop, capacity_per_day, is_active, station_type, status, capability_tags, required_skills, max_workers, location, shift, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, code, name, workshop || null, Number(capacity_per_day || 1), is_active == null ? 1 : (is_active ? 1 : 0), station_type, status, jsonText(capability_tags), jsonText(required_skills), Number(max_workers || capacity_per_day || 1), location || null, shift, notes || null);
    res.json({ id: result.lastInsertRowid });
  }));

  app.put("/api/resources/workstations/:id", wrap((req, res) => {
    const current = get("SELECT id FROM workstations WHERE id = ?", req.params.id);
    if (!current) throw ApiError.notFound("Workstation not found");
    const allowed = ["name", "workshop", "capacity_per_day", "is_active", "station_type", "status", "capability_tags", "required_skills", "max_workers", "location", "shift", "notes"];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        sets.push(key + " = ?");
        params.push(["capability_tags", "required_skills"].includes(key) ? jsonText(req.body[key]) : req.body[key]);
      }
    }
    if (!sets.length) throw ApiError.validation("no fields to update");
    params.push(req.params.id);
    run("UPDATE workstations SET " + sets.join(", ") + " WHERE id = ?", ...params);
    res.json({ ok: true });
  }));

  app.get("/api/resources/overview", wrap((_req, res) => {
    const workerStats = get(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN availability IN ('idle','online') THEN 1 ELSE 0 END) AS available,
        SUM(CASE WHEN availability = 'busy' THEN 1 ELSE 0 END) AS busy,
        SUM(CASE WHEN availability = 'offline' OR availability IS NULL THEN 1 ELSE 0 END) AS offline,
        SUM(CASE WHEN availability = 'leave' THEN 1 ELSE 0 END) AS leave
      FROM users WHERE is_active = 1
    `);

    const equipStats = get(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status IN ('design','procurement','manufacturing','assembly','commissioning','acceptance') THEN 1 ELSE 0 END) AS running,
        SUM(CASE WHEN status = 'maintenance' THEN 1 ELSE 0 END) AS maintenance,
        SUM(CASE WHEN status IN ('idle','delivered','operation') THEN 1 ELSE 0 END) AS idle
      FROM equipment_instances
    `);

    const wsStats = get(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) AS available,
        SUM(CASE WHEN status IN ('maintenance','blocked') THEN 1 ELSE 0 END) AS blocked
      FROM workstations WHERE is_active = 1
    `);
    const occupied = get("SELECT COUNT(DISTINCT workstation_id) AS cnt FROM users WHERE workstation_id IS NOT NULL AND availability = 'busy'")?.cnt || 0;
    const byType = all(`
      SELECT station_type, COUNT(*) total,
             SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) available
      FROM workstations
      WHERE is_active = 1
      GROUP BY station_type
    `).map((row) => ({ ...row, label: typeLabel(row.station_type) }));

    const alerts = [];
    if ((workerStats.offline || 0) > 0) alerts.push({ type: "warning", message: `${workerStats.offline} 人离线` });
    if ((wsStats.blocked || 0) > 0) alerts.push({ type: "danger", message: `${wsStats.blocked} 个工位维护/阻塞` });
    for (const required of ["assembly", "welding", "machining", "inspection"]) {
      if (!byType.some((row) => row.station_type === required && row.total > 0)) alerts.push({ type: "danger", message: `缺少${typeLabel(required)}` });
    }

    res.json({
      workers: {
        total: workerStats.total || 0,
        available: workerStats.available || 0,
        busy: workerStats.busy || 0,
        offline: workerStats.offline || 0,
        leave: workerStats.leave || 0,
      },
      equipment: {
        total: equipStats.total || 0,
        running: equipStats.running || 0,
        maintenance: equipStats.maintenance || 0,
        idle: equipStats.idle || 0,
      },
      workstations: {
        total: wsStats.total || 0,
        occupied,
        free: Math.max(0, (wsStats.total || 0) - occupied),
        available: wsStats.available || 0,
        blocked: wsStats.blocked || 0,
        by_type: byType,
      },
      alerts,
    });
  }));

  app.post("/api/resources/allocations", wrap((req, res) => {
    const { user_id, workstation_id, equipment_instance_id, work_order_id, notes } = req.body || {};
    if (!user_id) throw ApiError.validation("user_id is required");

    const user = get("SELECT id FROM users WHERE id = ? AND is_active = 1", user_id);
    if (!user) throw ApiError.notFound("User not found or inactive");
    if (workstation_id && !get("SELECT id FROM workstations WHERE id = ? AND is_active = 1", workstation_id)) throw ApiError.notFound("Workstation not found or inactive");
    if (equipment_instance_id && !get("SELECT id FROM equipment_instances WHERE id = ?", equipment_instance_id)) throw ApiError.notFound("Equipment instance not found");

    run("UPDATE resource_allocations SET released_at = datetime('now'), status = 'released' WHERE user_id = ? AND status = 'active'", user_id);
    const result = run(
      "INSERT INTO resource_allocations (user_id, workstation_id, equipment_instance_id, work_order_id, notes, status) VALUES (?, ?, ?, ?, ?, 'active')",
      user_id, workstation_id || null, equipment_instance_id || null, work_order_id || null, notes || null
    );
    const updates = ["availability = ?"];
    const params = ["busy"];
    if (workstation_id) { updates.push("workstation_id = ?"); params.push(workstation_id); }
    params.push(user_id);
    run(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, ...params);
    res.json({ ok: true, allocation_id: result.lastInsertRowid });
  }));

  app.get("/api/resources/allocations", wrap((req, res) => {
    const { status } = req.query;
    let sql = `
      SELECT ra.*, u.full_name AS user_name,
             w.name AS workstation_name, w.station_type,
             ei.instance_name AS equipment_name,
             wo.wo_code, wo.title AS work_order_title
      FROM resource_allocations ra
      LEFT JOIN users u ON ra.user_id = u.id
      LEFT JOIN workstations w ON ra.workstation_id = w.id
      LEFT JOIN equipment_instances ei ON ra.equipment_instance_id = ei.id
      LEFT JOIN work_orders wo ON ra.work_order_id = wo.id
    `;
    const params = [];
    if (status) { sql += " WHERE ra.status = ?"; params.push(status); }
    sql += " ORDER BY ra.assigned_at DESC";
    res.json({ allocations: all(sql, ...params) });
  }));

  console.log("[resourceService] Resource management registered");
}

module.exports = { register };
