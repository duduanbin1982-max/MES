"use strict";

const { wrap } = require("../middleware/asyncHandler");

const logger = require("../app/logger").createLogger("projectMasterService");

function objectType(db, name) {
  return db.prepare("SELECT type FROM sqlite_master WHERE name=?").get(name)?.type || null;
}

function migrateLegacyProjectTables(db) {
  const projectsType = objectType(db, "projects");
  if (projectsType === "table") {
    const count = db.prepare("SELECT COUNT(*) AS c FROM projects").get().c;
    if (count > 0) return { migrated: false, reason: "projects contains data" };
    db.transaction(() => {
      if (objectType(db, "project_milestones") === "table" && !objectType(db, "project_milestones_legacy")) {
        db.exec("ALTER TABLE project_milestones RENAME TO project_milestones_legacy");
      }
      if (!objectType(db, "projects_legacy")) db.exec("ALTER TABLE projects RENAME TO projects_legacy");
    })();
  }
  if (!objectType(db, "projects")) {
    db.exec(`CREATE VIEW projects AS
      SELECT id,
             COALESCE(project_no, instance_code) AS project_code,
             instance_name AS project_name,
             customer_name, customer_contact, site_location, contract_no,
             equipment_model_id AS tbm_model_id,
             start_date, planned_start, planned_end, actual_start, actual_end,
             status, progress_pct, contract_amount, notes, created_at, updated_at
      FROM equipment_instances`);
  }
  if (!objectType(db, "project_milestones")) {
    db.exec(`CREATE VIEW project_milestones AS
      SELECT id, equipment_instance_id AS project_id, phase_code, phase_name, sequence,
             planned_start, planned_end, actual_start, actual_end, status, notes
      FROM instance_milestones`);
  }
  return { migrated: true, canonical_table: "equipment_instances" };
}

function register(app, db) {
  const migration = migrateLegacyProjectTables(db);
  app.get("/api/project-master/status", wrap((_req, res) => {
    res.json({
      canonical_table: "equipment_instances",
      project_object_type: objectType(db, "projects"),
      milestone_object_type: objectType(db, "project_milestones"),
      legacy_projects_preserved: Boolean(objectType(db, "projects_legacy")),
      equipment_instances: db.prepare("SELECT COUNT(*) AS c FROM equipment_instances").get().c,
      migration,
    });
  }));
  logger.info("[projectMasterService] equipment_instances is the canonical project master");
}

module.exports = { migrateLegacyProjectTables, register };
