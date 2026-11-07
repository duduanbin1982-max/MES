"use strict";
// services/processRoute/lifecycle.js
// 2026-11-07 工艺树升级（阶段3/4）：路线版本、ECN 变更、TBM 阶段、成本滚算、KPI/瓶颈/相似项目/预测
const { ApiError } = require("../../app/errors");
const { wrap } = require("../../middleware/asyncHandler");
const audit = require("../../app/audit");
const { tableExists } = require("./schema");

const RATE_DEFAULT = 200;

function toInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

function register(app, db) {
  const all = (sql, params = []) => db.prepare(sql).all(params);
  const get = (sql, params = []) => db.prepare(sql).get(params);
  const run = (sql, params = []) => db.prepare(sql).run(params);

  function routeSnapshot(db, instanceId) {
    const nodes = all("SELECT id, parent_id, bom_node_id, operation_name, operation_type, sequence, phase_code, estimated_hours, worker_count, required_workstation_id, required_position_code, qc_required, sop_required, drawing_required, is_external, route_template_id, status, planned_start, planned_end FROM process_nodes WHERE equipment_instance_id = ? ORDER BY id", [instanceId]);
    const deps = all("SELECT predecessor_id, successor_id, dep_type, lag_hours FROM process_dependencies WHERE equipment_instance_id = ? ORDER BY id", [instanceId]);
    const templates = all("SELECT DISTINCT route_template_id, operation_name FROM process_nodes WHERE equipment_instance_id = ? AND route_template_id IS NOT NULL", [instanceId]);
    return { generated_at: new Date().toISOString(), node_count: nodes.length, dependency_count: deps.length, nodes, dependencies: deps, templates };
  }

  function latestReleased(instanceId) {
    if (!tableExists(db, "process_route_versions")) return null;
    const row = get("SELECT * FROM process_route_versions WHERE equipment_instance_id = ? AND status = 'released' ORDER BY id DESC LIMIT 1", [instanceId]);
    if (!row) return null;
    try { row.snapshot = JSON.parse(row.snapshot_json); } catch (_error) { row.snapshot = null; }
    return row;
  }

  // ---------------- 版本 ----------------
  app.post("/api/process-route/instances/:id/versions", wrap((req, res) => {
    const instanceId = toInt(req.params.id);
    if (!get("SELECT id FROM equipment_instances WHERE id = ?", [instanceId])) throw ApiError.notFound("装备实例不存在");
    const snapshot = routeSnapshot(db, instanceId);
    if (!snapshot.node_count) throw ApiError.validation("工艺树为空，不能创建版本");
    const count = get("SELECT COUNT(*) c FROM process_route_versions WHERE equipment_instance_id = ?", [instanceId]).c;
    const versionNo = `V${count + 1}`;
    const result = run(`INSERT INTO process_route_versions
      (equipment_instance_id, version_no, status, snapshot_json, node_count, dependency_count, note, created_by)
      VALUES (?, ?, 'draft', ?, ?, ?, ?, ?)`, [
      instanceId, versionNo, JSON.stringify(snapshot), snapshot.node_count, snapshot.dependency_count,
      (req.body || {}).note || null, req.user?.uid || null,
    ]);
    audit.record(db, req, {
      action: "process_route.version_create", resource_type: "process_route_version", resource_id: result.lastInsertRowid,
      after: { version_no: versionNo, node_count: snapshot.node_count, dependency_count: snapshot.dependency_count },
      diff_summary: `创建工艺路线版本 ${versionNo}`,
    });
    res.json({ id: result.lastInsertRowid, version_no: versionNo, status: "draft", node_count: snapshot.node_count, dependency_count: snapshot.dependency_count });
  }));

  app.get("/api/process-route/instances/:id/versions", wrap((req, res) => {
    const instanceId = toInt(req.params.id);
    const items = all("SELECT id, version_no, status, node_count, dependency_count, note, released_by, released_at, created_at FROM process_route_versions WHERE equipment_instance_id = ? ORDER BY id DESC", [instanceId]);
    res.json({ total: items.length, items });
  }));

  app.get("/api/process-route/versions/:id", wrap((req, res) => {
    const version = get("SELECT * FROM process_route_versions WHERE id = ?", [toInt(req.params.id)]);
    if (!version) throw ApiError.notFound("路线版本不存在");
    try { version.snapshot = JSON.parse(version.snapshot_json); } catch (_error) { version.snapshot = null; }
    delete version.snapshot_json;
    res.json(version);
  }));

  app.post("/api/process-route/versions/:id/release", wrap((req, res) => {
    const version = get("SELECT * FROM process_route_versions WHERE id = ?", [toInt(req.params.id)]);
    if (!version) throw ApiError.notFound("路线版本不存在");
    if (version.status === "released") throw ApiError.validation("版本已发布");
    if (version.status === "obsolete") throw ApiError.validation("版本已作废");
    const tx = db.transaction(() => {
      run("UPDATE process_route_versions SET status = 'obsolete' WHERE equipment_instance_id = ? AND status = 'released'", [version.equipment_instance_id]);
      run("UPDATE process_route_versions SET status = 'released', released_by = ?, released_at = datetime('now') WHERE id = ?", [req.user?.uid || null, version.id]);
      run("UPDATE process_nodes SET route_version_id = ? WHERE equipment_instance_id = ?", [version.id, version.equipment_instance_id]);
    });
    tx();
    audit.record(db, req, {
      action: "process_route.version_release", resource_type: "process_route_version", resource_id: version.id,
      before: { status: version.status }, after: { status: "released" }, diff_summary: `发布工艺路线版本 ${version.version_no}`,
    });
    res.json({ ok: true, id: version.id, status: "released" });
  }));

  // ---------------- ECN 变更 ----------------
  function computeImpact(instanceId) {
    const current = routeSnapshot(db, instanceId);
    const released = latestReleased(instanceId);
    if (!released || !released.snapshot) {
      return { basis: "none", added: [], removed: [], changed: [], added_hours: 0, current_node_count: current.node_count };
    }
    const oldNodes = new Map((released.snapshot.nodes || []).map((node) => [node.id, node]));
    const newNodes = new Map(current.nodes.map((node) => [node.id, node]));
    const added = current.nodes.filter((node) => !oldNodes.has(node.id)).map((node) => ({ id: node.id, operation_name: node.operation_name }));
    const removed = (released.snapshot.nodes || []).filter((node) => !newNodes.has(node.id)).map((node) => ({ id: node.id, operation_name: node.operation_name }));
    const changed = [];
    for (const node of current.nodes) {
      const old = oldNodes.get(node.id);
      if (!old) continue;
      const fields = ["operation_name", "estimated_hours", "worker_count", "phase_code", "qc_required", "sop_required", "drawing_required", "required_position_code", "required_workstation_id"].filter((field) => String(old[field] ?? "") !== String(node[field] ?? ""));
      if (fields.length) changed.push({ id: node.id, operation_name: node.operation_name, fields });
    }
    const addedHours = current.nodes.reduce((sum, node) => sum + (Number(node.estimated_hours) || 0), 0)
      - (released.snapshot.nodes || []).reduce((sum, node) => sum + (Number(node.estimated_hours) || 0), 0);
    return { basis: `version:${released.version_no}`, added, removed, changed, added_hours: Math.round(addedHours * 100) / 100, current_node_count: current.node_count };
  }

  app.post("/api/process-route/instances/:id/changes", wrap((req, res) => {
    const instanceId = toInt(req.params.id);
    if (!get("SELECT id FROM equipment_instances WHERE id = ?", [instanceId])) throw ApiError.notFound("装备实例不存在");
    const body = req.body || {};
    const title = String(body.title || "").trim();
    if (!title) throw ApiError.validation("title 必填");
    const count = get("SELECT COUNT(*) c FROM process_route_changes WHERE equipment_instance_id = ?", [instanceId]).c;
    const changeNo = `ECN-${today().replace(/-/g, "")}-${String(count + 1).padStart(3, "0")}`;
    const impact = computeImpact(instanceId);
    const result = run(`INSERT INTO process_route_changes
      (equipment_instance_id, change_no, title, reason, status, impact_json, requested_by)
      VALUES (?, ?, ?, ?, 'draft', ?, ?)`, [
      instanceId, changeNo, title, body.reason || null, JSON.stringify(impact), req.user?.uid || null,
    ]);
    audit.record(db, req, {
      action: "process_route.change_create", resource_type: "process_route_change", resource_id: result.lastInsertRowid,
      after: { change_no: changeNo, title, impact }, diff_summary: `创建工艺变更 ${changeNo}`,
    });
    res.json({ id: result.lastInsertRowid, change_no: changeNo, status: "draft", impact });
  }));

  app.get("/api/process-route/instances/:id/changes", wrap((req, res) => {
    const items = all("SELECT id, change_no, title, reason, status, requested_by, reviewed_by, reviewed_at, created_at FROM process_route_changes WHERE equipment_instance_id = ? ORDER BY id DESC", [toInt(req.params.id)]);
    res.json({ total: items.length, items });
  }));

  app.get("/api/process-route/changes/:id", wrap((req, res) => {
    const change = get("SELECT * FROM process_route_changes WHERE id = ?", [toInt(req.params.id)]);
    if (!change) throw ApiError.notFound("变更单不存在");
    try { change.impact = JSON.parse(change.impact_json); } catch (_error) { change.impact = null; }
    delete change.impact_json;
    res.json(change);
  }));

  app.post("/api/process-route/changes/:id/review", wrap((req, res) => {
    const change = get("SELECT * FROM process_route_changes WHERE id = ?", [toInt(req.params.id)]);
    if (!change) throw ApiError.notFound("变更单不存在");
    if (!["draft", "review"].includes(change.status)) throw ApiError.validation(`变更单当前状态为 ${change.status}，不能重复审批`);
    const approve = Boolean((req.body || {}).approve);
    const status = approve ? "approved" : "rejected";
    run("UPDATE process_route_changes SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'), review_note = ?, updated_at = datetime('now') WHERE id = ?", [
      status, req.user?.uid || null, (req.body || {}).note || null, change.id,
    ]);
    audit.record(db, req, {
      action: "process_route.change_review", resource_type: "process_route_change", resource_id: change.id,
      before: { status: change.status }, after: { status }, diff_summary: `工艺变更 ${change.change_no} ${approve ? "批准" : "驳回"}`,
    });
    res.json({ ok: true, id: change.id, status });
  }));

  // ---------------- 阶段 ----------------
  app.get("/api/process-route/instances/:id/phases", wrap((req, res) => {
    const instanceId = toInt(req.params.id);
    const rows = all(`SELECT COALESCE(NULLIF(phase_code, ''), 'unphased') phase, COUNT(*) node_count,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) completed,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) in_progress,
        SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) blocked,
        ROUND(SUM(COALESCE(estimated_hours, 0)), 2) estimated_hours
      FROM process_nodes WHERE equipment_instance_id = ? GROUP BY phase ORDER BY phase`, [instanceId]);
    res.json({ instance_id: instanceId, total: rows.length, items: rows });
  }));

  // ---------------- 成本 ----------------
  function rateMap() {
    if (!tableExists(db, "labor_rate_cards")) return new Map();
    const rows = all("SELECT work_type, hourly_rate FROM labor_rate_cards ORDER BY id");
    const map = new Map();
    for (const row of rows) map.set(String(row.work_type || "").toLowerCase(), Number(row.hourly_rate) || RATE_DEFAULT);
    return map;
  }

  app.get("/api/process-route/instances/:id/cost", wrap((req, res) => {
    const instanceId = toInt(req.params.id);
    const nodes = all("SELECT * FROM process_nodes WHERE equipment_instance_id = ?", [instanceId]);
    if (!nodes.length) return res.json({ instance_id: instanceId, total: { standard_labor: 0, actual_labor: 0, external_planned: 0, external_actual: 0, total: 0 }, items: [] });
    const rates = rateMap();
    const hoursMap = new Map();
    if (tableExists(db, "process_standard_hours")) {
      all("SELECT process_node_id, SUM(standard_hours) h, MAX(worker_count) w FROM process_standard_hours WHERE process_node_id IN (SELECT id FROM process_nodes WHERE equipment_instance_id = ?) GROUP BY process_node_id", [instanceId])
        .forEach((row) => hoursMap.set(row.process_node_id, { hours: Number(row.h) || 0, workers: Number(row.w) || 1 }));
    }
    const actualMap = new Map();
    if (tableExists(db, "process_executions")) {
      all("SELECT process_node_id, SUM(hours_worked) h FROM process_executions WHERE process_node_id IN (SELECT id FROM process_nodes WHERE equipment_instance_id = ?) GROUP BY process_node_id", [instanceId])
        .forEach((row) => actualMap.set(row.process_node_id, Number(row.h) || 0));
    }
    const items = nodes.map((node) => {
      const rateKey = String(node.operation_type || "make").toLowerCase();
      const rate = rates.get(rateKey) || rates.get("default") || RATE_DEFAULT;
      const std = hoursMap.get(node.id) || { hours: Number(node.estimated_hours) || 0, workers: Number(node.worker_count) || 1 };
      const standardLabor = Math.round(std.hours * std.workers * rate * 100) / 100;
      const actualHours = actualMap.get(node.id) || 0;
      const actualLabor = Math.round(actualHours * rate * 100) / 100;
      const externalPlanned = Number(node.planned_cost) || 0;
      const externalActual = Number(node.actual_cost) || 0;
      return {
        node_id: node.id, operation_name: node.operation_name, phase_code: node.phase_code || "unphased",
        work_type: node.operation_type, hourly_rate: rate, standard_hours: std.hours, worker_count: std.workers,
        actual_hours: actualHours, standard_labor: standardLabor, actual_labor: actualLabor,
        external_planned: externalPlanned, external_actual: externalActual,
        total_standard: Math.round((standardLabor + externalPlanned) * 100) / 100,
        total_actual: Math.round((actualLabor + externalActual) * 100) / 100,
      };
    });
    const total = items.reduce((sum, item) => {
      sum.standard_labor += item.standard_labor; sum.actual_labor += item.actual_labor;
      sum.external_planned += item.external_planned; sum.external_actual += item.external_actual;
      sum.total += item.total_standard;
      return sum;
    }, { standard_labor: 0, actual_labor: 0, external_planned: 0, external_actual: 0, total: 0 });
    Object.keys(total).forEach((key) => { total[key] = Math.round(total[key] * 100) / 100; });
    res.json({ instance_id: instanceId, total, items });
  }));

  // ---------------- KPI / 瓶颈 / 预测 ----------------
  app.get("/api/process-route/instances/:id/kpi", wrap((req, res) => {
    const instanceId = toInt(req.params.id);
    const nodes = all("SELECT * FROM process_nodes WHERE equipment_instance_id = ?", [instanceId]);
    const total = nodes.length;
    const completed = nodes.filter((node) => node.status === "completed").length;
    const inProgress = nodes.filter((node) => node.status === "in_progress").length;
    const blocked = nodes.filter((node) => node.status === "blocked").length;
    const plannedHours = nodes.reduce((sum, node) => sum + (Number(node.estimated_hours) || 0), 0);
    const actualHours = tableExists(db, "process_executions")
      ? Number(get("SELECT COALESCE(SUM(hours_worked), 0) h FROM process_executions WHERE process_node_id IN (SELECT id FROM process_nodes WHERE equipment_instance_id = ?)", [instanceId]).h)
      : 0;
    const reworkCount = tableExists(db, "process_operation_events")
      ? get("SELECT COUNT(*) c FROM process_operation_events WHERE action = 'rework' AND process_node_id IN (SELECT id FROM process_nodes WHERE equipment_instance_id = ?)", [instanceId]).c
      : 0;
    const overdue = nodes.filter((node) => node.planned_end && node.planned_end < today() && node.status !== "completed").length;
    const onTime = nodes.filter((node) => node.status === "completed" && node.planned_end && node.actual_end && node.actual_end <= node.planned_end).length;
    const completedWithPlan = nodes.filter((node) => node.status === "completed" && node.planned_end && node.actual_end).length;
    const bottlenecks = all(`SELECT required_workstation_id, COUNT(*) node_count, ROUND(SUM(COALESCE(estimated_hours,0)),2) hours,
        SUM(CASE WHEN status <> 'completed' THEN 1 ELSE 0 END) open_nodes
      FROM process_nodes WHERE equipment_instance_id = ? AND required_workstation_id IS NOT NULL
      GROUP BY required_workstation_id ORDER BY hours DESC LIMIT 10`, [instanceId]);
    const workstationNames = new Map(all("SELECT id, name FROM workstations").map((row) => [row.id, row.name]));
    const avgDaily = (() => {
      if (!tableExists(db, "process_operation_events")) return 0;
      const row = get(`SELECT COALESCE(SUM(hours_worked), 0) h FROM process_operation_events
        WHERE action IN ('complete', 'report') AND process_node_id IN (SELECT id FROM process_nodes WHERE equipment_instance_id = ?)
          AND created_at >= datetime('now', '-30 day')`, [instanceId]);
      return Number(row.h || 0) / 30;
    })();
    const remainingHours = nodes.filter((node) => node.status !== "completed").reduce((sum, node) => sum + (Number(node.estimated_hours) || 0), 0);
    const forecastDays = avgDaily > 0 ? Math.ceil(remainingHours / avgDaily) : Math.ceil(remainingHours / 8);
    res.json({
      instance_id: instanceId,
      node_count: total, completed, in_progress: inProgress, blocked,
      completion_pct: total ? Math.round((completed / total) * 1000) / 10 : 0,
      planned_hours: Math.round(plannedHours * 100) / 100,
      actual_hours: Math.round(actualHours * 100) / 100,
      hour_variance_pct: plannedHours ? Math.round(((actualHours - plannedHours) / plannedHours) * 1000) / 10 : 0,
      rework_count: reworkCount, overdue_nodes: overdue,
      on_time_rate_pct: completedWithPlan ? Math.round((onTime / completedWithPlan) * 1000) / 10 : null,
      bottlenecks: bottlenecks.map((row) => ({ ...row, workstation_name: workstationNames.get(row.required_workstation_id) || null })),
      remaining_hours: Math.round(remainingHours * 100) / 100,
      avg_daily_hours: Math.round(avgDaily * 10) / 10,
      forecast_days: forecastDays,
    });
  }));

  app.get("/api/process-route/instances/:id/similar", wrap((req, res) => {
    const instanceId = toInt(req.params.id);
    const current = get("SELECT id, instance_code, instance_name FROM equipment_instances WHERE id = ?", [instanceId]);
    if (!current) throw ApiError.notFound("装备实例不存在");
    const currentMaterials = new Set(all("SELECT DISTINCT material_id FROM instance_bom WHERE equipment_instance_id = ? AND material_id IS NOT NULL", [instanceId]).map((row) => Number(row.material_id)));
    const others = all("SELECT id, instance_code, instance_name FROM equipment_instances WHERE id <> ?", [instanceId]);
    const scored = others.map((item) => {
      const materials = new Set(all("SELECT DISTINCT material_id FROM instance_bom WHERE equipment_instance_id = ? AND material_id IS NOT NULL", [item.id]).map((row) => Number(row.material_id)));
      const intersection = [...materials].filter((id) => currentMaterials.has(id)).length;
      const union = new Set([...currentMaterials, ...materials]).size || 1;
      const route = get("SELECT route_template_id, COUNT(*) c FROM process_nodes WHERE equipment_instance_id = ? AND route_template_id IS NOT NULL GROUP BY route_template_id ORDER BY c DESC LIMIT 1", [item.id]);
      const template = route ? get("SELECT template_code, template_name FROM process_route_templates WHERE id = ?", [route.route_template_id]) : null;
      return {
        instance_id: item.id, instance_code: item.instance_code, instance_name: item.instance_name,
        similarity_pct: Math.round((intersection / union) * 1000) / 10,
        shared_materials: intersection, template_code: template?.template_code || null, template_name: template?.template_name || null,
      };
    }).filter((item) => item.shared_materials > 0).sort((a, b) => b.similarity_pct - a.similarity_pct).slice(0, 5);
    res.json({ instance: current, items: scored });
  }));
}

module.exports = { register };
