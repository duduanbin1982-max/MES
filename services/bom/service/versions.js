"use strict";
// 2026-11-07（BOM 审计 B-8）：版本发布 / ECO 流程 / 生效期校验
const { ApiError } = require("../../../app/errors");
const { VERSION_RE } = require("../core/constants");
const { validateTree, computeHealth } = require("../core");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function ensureTable(db) {
  db.prepare(`CREATE TABLE IF NOT EXISTS bom_version_releases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    equipment_instance_id INTEGER NOT NULL,
    version TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'released',
    eco_id INTEGER,
    effective_from TEXT,
    effective_to TEXT,
    row_count INTEGER DEFAULT 0,
    snapshot_json TEXT NOT NULL,
    notes TEXT,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    released_at TEXT,
    obsolete_at TEXT,
    UNIQUE(equipment_instance_id, version)
  )`).run();
  // 2026-11-07（EBOM/MBOM）：版本表类型与基线字段（兼容已存在旧表）
  const columns = new Set(db.prepare("PRAGMA table_info(bom_version_releases)").all().map((column) => column.name));
  if (!columns.has("bom_type")) db.prepare("ALTER TABLE bom_version_releases ADD COLUMN bom_type TEXT DEFAULT 'EBOM'").run();
  if (!columns.has("baseline_type")) db.prepare("ALTER TABLE bom_version_releases ADD COLUMN baseline_type TEXT").run();
}

function normalizeDate(value, label) {
  if (!value) return null;
  const text = String(value).trim();
  if (!DATE_RE.test(text)) throw ApiError.validation(label + " 格式必须是 YYYY-MM-DD");
  return text;
}

function listReleases(db, instanceId) {
  ensureTable(db);
  return db.prepare(`
    SELECT id, equipment_instance_id, version, status, eco_id, effective_from, effective_to,
           row_count, notes, created_by, created_at, released_at, obsolete_at
    FROM bom_version_releases WHERE equipment_instance_id = ? ORDER BY id DESC
  `).all(instanceId);
}

function getRelease(db, instanceId, releaseId) {
  ensureTable(db);
  const row = db.prepare("SELECT * FROM bom_version_releases WHERE id = ? AND equipment_instance_id = ?").get(releaseId, instanceId);
  if (!row) throw ApiError.notFound("BOM 版本不存在: " + releaseId);
  let snapshot;
  try { snapshot = JSON.parse(row.snapshot_json || "[]"); } catch (_error) { snapshot = []; }
  return { ...row, snapshot };
}

function createRelease(db, instanceId, body = {}, userId = null, user = null) {
  ensureTable(db);
  const version = String(body.version || "").trim();
  if (!VERSION_RE.test(version)) throw ApiError.validation("version 格式必须形如 A0/A1/B0");
  const effectiveFrom = normalizeDate(body.effective_from, "effective_from");
  const effectiveTo = normalizeDate(body.effective_to, "effective_to");
  if (effectiveFrom && effectiveTo && effectiveFrom > effectiveTo) throw ApiError.validation("effective_from 不能晚于 effective_to");
  let ecoId = null;
  if (body.eco_id !== undefined && body.eco_id !== null && body.eco_id !== "") {
    ecoId = Number(body.eco_id);
    if (!Number.isInteger(ecoId) || ecoId <= 0) throw ApiError.validation("eco_id 必须是正整数");
  }
  const bomType = String(body.bom_type || "EBOM").toUpperCase();
  if (!["EBOM", "MBOM"].includes(bomType)) throw ApiError.validation("bom_type 必须是 EBOM 或 MBOM");
  const baselineType = body.baseline_type ? String(body.baseline_type).trim() : null;
  if (baselineType && !["contract", "design", "manufacturing", "other"].includes(baselineType)) {
    throw ApiError.validation("baseline_type 必须是 contract/design/manufacturing/other");
  }
  let rows;
  try {
    rows = db.prepare("SELECT * FROM instance_bom WHERE equipment_instance_id = ? AND COALESCE(bom_type,'EBOM') = ? ORDER BY tier, id").all(instanceId, bomType);
  } catch (_error) {
    rows = db.prepare("SELECT * FROM instance_bom WHERE equipment_instance_id = ? ORDER BY tier, id").all(instanceId);
  }
  if (!rows.length) throw ApiError.validation(`当前项目没有 ${bomType} BOM，不能发布版本`);
  const validation = validateTree(db, instanceId, rows);
  if (!validation.ok) {
    throw ApiError.validation("BOM 结构校验未通过，不能发布版本", { errors: validation.errors.slice(0, 20) });
  }
  const health = computeHealth(db, instanceId, rows);
  const minScore = Number(process.env.BOM_RELEASE_MIN_SCORE || 70);
  const canForce = Boolean(body.force) && (user?.role === "admin" || (user?.permissions || []).includes("*"));
  if (health.score < minScore && !canForce) {
    throw ApiError.validation(`BOM 健康分 ${health.score} 低于发布门槛 ${minScore}，请先修复健康问题`, {
      score: health.score, min_score: minScore, grade: health.grade,
      blockers: health.release_gate?.blockers || [],
      issues: (health.issues || []).filter((issue) => issue.severity === "error" || issue.severity === "warning").slice(0, 20),
    });
  }
  const existing = db.prepare("SELECT id FROM bom_version_releases WHERE equipment_instance_id = ? AND version = ?").get(instanceId, version);
  if (existing) throw ApiError.conflict("版本已存在: " + version);
  const result = db.prepare(`
    INSERT INTO bom_version_releases (equipment_instance_id, version, status, eco_id, effective_from, effective_to, row_count, snapshot_json, notes, created_by, released_at, bom_type, baseline_type)
    VALUES (?, ?, 'released', ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?)
  `).run(instanceId, version, ecoId, effectiveFrom, effectiveTo, rows.length, JSON.stringify(rows),
    body.notes || (canForce && health.score < minScore ? `强制发布（健康分 ${health.score}）` : null), userId, bomType, baselineType);
  const release = getRelease(db, instanceId, Number(result.lastInsertRowid));
  release.health_score = health.score;
  release.health_grade = health.grade;
  release.forced = Boolean(canForce && health.score < minScore);
  return release;
}

function obsoleteRelease(db, instanceId, releaseId, userId = null) {
  ensureTable(db);
  const row = db.prepare("SELECT * FROM bom_version_releases WHERE id = ? AND equipment_instance_id = ?").get(releaseId, instanceId);
  if (!row) throw ApiError.notFound("BOM 版本不存在: " + releaseId);
  if (row.status === "obsolete") throw ApiError.validation("版本已是作废状态");
  db.prepare("UPDATE bom_version_releases SET status = 'obsolete', obsolete_at = datetime('now') WHERE id = ?").run(releaseId);
  return { ok: true, id: Number(releaseId), status: "obsolete", by: userId };
}

module.exports = { ensureTable, listReleases, getRelease, createRelease, obsoleteRelease };
