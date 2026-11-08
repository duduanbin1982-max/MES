"use strict";
// services/laborService.js
// MESA #6: Worker management - certificates, skills, training, assignments
// 2026-11-08（人员资质审计）：补 schema 列、输入校验、证书/技能/培训审计与用户证书摘要同步。
const { ApiError } = require("../app/errors");
const { wrap } = require("../middleware/asyncHandler");
const audit = require("../app/audit");

const logger = require("../app/logger").createLogger("laborService");

const CERT_STATUSES = ["valid", "expired", "revoked", "suspended"];
const TRAINING_TYPES = ["internal", "external"];

function runMigration(db) {
  db.exec("CREATE TABLE IF NOT EXISTS worker_certificates (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, cert_type TEXT NOT NULL, cert_name TEXT NOT NULL, cert_number TEXT, issuing_authority TEXT, issued_date TEXT, expiry_date TEXT, cert_level TEXT, status TEXT NOT NULL DEFAULT 'valid', attachment_path TEXT, notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (user_id) REFERENCES users(id))");
  db.exec("CREATE INDEX IF NOT EXISTS idx_worker_certs_user ON worker_certificates(user_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_worker_certs_expiry ON worker_certificates(expiry_date, status)");
  db.exec("CREATE TABLE IF NOT EXISTS worker_skills (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, skill_name TEXT NOT NULL, skill_category TEXT NOT NULL DEFAULT 'general', proficiency_level INTEGER NOT NULL DEFAULT 1 CHECK(proficiency_level BETWEEN 1 AND 5), years_experience REAL DEFAULT 0, certified INTEGER NOT NULL DEFAULT 0, last_used_at TEXT, notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (user_id) REFERENCES users(id), UNIQUE(user_id, skill_name))");
  db.exec("CREATE INDEX IF NOT EXISTS idx_worker_skills_user ON worker_skills(user_id)");
  db.exec("CREATE TABLE IF NOT EXISTS worker_training (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, training_name TEXT NOT NULL, training_type TEXT NOT NULL DEFAULT 'internal', provider TEXT, start_date TEXT, end_date TEXT, duration_hours REAL, score REAL, passed INTEGER NOT NULL DEFAULT 0, certificate_issued INTEGER NOT NULL DEFAULT 0, notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (user_id) REFERENCES users(id))");
  db.exec("CREATE INDEX IF NOT EXISTS idx_worker_training_user ON worker_training(user_id)");

  // 兼容旧库：CREATE TABLE IF NOT EXISTS 不会给已有表补列
  const addColumn = (table, name, ddl) => {
    try {
      const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
      if (!columns.has(name)) db.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run();
    } catch (_error) { /* 表不存在时忽略 */ }
  };
  addColumn("worker_certificates", "attachment_path", "attachment_path TEXT");
  addColumn("worker_training", "certificate_issued", "certificate_issued INTEGER NOT NULL DEFAULT 0");
}

function makeHelpers(db) {
  return {
    all: (sql, p) => db.prepare(sql).all(...(p || [])),
    get: (sql, p) => db.prepare(sql).get(...(p || [])),
    run: (sql, p) => db.prepare(sql).run(...(p || [])),
  };
}

function text(value, field, { required = false, max = 200 } = {}) {
  if (value === undefined || value === null) {
    if (required) throw ApiError.validation(`${field} 必填`);
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    if (required) throw ApiError.validation(`${field} 必填`);
    return null;
  }
  if (normalized.length > max) throw ApiError.validation(`${field} 长度不能超过 ${max}`);
  return normalized;
}

function positiveInt(value, field) {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) throw ApiError.validation(`${field} 必须是正整数`);
  return num;
}

function boolInt(value, fallback = 0) {
  if (value === undefined) return fallback;
  return value === true || value === 1 || value === "1" || value === "true" ? 1 : 0;
}

function dateText(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const textValue = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(textValue)) throw ApiError.validation(`${field} 必须是 YYYY-MM-DD`);
  const date = new Date(`${textValue}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw ApiError.validation(`${field} 日期非法`);
  return textValue;
}

function assertUser(db, userId, { active = true } = {}) {
  const user = db.prepare("SELECT id, full_name, is_active FROM users WHERE id = ?").get(Number(userId));
  if (!user) throw ApiError.notFound("人员不存在");
  if (active && Number(user.is_active) !== 1) throw ApiError.validation("人员已停用");
  return user;
}

function assertDateOrder(issuedDate, expiryDate) {
  if (issuedDate && expiryDate && issuedDate > expiryDate) throw ApiError.validation("发证日期不能晚于到期日期");
}

function assertCertStatus(value) {
  const status = text(value, "status", { max: 20 }) || "valid";
  if (!CERT_STATUSES.includes(status)) throw ApiError.validation(`status 必须是 ${CERT_STATUSES.join(" / ")}`);
  return status;
}

/** 同步 users.cert_no/cert_type 为最近一张有效证书（兼容旧字段） */
function syncUserCertSummary(db, userId) {
  try {
    const cert = db.prepare(`
      SELECT cert_number, cert_type FROM worker_certificates
      WHERE user_id = ? AND status = 'valid' AND (expiry_date IS NULL OR expiry_date >= date('now'))
      ORDER BY (expiry_date IS NULL) DESC, expiry_date DESC, id DESC LIMIT 1
    `).get(userId);
    db.prepare("UPDATE users SET cert_no = ?, cert_type = ? WHERE id = ?").run(cert ? cert.cert_number : null, cert ? cert.cert_type : null, userId);
  } catch (_error) { /* 兼容缺列 */ }
}

function syncAllCertSummaries(db) {
  try {
    const users = db.prepare("SELECT DISTINCT user_id FROM worker_certificates").all();
    for (const row of users) syncUserCertSummary(db, row.user_id);
  } catch (_error) { /* 兼容缺表/列 */ }
}

function checkCertExpiry(db) {
  const { run } = makeHelpers(db);
  const result = run("UPDATE worker_certificates SET status = 'expired', updated_at = datetime('now') WHERE status = 'valid' AND expiry_date IS NOT NULL AND expiry_date < date('now')");
  if (result.changes) syncAllCertSummaries(db);
  return result.changes;
}

function normalizeCertificate(body, { partial = false, current = null } = {}) {
  const source = body || {};
  const has = (field) => Object.prototype.hasOwnProperty.call(source, field);
  const payload = {};
  if (!partial || has("user_id")) {
    const userId = positiveInt(source.user_id, "user_id");
    payload.user_id = userId;
  }
  if (!partial || has("cert_type")) payload.cert_type = text(source.cert_type, "cert_type", { max: 50, required: true });
  if (!partial || has("cert_name")) payload.cert_name = text(source.cert_name, "cert_name", { max: 150, required: true });
  if (!partial || has("cert_number")) payload.cert_number = text(source.cert_number, "cert_number", { max: 100 });
  if (!partial || has("issuing_authority")) payload.issuing_authority = text(source.issuing_authority, "issuing_authority", { max: 150 });
  if (!partial || has("issued_date")) payload.issued_date = dateText(source.issued_date, "issued_date");
  if (!partial || has("expiry_date")) payload.expiry_date = dateText(source.expiry_date, "expiry_date");
  if (!partial || has("cert_level")) payload.cert_level = text(source.cert_level, "cert_level", { max: 50 });
  if (!partial || has("status")) payload.status = assertCertStatus(source.status);
  if (!partial || has("notes")) payload.notes = text(source.notes, "notes", { max: 1000 });
  if (!partial || has("attachment_path")) payload.attachment_path = text(source.attachment_path, "attachment_path", { max: 500 });
  const issuedDate = payload.issued_date !== undefined ? payload.issued_date : current?.issued_date;
  const expiryDate = payload.expiry_date !== undefined ? payload.expiry_date : current?.expiry_date;
  assertDateOrder(issuedDate, expiryDate);
  return payload;
}

function normalizeSkill(body) {
  const source = body || {};
  const userId = positiveInt(source.user_id, "user_id");
  const skillName = text(source.skill_name, "skill_name", { max: 100, required: true });
  const skillCategory = text(source.skill_category, "skill_category", { max: 50 }) || "general";
  const level = Number(source.proficiency_level === undefined ? 1 : source.proficiency_level);
  if (!Number.isInteger(level) || level < 1 || level > 5) throw ApiError.validation("proficiency_level 需为 1~5 的整数");
  const years = source.years_experience === undefined || source.years_experience === null || source.years_experience === "" ? 0 : Number(source.years_experience);
  if (!Number.isFinite(years) || years < 0 || years > 60) throw ApiError.validation("years_experience 需在 0~60");
  return {
    user_id: userId, skill_name: skillName, skill_category: skillCategory,
    proficiency_level: level, years_experience: years, certified: boolInt(source.certified),
    notes: text(source.notes, "notes", { max: 1000 }),
  };
}

function normalizeTraining(body) {
  const source = body || {};
  const userId = positiveInt(source.user_id, "user_id");
  const trainingName = text(source.training_name, "training_name", { max: 150, required: true });
  const trainingType = text(source.training_type, "training_type", { max: 20 }) || "internal";
  if (!TRAINING_TYPES.includes(trainingType)) throw ApiError.validation("training_type 必须是 internal / external");
  const startDate = dateText(source.start_date, "start_date");
  const endDate = dateText(source.end_date, "end_date");
  if (startDate && endDate && startDate > endDate) throw ApiError.validation("开始日期不能晚于结束日期");
  let duration = null;
  if (source.duration_hours !== undefined && source.duration_hours !== null && source.duration_hours !== "") {
    duration = Number(source.duration_hours);
    if (!Number.isFinite(duration) || duration < 0 || duration > 10000) throw ApiError.validation("duration_hours 需在 0~10000");
  }
  let score = null;
  if (source.score !== undefined && source.score !== null && source.score !== "") {
    score = Number(source.score);
    if (!Number.isFinite(score) || score < 0 || score > 100) throw ApiError.validation("score 需在 0~100");
  }
  return {
    user_id: userId, training_name: trainingName, training_type: trainingType,
    provider: text(source.provider, "provider", { max: 150 }), start_date: startDate, end_date: endDate,
    duration_hours: duration, score, passed: boolInt(source.passed), certificate_issued: boolInt(source.certificate_issued),
    notes: text(source.notes, "notes", { max: 1000 }),
  };
}

// Certificates CRUD
function registerCertificates(app, db) {
  const { all, get, run } = makeHelpers(db);
  app.get("/api/labor/certificates", wrap((req, res) => {
    checkCertExpiry(db);
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
    const payload = normalizeCertificate(req.body || {});
    assertUser(db, payload.user_id);
    if (payload.cert_number) {
      const duplicate = get("SELECT id FROM worker_certificates WHERE user_id = ? AND cert_number = ?", [payload.user_id, payload.cert_number]);
      if (duplicate) throw ApiError.conflict(`该人员证书编号已存在（id=${duplicate.id}）`);
    }
    const r = run("INSERT INTO worker_certificates (user_id, cert_type, cert_name, cert_number, issuing_authority, issued_date, expiry_date, cert_level, status, attachment_path, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [payload.user_id, payload.cert_type, payload.cert_name, payload.cert_number, payload.issuing_authority, payload.issued_date, payload.expiry_date, payload.cert_level, payload.status || "valid", payload.attachment_path, payload.notes]);
    syncUserCertSummary(db, payload.user_id);
    audit.record(db, req, { action: "labor.certificate.create", resource_type: "worker_certificate", resource_id: r.lastInsertRowid, after: payload, diff_summary: `新增证书 ${payload.cert_name}` });
    res.status(201).json({ id: r.lastInsertRowid });
  }));

  app.put("/api/labor/certificates/:id", wrap((req, res) => {
    const current = get("SELECT * FROM worker_certificates WHERE id = ?", [req.params.id]);
    if (!current) throw ApiError.notFound("Certificate not found");
    const payload = normalizeCertificate(req.body || {}, { partial: true, current });
    if (payload.user_id) assertUser(db, payload.user_id);
    const entries = Object.entries(payload);
    if (!entries.length) throw ApiError.validation("无可更新字段");
    run(`UPDATE worker_certificates SET ${entries.map(([key]) => `${key} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`, [...entries.map(([, value]) => value), current.id]);
    syncUserCertSummary(db, payload.user_id || current.user_id);
    audit.record(db, req, { action: "labor.certificate.update", resource_type: "worker_certificate", resource_id: current.id, before: current, after: payload, diff_summary: `更新证书 ${current.cert_name}` });
    res.json({ success: true });
  }));

  app.delete("/api/labor/certificates/:id", wrap((req, res) => {
    const current = get("SELECT * FROM worker_certificates WHERE id = ?", [req.params.id]);
    if (!current) throw ApiError.notFound("Certificate not found");
    run("DELETE FROM worker_certificates WHERE id = ?", [current.id]);
    syncUserCertSummary(db, current.user_id);
    audit.record(db, req, { action: "labor.certificate.delete", resource_type: "worker_certificate", resource_id: current.id, before: current, diff_summary: `删除证书 ${current.cert_name}` });
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
    const payload = normalizeSkill(req.body || {});
    assertUser(db, payload.user_id);
    const existing = get("SELECT id FROM worker_skills WHERE user_id = ? AND skill_name = ?", [payload.user_id, payload.skill_name]);
    let id;
    if (existing) {
      run("UPDATE worker_skills SET skill_category = ?, proficiency_level = ?, years_experience = ?, certified = ?, notes = ? WHERE id = ?",
        [payload.skill_category, payload.proficiency_level, payload.years_experience, payload.certified, payload.notes, existing.id]);
      id = existing.id;
    } else {
      const r = run("INSERT INTO worker_skills (user_id, skill_name, skill_category, proficiency_level, years_experience, certified, notes) VALUES (?,?,?,?,?,?,?)",
        [payload.user_id, payload.skill_name, payload.skill_category, payload.proficiency_level, payload.years_experience, payload.certified, payload.notes]);
      id = r.lastInsertRowid;
    }
    audit.record(db, req, { action: "labor.skill.upsert", resource_type: "worker_skill", resource_id: id, after: payload, diff_summary: `更新技能 ${payload.skill_name}` });
    res.json({ id });
  }));

  app.delete("/api/labor/skills/:id", wrap((req, res) => {
    const current = get("SELECT * FROM worker_skills WHERE id = ?", [req.params.id]);
    if (!current) throw ApiError.notFound("Skill not found");
    run("DELETE FROM worker_skills WHERE id = ?", [current.id]);
    audit.record(db, req, { action: "labor.skill.delete", resource_type: "worker_skill", resource_id: current.id, before: current, diff_summary: `删除技能 ${current.skill_name}` });
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
    const payload = normalizeTraining(req.body || {});
    assertUser(db, payload.user_id);
    const r = run("INSERT INTO worker_training (user_id, training_name, training_type, provider, start_date, end_date, duration_hours, score, passed, certificate_issued, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [payload.user_id, payload.training_name, payload.training_type, payload.provider, payload.start_date, payload.end_date, payload.duration_hours, payload.score, payload.passed, payload.certificate_issued, payload.notes]);
    audit.record(db, req, { action: "labor.training.create", resource_type: "worker_training", resource_id: r.lastInsertRowid, after: payload, diff_summary: `新增培训 ${payload.training_name}` });
    res.status(201).json({ id: r.lastInsertRowid });
  }));

  app.put("/api/labor/training/:id", wrap((req, res) => {
    const current = get("SELECT * FROM worker_training WHERE id = ?", [req.params.id]);
    if (!current) throw ApiError.notFound("Training not found");
    const merged = { ...current, ...(req.body || {}) };
    const payload = normalizeTraining(merged);
    run("UPDATE worker_training SET user_id=?, training_name=?, training_type=?, provider=?, start_date=?, end_date=?, duration_hours=?, score=?, passed=?, certificate_issued=?, notes=? WHERE id=?",
      [payload.user_id, payload.training_name, payload.training_type, payload.provider, payload.start_date, payload.end_date, payload.duration_hours, payload.score, payload.passed, payload.certificate_issued, payload.notes, current.id]);
    audit.record(db, req, { action: "labor.training.update", resource_type: "worker_training", resource_id: current.id, before: current, after: payload, diff_summary: `更新培训 ${current.training_name}` });
    res.json({ success: true });
  }));

  app.delete("/api/labor/training/:id", wrap((req, res) => {
    const current = get("SELECT * FROM worker_training WHERE id = ?", [req.params.id]);
    if (!current) throw ApiError.notFound("Training not found");
    run("DELETE FROM worker_training WHERE id = ?", [current.id]);
    audit.record(db, req, { action: "labor.training.delete", resource_type: "worker_training", resource_id: current.id, before: current, diff_summary: `删除培训 ${current.training_name}` });
    res.json({ success: true });
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
  app.get("/api/labor/dashboard", wrap((_req, res) => {
    checkCertExpiry(db);
    const workers = all("SELECT u.id, u.full_name, u.role_code, u.availability, u.workstation_id, u.skills, ws.name AS workstation_name FROM users u LEFT JOIN workstations ws ON u.workstation_id = ws.id WHERE u.is_active = 1");
    const expiringCerts = all("SELECT c.*, u.full_name FROM worker_certificates c JOIN users u ON c.user_id = u.id WHERE c.status = 'valid' AND c.expiry_date IS NOT NULL AND c.expiry_date <= date('now', '+30 days') ORDER BY c.expiry_date ASC");
    const skillStats = all("SELECT skill_category, COUNT(*) AS cnt, ROUND(AVG(proficiency_level),1) AS avg_level FROM worker_skills GROUP BY skill_category ORDER BY cnt DESC");
    let topWorkers;
    try {
      topWorkers = all("SELECT u.id, u.full_name, COUNT(wrd.id) AS report_count, ROUND(SUM(wrd.hours_spent),1) AS total_hours FROM users u JOIN work_report_details wrd ON u.id = wrd.worker_id WHERE wrd.reported_at >= datetime('now', '-30 days') GROUP BY u.id ORDER BY total_hours DESC LIMIT 5");
    } catch (_error) { topWorkers = []; }
    const trainingStats = get("SELECT COUNT(*) AS total, SUM(CASE WHEN passed=1 THEN 1 ELSE 0 END) AS passed, SUM(CASE WHEN certificate_issued=1 THEN 1 ELSE 0 END) AS certificates FROM worker_training");
    res.json({
      workers, expiring_certs: expiringCerts, skill_stats: skillStats, top_workers: topWorkers,
      training: { total: trainingStats.total, passed: trainingStats.passed, certificates: trainingStats.certificates, rate: trainingStats.total > 0 ? Math.round(trainingStats.passed * 100 / trainingStats.total) : 0 },
    });
  }));
}

function register(app, db) {
  runMigration(db);
  registerCertificates(app, db);
  registerSkills(app, db);
  registerTraining(app, db);
  registerAssignmentValidation(app, db);
  checkCertExpiry(db);
  syncAllCertSummaries(db);
  registerDashboard(app, db);
  logger.info("[laborService] Labor management registered");
}

module.exports = { register, runMigration };
