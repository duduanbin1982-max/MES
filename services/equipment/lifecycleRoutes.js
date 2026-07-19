const {
  EQUIPMENT_LIFECYCLE_STATUSES,
  canTransitionLifecycle,
  lifecycleTransitionReason,
  normalizeLifecycleStatus,
} = require("../../app/domain/equipmentInstance");

function registerLifecycleRoutes({ app, db, wrap, ApiError, ensureNotFrozen, buildOverview }) {
  const get = (sql, params = []) => db.prepare(sql).get(params);
  const run = (sql, params = []) => db.prepare(sql).run(params);

  app.post("/api/equipment_instances/:id/lifecycle", wrap((req, res) => {
    ensureNotFrozen(req.params.id);
    const toStage = normalizeLifecycleStatus(req.body.lifecycle_stage || req.body.status);
    if (!EQUIPMENT_LIFECYCLE_STATUSES.includes(toStage)) throw ApiError.validation("生命周期状态不合法");
    const inst = get("SELECT lifecycle_stage, status FROM equipment_instances WHERE id = ?", req.params.id);
    if (!inst) throw ApiError.notFound("项目装备不存在");
    const fromStage = normalizeLifecycleStatus(inst.lifecycle_stage || inst.status);
    if (!canTransitionLifecycle(fromStage, toStage)) {
      throw ApiError.validation(lifecycleTransitionReason(fromStage, toStage));
    }
    run("UPDATE equipment_instances SET lifecycle_stage = ?, status = ?, updated_at = datetime('now') WHERE id = ?", [toStage, toStage, req.params.id]);
    run("INSERT INTO equipment_instance_lifecycle_logs (equipment_instance_id, from_stage, to_stage, reason, changed_by) VALUES (?, ?, ?, ?, ?)", [req.params.id, fromStage, toStage, req.body.reason || null, req.user?.sub || req.user?.id || null]);
    res.json({ id: Number(req.params.id), from_stage: fromStage, to_stage: toStage });
  }));

  app.post("/api/equipment_instances/:id/freeze", wrap((req, res) => {
    const inst = get("SELECT * FROM equipment_instances WHERE id = ?", req.params.id);
    if (!inst) throw ApiError.notFound("项目装备不存在");
    const overview = buildOverview(req.params.id);
    const snapshot = {
      frozen_reason: req.body.reason || "交付后冻结基线",
      frozen_at: new Date().toISOString(),
      lifecycle_stage: normalizeLifecycleStatus(inst.lifecycle_stage),
      counts: overview.cards,
      milestones: overview.milestones.map((milestone) => ({
        phase_code: milestone.phase_code,
        phase_name: milestone.phase_name,
        status: milestone.status,
        planned_start: milestone.planned_start,
        planned_end: milestone.planned_end,
      })),
    };
    run("UPDATE equipment_instances SET archive_status = 'frozen', frozen_at = COALESCE(frozen_at, datetime('now')), frozen_by = COALESCE(frozen_by, ?), freeze_snapshot = ?, updated_at = datetime('now') WHERE id = ?", [req.user?.sub || req.user?.id || null, JSON.stringify(snapshot), req.params.id]);
    res.json({ id: Number(req.params.id), archive_status: "frozen", snapshot });
  }));

  app.post("/api/equipment_instances/:id/archive", wrap((req, res) => {
    const inst = get("SELECT * FROM equipment_instances WHERE id = ?", req.params.id);
    if (!inst) throw ApiError.notFound("项目装备不存在");
    if (!inst.frozen_at) {
      const overview = buildOverview(req.params.id);
      run("UPDATE equipment_instances SET frozen_at = datetime('now'), frozen_by = ?, freeze_snapshot = ? WHERE id = ?", [req.user?.sub || req.user?.id || null, JSON.stringify({ archived_with_freeze: true, counts: overview.cards }), req.params.id]);
    }
    run("UPDATE equipment_instances SET archive_status = 'archived', lifecycle_stage = 'archived', status = 'archived', archived_at = datetime('now'), archived_by = ?, updated_at = datetime('now') WHERE id = ?", [req.user?.sub || req.user?.id || null, req.params.id]);
    res.json({ id: Number(req.params.id), archive_status: "archived", lifecycle_stage: "archived" });
  }));
}

module.exports = {
  registerLifecycleRoutes,
};
