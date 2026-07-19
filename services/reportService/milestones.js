"use strict";

const { ApiError } = require("../../app/errors");
const { wrap } = require("../../middleware/asyncHandler");

function register(app, db) {
  const all = (sql, ...params) => db.prepare(sql).all(...params);
  const get = (sql, ...params) => db.prepare(sql).get(...params);
  const run = (sql, ...params) => db.prepare(sql).run(...params);

  app.get("/api/equipment_instances/:id/milestones", wrap((req, res) => {
    let rows = all("SELECT * FROM instance_milestones WHERE equipment_instance_id = ? ORDER BY sequence", req.params.id);
    if (!rows.length) {
      rows = all(`
        SELECT id, project_id AS equipment_instance_id, phase_code, phase_name, sequence,
               planned_start, planned_end, actual_start, actual_end, status, notes
        FROM equipment_instance_milestones
        WHERE project_id = ?
        ORDER BY sequence, id
      `, req.params.id);
    }
    res.json(rows);
  }));

  app.post("/api/equipment_instances/:id/milestones/auto-generate", wrap((req, res) => {
    const phases = [
      ["S1", "设计冻结", 1],
      ["S2", "采购", 2],
      ["S3", "自制件生产", 3],
      ["S4", "部件预装", 4],
      ["S5", "总装", 5],
      ["S6", "厂内调试", 6],
      ["S7", "拆解/包装/发运", 7],
      ["S8", "现场组装", 8],
      ["S9", "试掘进/验收", 9],
      ["S10", "质保期", 10],
    ];

    const existing = get("SELECT COUNT(*) AS c FROM instance_milestones WHERE equipment_instance_id = ?", req.params.id).c;
    if (existing > 0) return res.json({ count: existing, skipped: true });

    const insert = db.prepare(`
      INSERT INTO instance_milestones (equipment_instance_id, phase_code, phase_name, sequence, planned_start, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const [code, name, sequence] of phases) {
      insert.run(req.params.id, code, name, sequence, "2026-07-01", "pending");
    }
    res.json({ count: phases.length, skipped: false });
  }));

  app.put("/api/milestones/:id", wrap((req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) throw ApiError.validation("milestone id is required");

    let source = "instance_milestones";
    let row = get("SELECT *, equipment_instance_id AS sync_instance_id FROM instance_milestones WHERE id = ?", id);
    if (!row) {
      source = "equipment_instance_milestones";
      row = get("SELECT *, project_id AS sync_instance_id FROM equipment_instance_milestones WHERE id = ?", id);
    }
    if (!row) throw ApiError.notFound("Milestone not found");

    const allowed = ["phase_name", "planned_start", "planned_end", "actual_start", "actual_end", "status", "notes"];
    const sets = [];
    const params = [];
    for (const field of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) {
        sets.push(`${field} = ?`);
        params.push(req.body[field] || null);
      }
    }
    if (!sets.length) throw ApiError.validation("No editable fields supplied");

    params.push(id);
    run(`UPDATE ${source} SET ${sets.join(", ")} WHERE id = ?`, ...params);

    const syncTable = source === "instance_milestones" ? "equipment_instance_milestones" : "instance_milestones";
    const syncInstanceColumn = source === "instance_milestones" ? "project_id" : "equipment_instance_id";
    const syncRow = get(`SELECT id FROM ${syncTable} WHERE ${syncInstanceColumn} = ? AND phase_code = ?`, row.sync_instance_id, row.phase_code);
    if (syncRow) {
      run(`UPDATE ${syncTable} SET ${sets.join(", ")} WHERE id = ?`, ...params.slice(0, -1), syncRow.id);
    }

    const updated = get(`SELECT * FROM ${source} WHERE id = ?`, id);
    res.json({ ok: true, milestone: updated });
  }));
}

module.exports = { register };
