"use strict";
// services/laborService.js
// MESA #6: Worker management - certificates, skills, training, assignments
const { ApiError } = require("../app/errors");
const { wrap } = require("../middleware/asyncHandler");

function runMigration(db) {
  db.exec("CREATE TABLE IF NOT EXISTS worker_certificates (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, cert_type TEXT NOT NULL, cert_name TEXT NOT NULL, cert_number TEXT, issuing_authority TEXT, issued_date TEXT, expiry_date TEXT, cert_level TEXT, attachment_path TEXT, status TEXT NOT NULL DEFAULT 'valid', notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (user_id) REFERENCES users(id))");
  db.exec("CREATE INDEX IF NOT EXISTS idx_worker_certs_user ON worker_certificates(user_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_worker_certs_expiry ON worker_certificates(expiry_date, status)");
  db.exec("CREATE TABLE IF NOT EXISTS worker_skills (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, skill_name TEXT NOT NULL, skill_category TEXT NOT NULL DEFAULT 'general', proficiency_level INTEGER NOT NULL DEFAULT 1 CHECK(proficiency_level BETWEEN 1 AND 5), years_experience REAL DEFAULT 0, certified INTEGER NOT NULL DEFAULT 0, last_used_at TEXT, notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (user_id) REFERENCES users(id), UNIQUE(user_id, skill_name))");
  db.exec("CREATE INDEX IF NOT EXISTS idx_worker_skills_user ON worker_skills(user_id)");
  db.exec("CREATE TABLE IF NOT EXISTS worker_training (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, training_name TEXT NOT NULL, training_type TEXT NOT NULL DEFAULT 'internal', provider TEXT, start_date TEXT, end_date TEXT, duration_hours REAL, score REAL, passed INTEGER NOT NULL DEFAULT 0, certificate_issued INTEGER NOT NULL DEFAULT 0, notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (user_id) REFERENCES users(id))");
  db.exec("CREATE INDEX IF NOT EXISTS idx_worker_training_user ON worker_training(user_id)");
}

function makeHelpers(db) {
  return {
    all: (sql, p) => db.prepare(sql).all(...(p || [])),
    get: (sql, p) => db.prepare(sql).get(...(p || [])),
    run: (sql, p) => db.prepare(sql).run(...(p || [])),
  };
}

function checkCertExpiry(db) {
  const { run } = makeHelpers(db);
  const r = run("UPDATE worker_certificates SET status = 'expired', updated_at = datetime('now') WHERE status = 'valid' AND expiry_date IS NOT NULL AND expiry_date < date('now')");
  return r.changes;
}

// Certificates CRUD
function registerCertificates(app, db) {
  const { all, get, run } = makeHelpers(db);
  app.get("/api/labor/certificates", wrap((req, res) => {
    const { user_id, cert_type, status, expiring_soon } = req.query;
    let sql = "SELECT c.*, u.full_name, u.username FROM worker_certificates c JOIN users u ON c.user_id = u.id WHERE 1=1";
    const p = [];
    if (user_id) { sql += " AND c.user_id = ?"; p.push(user_id); }
    if (cert_type) { sql += " AND c.cert_type = ?"; p.push(cert_type); }
    if (status) { sql += " AND c.status = ?"; p.push(status); }
    if (expiring_soon === "1") { sql += " AND c.expiry_date IS NOT NULL AND c.status = 'valid' AND c.expiry_date <= date('now', '+30 days')"; }
    sql += " ORDER BY c.expiry_date ASC NULLS LAST";
    res.json(all(sql, p));
  }));
  app.post("/api/labor/certificates", wrap((req, res) => {
    const { user_id, cert_type, cert_name, cert_number, issuing_authority, issued_date, expiry_date, cert_level, notes } = req.body;
    if (!user_id || !cert_type || !cert_name) throw ApiError.validation("user_id, cert_type, cert_name required");
    const r = run("INSERT INTO worker_certificates (user_id, cert_type, cert_name, cert_number, issuing_authority, issued_date, expiry_date, cert_level, notes) VALUES (?,?,?,?,?,?,?,?,?)", [user_id, cert_type, cert_name, cert_number || null, issuing_authority || null, issued_date || null, expiry_date || null, cert_level || null, notes || null]);
    run("UPDATE users SET cert_no = COALESCE(cert_no, ?), cert_type = COALESCE(cert_type, ?) WHERE id = ?", [cert_number, cert_type, user_id]);
    res.json({ id: r.lastInsertRowid });
  }));
  app.put("/api/labor/certificates/:id", wrap((req, res) => {
    const { cert_name, cert_number, expiry_date, cert_level, status, notes } = req.body;
    const exist = get("SELECT id FROM worker_certificates WHERE id = ?", [req.params.id]);
    if (!exist) throw ApiError.notFound("Certificate not found");
    run("UPDATE worker_certificates SET cert_name=COALESCE(?,cert_name), cert_number=COALESCE(?,cert_number), expiry_date=COALESCE(?,expiry_date), cert_level=COALESCE(?,cert_level), status=COALESCE(?,status), notes=COALESCE(?,notes), updated_at=datetime('now') WHERE id=?", [cert_name || null, cert_number || null, expiry_date || null, cert_level || null, status || null, notes || null, req.params.id]);
    res.json({ success: true });
  }));
  app.delete("/api/labor/certificates/:id", wrap((req, res) => {
    run("DELETE FROM worker_certificates WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  }));
}

// Skills matrix
function registerSkills(app, db) {
  const { all, get, run } = makeHelpers(db);
  app.get("/api/labor/skills", wrap((req, res) => {
    const { user_id, skill_category } = req.query;
    let sql = "SELECT s.*, u.full_name, u.username FROM worker_skills s JOIN users u ON s.user_id = u.id WHERE 1=1";
    const p = [];
    if (user_id) { sql += " AND s.user_id = ?"; p.push(user_id); }
    if (skill_category) { sql += " AND s.skill_category = ?"; p.push(skill_category); }
    sql += " ORDER BY s.skill_category, s.proficiency_level DESC";
    res.json(all(sql, p));
  }));
  app.post("/api/labor/skills", wrap((req, res) => {
    const { user_id, skill_name, skill_category, proficiency_level, years_experience, certified, notes } = req.body;
    if (!user_id || !skill_name) throw ApiError.validation("user_id, skill_name required");
    const r = run("INSERT OR REPLACE INTO worker_skills (user_id, skill_name, skill_category, proficiency_level, years_experience, certified, notes) VALUES (?,?,?,?,?,?,?)", [user_id, skill_name, skill_category || "general", proficiency_level || 1, years_experience || 0, certified ? 1 : 0, notes || null]);
    res.json({ id: r.lastInsertRowid });
  }));
  app.delete("/api/labor/skills/:id", wrap((req, res) => {
    run("DELETE FROM worker_skills WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  }));
}

// Training records
function registerTraining(app, db) {
  const { all, get, run } = makeHelpers(db);
  app.get("/api/labor/training", wrap((req, res) => {
    const { user_id } = req.query;
    let sql = "SELECT t.*, u.full_name FROM worker_training t JOIN users u ON t.user_id = u.id WHERE 1=1";
    const p = [];
    if (user_id) { sql += " AND t.user_id = ?"; p.push(user_id); }
    sql += " ORDER BY t.start_date DESC LIMIT 200";
    res.json(all(sql, p));
  }));
  app.post("/api/labor/training", wrap((req, res) => {
    const { user_id, training_name, training_type, provider, start_date, end_date, duration_hours, score, passed, notes } = req.body;
    if (!user_id || !training_name) throw ApiError.validation("user_id, training_name required");
    const r = run("INSERT INTO worker_training (user_id, training_name, training_type, provider, start_date, end_date, duration_hours, score, passed, notes) VALUES (?,?,?,?,?,?,?,?,?,?)", [user_id, training_name, training_type || "internal", provider || null, start_date || null, end_date || null, duration_hours || null, score || null, passed ? 1 : 0, notes || null]);
    res.json({ id: r.lastInsertRowid });
  }));
}

// Assignment validation
function registerAssignmentValidation(app, db) {
  const { all, get } = makeHelpers(db);
  const certRequired = { welding: "welding", ndt: "ndt", safety: "safety", electrical: "electrical", machining: "machining" };
  app.post("/api/labor/validate-assignment", wrap((req, res) => {
    const { user_id, work_type } = req.body;
    if (!user_id || !work_type) throw ApiError.validation("user_id, work_type required");
    const requiredCert = certRequired[work_type] || null;
    const user = get("SELECT id, full_name, cert_no, cert_type FROM users WHERE id = ?", [user_id]);
    if (!user) throw ApiError.notFound("Worker not found");
    let validCerts = [];
    if (requiredCert) {
      validCerts = all("SELECT * FROM worker_certificates WHERE user_id = ? AND cert_type = ? AND status = 'valid' AND (expiry_date IS NULL OR expiry_date >= date('now'))", [user_id, requiredCert]);
    }
    const skills = all("SELECT skill_name FROM worker_skills WHERE user_id = ? AND proficiency_level >= 3", [user_id]);
    res.json({ user_id, full_name: user.full_name, work_type, required_cert: requiredCert, has_valid_cert: validCerts.length > 0, valid_certs: validCerts, skills: skills.map(s => s.skill_name), can_dispatch: requiredCert ? validCerts.length > 0 : true, reason: requiredCert && validCerts.length === 0 ? user.full_name + " missing valid " + requiredCert + " cert" : null });
  }));
}

// Dashboard
function registerDashboard(app, db) {
  const { all, get } = makeHelpers(db);
  app.get("/api/labor/dashboard", wrap((req, res) => {
    checkCertExpiry(db);
    const workers = all("SELECT u.id, u.full_name, u.role_code, u.availability, u.workstation_id, u.skills, ws.name AS workstation_name FROM users u LEFT JOIN workstations ws ON u.workstation_id = ws.id WHERE u.is_active = 1");
    const expiringCerts = all("SELECT c.*, u.full_name FROM worker_certificates c JOIN users u ON c.user_id = u.id WHERE c.status = 'valid' AND c.expiry_date IS NOT NULL AND c.expiry_date <= date('now', '+30 days') ORDER BY c.expiry_date ASC");
    const skillStats = all("SELECT skill_category, COUNT(*) AS cnt, ROUND(AVG(proficiency_level),1) AS avg_level FROM worker_skills GROUP BY skill_category ORDER BY cnt DESC");
    const topWorkers = all("SELECT u.id, u.full_name, COUNT(wrd.id) AS report_count, ROUND(SUM(wrd.hours_spent),1) AS total_hours FROM users u JOIN work_report_details wrd ON u.id = wrd.worker_id WHERE wrd.reported_at >= datetime('now', '-30 days') GROUP BY u.id ORDER BY total_hours DESC LIMIT 5");
    const trainingStats = get("SELECT COUNT(*) AS total, SUM(CASE WHEN passed=1 THEN 1 ELSE 0 END) AS passed FROM worker_training");
    res.json({ workers, expiring_certs: expiringCerts, skill_stats: skillStats, top_workers: topWorkers, training: { total: trainingStats.total, passed: trainingStats.passed, rate: trainingStats.total > 0 ? Math.round(trainingStats.passed * 100 / trainingStats.total) : 0 } });
  }));
}

function register(app, db) {
  runMigration(db);
  registerCertificates(app, db);
  registerSkills(app, db);
  registerTraining(app, db);
  registerAssignmentValidation(app, db);
  checkCertExpiry(db);
  registerDashboard(app, db);
  console.log("[laborService] Labor management registered");
}

module.exports = { register, runMigration };
