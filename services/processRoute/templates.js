"use strict";
// services/processRoute/templates.js
// 2026-11-07 工艺树升级（阶段1）：部件级路线模板、全层级生成、路线健康度、依赖感知排程
const { ApiError } = require("../../app/errors");
const { wrap } = require("../../middleware/asyncHandler");
const audit = require("../../app/audit");
const { computeCPM } = require("../processTree/generator");


const DEP_TYPES = new Set(["FS", "SS", "FF", "SF"]);

function toInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
function toNum(value, field, min = 0, max = 100000) {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num) || num < min || num > max) throw ApiError.validation(`${field} 需在 ${min}~${max} 之间`);
  return num;
}
function toText(value, field, { required = false, max = 200 } = {}) {
  const text = value === undefined || value === null ? "" : String(value).trim();
  if (!text) {
    if (required) throw ApiError.validation(`${field} 必填`);
    return null;
  }
  if (text.length > max) throw ApiError.validation(`${field} 长度不能超过 ${max}`);
  return text;
}
function toBoolInt(value) {
  return value === true || value === 1 || value === "1" || value === "true" ? 1 : 0;
}

function normalizeSteps(rawSteps) {
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) throw ApiError.validation("steps 至少需要 1 道工序");
  return rawSteps.map((step, index) => {
    const operationName = toText(step.operation_name, `steps[${index}].operation_name`, { required: true });
    const depType = String(step.dependency_type || "FS").toUpperCase();
    if (!DEP_TYPES.has(depType)) throw ApiError.validation(`steps[${index}].dependency_type 非法`);
    return {
      operation_name: operationName,
      operation_type: toText(step.operation_type, "operation_type", { max: 40 }) || "make",
      phase_code: toText(step.phase_code, "phase_code", { max: 50 }),
      standard_hours: toNum(step.standard_hours, "standard_hours", 0, 100000),
      worker_count: toInt(step.worker_count) || 1,
      default_station_type: toText(step.default_station_type, "default_station_type", { max: 50 }),
      required_skill: toText(step.required_skill, "required_skill", { max: 100 }),
      required_position_code: toText(step.required_position_code, "required_position_code", { max: 100 }),
      qc_required: toBoolInt(step.qc_required),
      sop_required: toBoolInt(step.sop_required),
      drawing_required: toBoolInt(step.drawing_required),
      is_external: toBoolInt(step.is_external),
      operation_template_id: toInt(step.operation_template_id),
      dependency_type: depType,
      lag_hours: toNum(step.lag_hours, "lag_hours", 0, 8760),
      description: toText(step.description, "description", { max: 500 }),
    };
  });
}

function registerTemplateRoutes(app, db) {
  const all = (sql, params = []) => db.prepare(sql).all(params);
  const get = (sql, params = []) => db.prepare(sql).get(params);
  const run = (sql, params = []) => db.prepare(sql).run(params);

  function templateWithSteps(id) {
    const template = get("SELECT * FROM process_route_templates WHERE id = ?", [id]);
    if (!template) return null;
    template.steps = all("SELECT * FROM process_route_template_steps WHERE template_id = ? ORDER BY sequence, id", [id]);
    return template;
  }

  app.get("/api/process-route/templates", wrap((req, res) => {
    const activeOnly = String(req.query.active ?? "1") !== "0";
    const templates = all(`SELECT * FROM process_route_templates ${activeOnly ? "WHERE is_active = 1" : ""} ORDER BY template_code`);
    const steps = all("SELECT template_id, COUNT(*) c FROM process_route_template_steps GROUP BY template_id");
    const stepMap = new Map(steps.map((row) => [row.template_id, row.c]));
    res.json({ total: templates.length, items: templates.map((tpl) => ({ ...tpl, step_count: stepMap.get(tpl.id) || 0 })) });
  }));

  app.get("/api/process-route/templates/:id", wrap((req, res) => {
    const template = templateWithSteps(toInt(req.params.id));
    if (!template) throw ApiError.notFound("路线模板不存在");
    res.json(template);
  }));

  app.post("/api/process-route/templates", wrap((req, res) => {
    const body = req.body || {};
    const code = toText(body.template_code, "template_code", { required: true, max: 50 });
    const name = toText(body.template_name, "template_name", { required: true, max: 100 });
    if (get("SELECT id FROM process_route_templates WHERE template_code = ?", [code])) throw ApiError.conflict(`模板编码已存在：${code}`);
    const steps = normalizeSteps(body.steps);
    const tx = db.transaction(() => {
      const result = run(`INSERT INTO process_route_templates
        (template_code, template_name, part_category, material_category, phase_code, description, is_active)
        VALUES (?, ?, ?, ?, ?, ?, 1)`, [
        code, name,
        toText(body.part_category, "part_category", { max: 50 }) || "*",
        toText(body.material_category, "material_category", { max: 50 }) || "*",
        toText(body.phase_code, "phase_code", { max: 50 }),
        toText(body.description, "description", { max: 500 }),
      ]);
      const templateId = result.lastInsertRowid;
      const insertStep = db.prepare(`INSERT INTO process_route_template_steps
        (template_id, sequence, operation_name, operation_type, phase_code, standard_hours, worker_count,
         default_station_type, required_skill, required_position_code, qc_required, sop_required, drawing_required,
         is_external, operation_template_id, dependency_type, lag_hours, description)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      steps.forEach((step, index) => {
        insertStep.run(templateId, index + 1, step.operation_name, step.operation_type, step.phase_code,
          step.standard_hours, step.worker_count, step.default_station_type, step.required_skill,
          step.required_position_code, step.qc_required, step.sop_required, step.drawing_required,
          step.is_external, step.operation_template_id, step.dependency_type, step.lag_hours, step.description);
      });
      return templateId;
    });
    const templateId = tx();
    audit.record(db, req, {
      action: "process_route.template_create", resource_type: "process_route_template", resource_id: templateId,
      after: { code, name, steps: steps.length }, diff_summary: `创建路线模板 ${code}（${steps.length} 道工序）`,
    });
    res.json(templateWithSteps(templateId));
  }));

  app.put("/api/process-route/templates/:id", wrap((req, res) => {
    const id = toInt(req.params.id);
    const existing = get("SELECT * FROM process_route_templates WHERE id = ?", [id]);
    if (!existing) throw ApiError.notFound("路线模板不存在");
    const body = req.body || {};
    const code = body.template_code !== undefined ? toText(body.template_code, "template_code", { required: true, max: 50 }) : existing.template_code;
    const duplicate = get("SELECT id FROM process_route_templates WHERE template_code = ? AND id <> ?", [code, id]);
    if (duplicate) throw ApiError.conflict(`模板编码已存在：${code}`);
    const steps = body.steps !== undefined ? normalizeSteps(body.steps) : null;
    const tx = db.transaction(() => {
      run(`UPDATE process_route_templates SET template_code = ?, template_name = ?, part_category = ?, material_category = ?,
          phase_code = ?, description = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?`, [
        code,
        body.template_name !== undefined ? toText(body.template_name, "template_name", { required: true, max: 100 }) : existing.template_name,
        body.part_category !== undefined ? (toText(body.part_category, "part_category", { max: 50 }) || "*") : existing.part_category,
        body.material_category !== undefined ? (toText(body.material_category, "material_category", { max: 50 }) || "*") : existing.material_category,
        body.phase_code !== undefined ? toText(body.phase_code, "phase_code", { max: 50 }) : existing.phase_code,
        body.description !== undefined ? toText(body.description, "description", { max: 500 }) : existing.description,
        body.is_active !== undefined ? toBoolInt(body.is_active) : existing.is_active,
        id,
      ]);
      if (steps) {
        run("DELETE FROM process_route_template_steps WHERE template_id = ?", [id]);
        const insertStep = db.prepare(`INSERT INTO process_route_template_steps
          (template_id, sequence, operation_name, operation_type, phase_code, standard_hours, worker_count,
           default_station_type, required_skill, required_position_code, qc_required, sop_required, drawing_required,
           is_external, operation_template_id, dependency_type, lag_hours, description)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        steps.forEach((step, index) => {
          insertStep.run(id, index + 1, step.operation_name, step.operation_type, step.phase_code,
            step.standard_hours, step.worker_count, step.default_station_type, step.required_skill,
            step.required_position_code, step.qc_required, step.sop_required, step.drawing_required,
            step.is_external, step.operation_template_id, step.dependency_type, step.lag_hours, step.description);
        });
      }
    });
    tx();
    audit.record(db, req, {
      action: "process_route.template_update", resource_type: "process_route_template", resource_id: id,
      before: { code: existing.template_code, name: existing.template_name },
      after: { code, name: body.template_name || existing.template_name, steps: steps ? steps.length : undefined },
      diff_summary: `更新路线模板 #${id}`,
    });
    res.json(templateWithSteps(id));
  }));
}

function registerGenerationRoutes(app, db) {
  const all = (sql, params = []) => db.prepare(sql).all(params);
  const get = (sql, params = []) => db.prepare(sql).get(params);
  const run = (sql, params = []) => db.prepare(sql).run(params);

  function matchTemplate(component, material, templates, forcedId) {
    if (forcedId) return templates.find((tpl) => Number(tpl.id) === Number(forcedId)) || null;
    const category = String(component.category || "").trim();
    const grade = String(material?.material_grade || component.material_grade || "").trim();
    const matched = templates.filter((tpl) => tpl.is_active !== 0).find((tpl) => {
      const part = String(tpl.part_category || "*");
      const materialCat = String(tpl.material_category || "*");
      const partOk = part === "*" || (category && part.toLowerCase() === category.toLowerCase());
      const materialOk = materialCat === "*" || (grade && materialCat.toLowerCase() === grade.toLowerCase());
      return partOk && materialOk;
    });
    return matched || templates.find((tpl) => tpl.is_active !== 0) || null;
  }

  app.post("/api/process-route/instances/:id/generate-from-template", wrap((req, res) => {
    const instanceId = toInt(req.params.id);
    const instance = get("SELECT id FROM equipment_instances WHERE id = ?", [instanceId]);
    if (!instance) throw ApiError.notFound("装备实例不存在");
    const body = req.body || {};
    const forcedTemplateId = body.template_id ? toInt(body.template_id) : null;
    const dryRun = Boolean(body.dry_run);
    const templates = all("SELECT * FROM process_route_templates WHERE is_active = 1 ORDER BY id");
    if (!templates.length) throw ApiError.validation("没有可用的路线模板，请先创建模板");
    const bomRows = all("SELECT b.* FROM instance_bom b WHERE b.equipment_instance_id = ? ORDER BY b.tier, b.parent_id, b.id", [instanceId]);
    if (bomRows.length === 0) throw ApiError.validation("该装备实例没有 BOM，无法生成工艺路线");
    const existingNodes = all("SELECT id, bom_node_id, operation_name FROM process_nodes WHERE equipment_instance_id = ? AND bom_node_id IS NOT NULL", [instanceId]);
    const existingKeys = new Set(existingNodes.map((node) => `${Number(node.bom_node_id)}:${node.operation_name}`));
    const componentFirstNode = new Map();
    for (const node of existingNodes) {
      const key = Number(node.bom_node_id);
      if (!componentFirstNode.has(key) || Number(node.id) < Number(componentFirstNode.get(key).id)) componentFirstNode.set(key, node);
    }
    let plannedNodes = 0;
    let plannedHours = 0;
    const plan = [];
    for (const component of bomRows) {
      const template = matchTemplate(component, component, templates, forcedTemplateId);
      if (!template) continue;
      const steps = all("SELECT * FROM process_route_template_steps WHERE template_id = ? ORDER BY sequence, id", [template.id]);
      if (!steps.length) continue;
      for (const step of steps) {
        const key = `${Number(component.id)}:${step.operation_name}`;
        if (existingKeys.has(key)) continue;
        plannedNodes += 1;
        plannedHours += Number(step.standard_hours) || 0;
        plan.push({ bom_node_id: component.id, part_number: component.part_number, template_id: template.id, template_code: template.template_code, operation_name: step.operation_name, standard_hours: step.standard_hours });
      }
    }
    if (dryRun) {
      res.json({ dry_run: true, instance_id: instanceId, bom_nodes: bomRows.length, templates: templates.length, planned_nodes: plannedNodes, planned_hours: plannedHours, plan: plan.slice(0, 200) });
      return;
    }

    const createdNodeIds = [];
    let createdHours = 0;
    const insertNode = db.prepare(`INSERT INTO process_nodes (
      equipment_instance_id, parent_id, bom_node_id, operation_name, operation_type, sequence, phase_code,
      estimated_hours, required_workstation_id, required_skill, operation_template_id, required_position_code,
      worker_count, qc_required, sop_required, drawing_required, is_external, route_template_id, status,
      sort_order, notes, node_code
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?)`);
    const insertHours = db.prepare(`INSERT INTO process_standard_hours
      (process_node_id, work_type, standard_hours, worker_count, unit, description) VALUES (?, ?, ?, ?, 'h', ?)`);
    const tx = db.transaction(() => {
      for (const component of bomRows) {
        const template = matchTemplate(component, component, templates, forcedTemplateId);
        if (!template) continue;
        const steps = all("SELECT * FROM process_route_template_steps WHERE template_id = ? ORDER BY sequence, id", [template.id]);
        if (!steps.length) continue;
        const componentRoot = componentFirstNode.get(Number(component.id));
        let parentNodeId = componentRoot ? Number(componentRoot.id) : null;
        let previousNodeId = null;
        for (const step of steps) {
          const key = `${Number(component.id)}:${step.operation_name}`;
          if (existingKeys.has(key)) continue;
          const hours = Number(step.standard_hours) || 0;
          const result = insertNode.run(
            instanceId,
            parentNodeId,
            component.id,
            step.operation_name,
            step.operation_type || "make",
            Number(step.sequence) || 1,
            step.phase_code || template.phase_code || null,
            hours,
            null,
            step.required_skill || null,
            step.operation_template_id || null,
            step.required_position_code || null,
            Number(step.worker_count) || 1,
            Number(step.qc_required) ? 1 : 0,
            Number(step.sop_required) ? 1 : 0,
            Number(step.drawing_required) ? 1 : 0,
            Number(step.is_external) ? 1 : 0,
            template.id,
            Number(component.id) * 1000 + Number(step.sequence),
            step.description || `按模板 ${template.template_code} 生成`,
            "PN-TMP"
          );
          const nodeId = result.lastInsertRowid;
          run("UPDATE process_nodes SET node_code = ? WHERE id = ?", [`PN-${nodeId}`, nodeId]);
          if (hours > 0) {
            insertHours.run(nodeId, step.operation_type || "make", hours, Number(step.worker_count) || 1, `模板：${template.template_code}`);
            createdHours += 1;
          }
          if (previousNodeId) {
            run(`INSERT INTO process_dependencies (equipment_instance_id, predecessor_id, successor_id, dep_type, lag_hours)
                 VALUES (?, ?, ?, ?, ?)`, [instanceId, previousNodeId, nodeId, step.dependency_type || "FS", Number(step.lag_hours) || 0]);
          }
          if (!componentRoot) {
            parentNodeId = parentNodeId || null;
            componentFirstNode.set(Number(component.id), { id: nodeId });
          }
          previousNodeId = nodeId;
          existingKeys.add(key);
          createdNodeIds.push(nodeId);
        }
      }
    });
    tx();
    audit.record(db, req, {
      action: "process_route.generate_from_template", resource_type: "equipment_instance", resource_id: instanceId,
      after: { created_nodes: createdNodeIds.length, created_hours: createdHours, planned_nodes: plannedNodes },
      diff_summary: `按模板生成 ${createdNodeIds.length} 个工序节点（${createdHours} 条标准工时）`,
    });
    res.json({ ok: true, instance_id: instanceId, created_nodes: createdNodeIds.length, created_hours: createdHours, planned_nodes: plannedNodes, planned_hours: plannedHours });
  }));
}

function registerHealthRoutes(app, db) {
  const all = (sql, params = []) => db.prepare(sql).all(params);
  const get = (sql, params = []) => db.prepare(sql).get(params);

  app.get("/api/process-route/instances/:id/health", wrap((req, res) => {
    const instanceId = toInt(req.params.id);
    const instance = get("SELECT id, instance_code FROM equipment_instances WHERE id = ?", [instanceId]);
    if (!instance) throw ApiError.notFound("装备实例不存在");
    const nodes = all("SELECT * FROM process_nodes WHERE equipment_instance_id = ?", [instanceId]);
    const deps = all("SELECT * FROM process_dependencies WHERE equipment_instance_id = ?", [instanceId]);
    const issues = [];
    const pushIssue = (level, code, message, nodeId = null) => issues.push({ level, code, message, node_id: nodeId });
    if (!nodes.length) pushIssue("error", "NO_NODES", "该实例还没有工艺节点");
    const roots = nodes.filter((node) => !node.parent_id);
    if (nodes.length > 1 && roots.length === nodes.length) pushIssue("warning", "FLAT_TREE", "所有节点都是根节点，未形成部件层级");
    for (const node of nodes) {
      if (!node.route_template_id) pushIssue("warning", "NO_TEMPLATE", `节点「${node.operation_name}」没有路线模板来源`, node.id);
      if (!Number(node.estimated_hours)) pushIssue("warning", "NO_HOURS", `节点「${node.operation_name}」标准工时为 0`, node.id);
      if (!node.required_workstation_id) pushIssue("info", "NO_STATION", `节点「${node.operation_name}」未绑定工位`, node.id);
      if (!node.required_position_code) pushIssue("info", "NO_POSITION", `节点「${node.operation_name}」未绑定岗位`, node.id);
      if (!node.qc_required && node.operation_type === "qc") pushIssue("warning", "QC_FLAG_MISSING", `质检工序「${node.operation_name}」未标记 QC 要求`, node.id);
      if (!node.planned_start || !node.planned_end) pushIssue("info", "NO_PLAN", `节点「${node.operation_name}」没有计划日期`, node.id);
      if (node.is_external && !node.planned_cost) pushIssue("info", "EXTERNAL_NO_COST", `外协工序「${node.operation_name}」没有外协成本`, node.id);
    }
    const noHours = nodes.filter((node) => Number(node.estimated_hours) > 0).length;
    const stdHours = get("SELECT COUNT(*) c FROM process_standard_hours WHERE process_node_id IN (SELECT id FROM process_nodes WHERE equipment_instance_id = ?)", [instanceId]).c;
    if (stdHours === 0) pushIssue("warning", "NO_STANDARD_HOURS", "没有工序标准工时记录");
    const cycle = computeCPM(nodes.map((node) => ({ id: node.id, parent_id: node.parent_id, duration_days: node.estimated_hours || 0 })), deps);
    if (cycle.cycleNodes.length) pushIssue("error", "DEPENDENCY_CYCLE", `存在 ${cycle.cycleNodes.length} 个节点的依赖环：${cycle.cycleNodes.join(",")}`);
    const danglingDeps = deps.filter((dep) => !nodes.some((node) => node.id === dep.predecessor_id) || !nodes.some((node) => node.id === dep.successor_id));
    if (danglingDeps.length) pushIssue("error", "DANGLING_DEPENDENCY", `存在 ${danglingDeps.length} 条悬空依赖`);
    const missingItp = nodes.filter((node) => node.qc_required && !get("SELECT 1 x FROM process_itp_points WHERE process_node_id = ? LIMIT 1", [node.id])).length;
    if (missingItp > 0) pushIssue("warning", "NO_ITP", `${missingItp} 个 QC 节点没有 ITP 检验点`);
    const weights = { error: 12, warning: 5, info: 1 };
    const penalty = issues.reduce((sum, issue) => sum + (weights[issue.level] || 0), 0);
    const score = Math.max(0, 100 - penalty);
    res.json({
      instance, score, grade: score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : "D",
      node_count: nodes.length, root_count: roots.length, dependency_count: deps.length,
      nodes_with_hours: noHours, standard_hours_rows: stdHours,
      issue_count: issues.length, issues: issues.slice(0, 200),
    });
  }));
}

function moveWorkHours(start, hours, workdayHours = 8) {
  const date = new Date(start);
  let remaining = Math.max(0, Number(hours) || 0);
  if (remaining === 0) return formatDate(date);
  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day === 0 || day === 6) continue;
    remaining -= workdayHours;
  }
  return formatDate(date);
}
function formatDate(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function registerScheduleRoutes(app, db) {
  const all = (sql, params = []) => db.prepare(sql).all(params);
  const get = (sql, params = []) => db.prepare(sql).get(params);

  function buildPreview(instanceId, startDate, workdayHours) {
    const nodes = all("SELECT id, parent_id, operation_name, estimated_hours, status FROM process_nodes WHERE equipment_instance_id = ? ORDER BY sequence, sort_order, id", [instanceId]);
    const deps = all("SELECT predecessor_id, successor_id, dep_type, lag_hours FROM process_dependencies WHERE equipment_instance_id = ?", [instanceId]);
    const cpm = computeCPM(nodes.map((node) => ({ id: node.id, parent_id: node.parent_id, duration_days: node.estimated_hours || 0 })), deps);
    if (cpm.cycleNodes.length) throw ApiError.validation(`存在依赖环，无法排程：${cpm.cycleNodes.join(",")}`);
    const byId = new Map(cpm.allNodes.map((node) => [node.id, node]));
    const start = new Date(`${startDate}T00:00:00`);
    if (Number.isNaN(start.getTime())) throw ApiError.validation("start_date 非法");
    const rows = nodes.map((node) => {
      const cpmNode = byId.get(node.id) || { es: 0, slack: 0 };
      return {
        node_id: node.id, operation_name: node.operation_name, status: node.status,
        es_hours: cpmNode.es, slack_hours: cpmNode.slack,
        planned_start: moveWorkHours(start, cpmNode.es, workdayHours),
        planned_end: moveWorkHours(start, cpmNode.es + (Number(node.estimated_hours) || 0), workdayHours),
      };
    });
    return { project_hours: cpm.projectDuration, cycle_nodes: cpm.cycleNodes, rows };
  }

  app.post("/api/process-route/instances/:id/schedule/preview", wrap((req, res) => {
    const instanceId = toInt(req.params.id);
    if (!get("SELECT id FROM equipment_instances WHERE id = ?", [instanceId])) throw ApiError.notFound("装备实例不存在");
    const body = req.body || {};
    const startDate = toText(body.start_date, "start_date", { required: true, max: 20 });
    const workdayHours = toNum(body.workday_hours ?? 8, "workday_hours", 1, 24);
    res.json({ instance_id: instanceId, start_date: startDate, workday_hours: workdayHours, ...buildPreview(instanceId, startDate, workdayHours) });
  }));

  app.post("/api/process-route/instances/:id/schedule/apply", wrap((req, res) => {
    const instanceId = toInt(req.params.id);
    if (!get("SELECT id FROM equipment_instances WHERE id = ?", [instanceId])) throw ApiError.notFound("装备实例不存在");
    const body = req.body || {};
    const startDate = toText(body.start_date, "start_date", { required: true, max: 20 });
    const workdayHours = toNum(body.workday_hours ?? 8, "workday_hours", 1, 24);
    const preview = buildPreview(instanceId, startDate, workdayHours);
    const update = db.prepare("UPDATE process_nodes SET planned_start = ?, planned_end = ?, updated_at = datetime('now') WHERE id = ?");
    const tx = db.transaction(() => preview.rows.forEach((row) => update.run(row.planned_start, row.planned_end, row.node_id)));
    tx();
    audit.record(db, req, {
      action: "process_route.schedule_apply", resource_type: "equipment_instance", resource_id: instanceId,
      after: { start_date: startDate, workday_hours: workdayHours, updated: preview.rows.length, project_hours: preview.project_hours },
      diff_summary: `按依赖/CPM 回写 ${preview.rows.length} 个工序节点计划日期`,
    });
    res.json({ ok: true, instance_id: instanceId, updated: preview.rows.length, project_hours: preview.project_hours, rows: preview.rows });
  }));
}

function register(app, db) {
  registerTemplateRoutes(app, db);
  registerGenerationRoutes(app, db);
  registerHealthRoutes(app, db);
  registerScheduleRoutes(app, db);
}

module.exports = { register, moveWorkHours };
