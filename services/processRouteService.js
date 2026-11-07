"use strict";
const { ApiError } = require("../app/errors");
const { assessProcessRoute, summarizeProcessRoutes } = require("../app/domain/processRoute");
const { wrap } = require("../middleware/asyncHandler");
const audit = require("../app/audit");

function register(app, db) {
  const all = (sql, params = []) => db.prepare(sql).all(params);
  const get = (sql, params = []) => db.prepare(sql).get(params);

  function descendants(rows, rootId) {
    const children = new Map();
    for (const row of rows) {
      const parentId = row.parent_id == null ? null : Number(row.parent_id);
      if (!children.has(parentId)) children.set(parentId, []);
      children.get(parentId).push(Number(row.id));
    }
    const ids = new Set([Number(rootId)]);
    const stack = [...(children.get(Number(rootId)) || [])];
    while (stack.length) {
      const id = stack.pop();
      if (ids.has(id)) continue;
      ids.add(id);
      stack.push(...(children.get(id) || []));
    }
    return ids;
  }

  app.get("/api/process-route/instances/:id/components", wrap((req, res) => {
    const instanceId = Number(req.params.id);
    const inst = get("SELECT id, instance_code, instance_name FROM equipment_instances WHERE id = ?", [instanceId]);
    if (!inst) throw ApiError.notFound("装备实例不存在");

    const bomRows = all(`
      SELECT b.*, m.material_code, m.material_name
      FROM instance_bom b
      LEFT JOIN materials m ON m.id = b.material_id
      WHERE b.equipment_instance_id = ?
      ORDER BY b.tier, b.parent_id, b.id
    `, [instanceId]);
    const components = bomRows.filter(row => Number(row.tier) === 1);
    const processRows = all(`
      SELECT pn.*, w.code AS workstation_code, w.name AS workstation_name, w.station_type,
             u.full_name AS assigned_name,
             COALESCE((SELECT SUM(psh.standard_hours * psh.worker_count) FROM process_standard_hours psh WHERE psh.process_node_id = pn.id), 0) AS standard_man_hours
      FROM process_nodes pn
      LEFT JOIN workstations w ON w.id = pn.required_workstation_id
      LEFT JOIN users u ON u.id = pn.assigned_to
      WHERE pn.equipment_instance_id = ?
      ORDER BY pn.bom_node_id, pn.sequence, pn.sort_order, pn.id
    `, [instanceId]);

    const cards = components.map(component => {
      const scope = descendants(bomRows, component.id);
      const operations = processRows
        .filter(op => op.bom_node_id && scope.has(Number(op.bom_node_id)))
        .map(op => ({
          id: op.id,
          operation_name: op.operation_name,
          operation_type: op.operation_type,
          sequence: op.sequence,
          bom_node_id: op.bom_node_id,
          estimated_hours: op.estimated_hours || 0,
          standard_man_hours: op.standard_man_hours || 0,
          required_workstation_id: op.required_workstation_id,
          workstation_code: op.workstation_code,
          workstation_name: op.workstation_name,
          station_type: op.station_type,
          required_skill: op.required_skill,
          assigned_to: op.assigned_to,
          assigned_name: op.assigned_name,
          status: op.status,
        }));
      const componentInfo = {
        id: component.id,
        part_number: component.part_number,
        material_id: component.material_id,
        material_code: component.material_code,
        material_name: component.material_name,
        name: component.material_name || component.part_number || component.notes || `部件#${component.id}`,
        quantity: component.quantity,
        unit: component.unit,
        category: component.category,
      };
      return { ...assessProcessRoute(componentInfo, operations), operations };
    });

    const summary = summarizeProcessRoutes(cards);
    res.json({ instance: inst, summary, components: cards });
  }));

  function workstationFor(type) {
    const patterns = {
      cutting: ["cutting", "下料"],
      forming: ["forming", "成型"],
      welding: ["welding", "焊接"],
      qc: ["inspection", "质检"],
      machining: ["machining", "机加"],
      assembly: ["assembly", "装配"],
      commissioning: ["commissioning", "调试"],
    }[type] || ["general"];
    for (const pattern of patterns) {
      const row = get("SELECT id FROM workstations WHERE is_active = 1 AND (station_type = ? OR workshop LIKE ? OR name LIKE ?) ORDER BY id LIMIT 1", [pattern, `%${pattern}%`, `%${pattern}%`]);
      if (row) return row.id;
    }
    return null;
  }

  function inferOperationMeta(name) {
    const text = String(name || "").toLowerCase();
    if (/下料|切割|cut/.test(text)) return { type: "cutting", skill: "cutting" };
    if (/卷制|折弯|成型|form/.test(text)) return { type: "forming", skill: "forming" };
    if (/焊|weld/.test(text)) return { type: "welding", skill: "welding" };
    if (/探伤|检|测量|qc|ndt|inspect/.test(text)) return { type: "qc", skill: "qc" };
    if (/机加|镗|铣|车|machin|cnc/.test(text)) return { type: "machining", skill: "machining" };
    if (/调试|试压|commission|test/.test(text)) return { type: "commissioning", skill: "commissioning" };
    return { type: "assembly", skill: "assembly" };
  }

  app.post("/api/process-route/instances/:id/auto-bind", wrap((req, res) => {
    const instanceId = Number(req.params.id);
    const inst = get("SELECT id FROM equipment_instances WHERE id = ?", [instanceId]);
    if (!inst) throw ApiError.notFound("装备实例不存在");
    const nodes = all("SELECT id, operation_name, required_workstation_id, required_skill FROM process_nodes WHERE equipment_instance_id = ?", [instanceId]);
    let changed = 0;
    const update = db.prepare("UPDATE process_nodes SET required_workstation_id = COALESCE(required_workstation_id, ?), required_skill = COALESCE(NULLIF(required_skill, ''), ?), updated_at = datetime('now') WHERE id = ?");
    for (const node of nodes) {
      const meta = inferOperationMeta(node.operation_name);
      const workstationId = node.required_workstation_id || workstationFor(meta.type);
      if (!node.required_workstation_id || !node.required_skill) {
        update.run(workstationId, meta.skill, node.id);
        changed += 1;
      }
    }
    if (changed > 0) {
      audit.record(db, req, {
        action: "process_route.auto_bind",
        resource_type: "equipment_instance",
        resource_id: instanceId,
        after: { changed },
        diff_summary: `自动补齐 ${changed} 个工艺节点的工位/技能`,
      });
    }
    res.json({ ok: true, changed });
  }));

  app.post("/api/process-route/instances/:id/generate-missing", wrap((req, res) => {
    const instanceId = Number(req.params.id);
    const inst = get("SELECT id FROM equipment_instances WHERE id = ?", [instanceId]);
    if (!inst) throw ApiError.notFound("装备实例不存在");
    const bomRows = all("SELECT * FROM instance_bom WHERE equipment_instance_id = ? ORDER BY tier, parent_id, id", [instanceId]);
    const components = bomRows.filter(row => Number(row.tier) === 1);
    // 2026-11-07（工艺树审计）：按“部件 + 工序名”判断缺失，而不是“部件有任何节点就整块跳过”，
    // 避免新增模板工序无法补齐；同时使用 process_operation_templates 的真实配置
    // （QC/SOP/图纸要求、岗位、定员、标准工时），而不是硬编码 3 道工序。
    const existing = all("SELECT bom_node_id, operation_name FROM process_nodes WHERE equipment_instance_id = ? AND bom_node_id IS NOT NULL", [instanceId]);
    const existingKeys = new Set(existing.map(row => `${Number(row.bom_node_id)}:${row.operation_name}`));
    let templates = [];
    try {
      templates = all("SELECT * FROM process_operation_templates WHERE is_active = 1 ORDER BY sequence_hint, id");
    } catch (_error) { templates = []; }
    if (!templates.length) {
      templates = [
        { operation_name: "装配准备", operation_type: "assembly", standard_hours: 4, worker_count: 1, required_skill: "assembly", qc_required: 0, sop_required: 0, drawing_required: 0, sequence_hint: 1 },
        { operation_name: "部件装配", operation_type: "assembly", standard_hours: 16, worker_count: 1, required_skill: "assembly", qc_required: 0, sop_required: 0, drawing_required: 0, sequence_hint: 2 },
        { operation_name: "过程检验", operation_type: "qc", standard_hours: 2, worker_count: 1, required_skill: "qc", qc_required: 1, sop_required: 0, drawing_required: 0, sequence_hint: 3 },
      ];
    }
    const insert = db.prepare(`INSERT INTO process_nodes (
      equipment_instance_id, parent_id, bom_node_id, operation_name, operation_type, sequence,
      estimated_hours, required_workstation_id, required_skill, operation_template_id,
      required_position_code, worker_count, qc_required, sop_required, drawing_required,
      status, sort_order, notes
    ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)`);
    const insertHours = db.prepare(`INSERT INTO process_standard_hours (
      process_node_id, work_type, standard_hours, worker_count, unit, description
    ) VALUES (?, ?, ?, ?, 'h', ?)`);
    let created = 0;
    let createdHours = 0;
    const tx = db.transaction(() => {
      for (const component of components) {
        templates.forEach((tpl, idx) => {
          const operationName = tpl.operation_name;
          const key = `${Number(component.id)}:${operationName}`;
          if (existingKeys.has(key)) return;
          const meta = inferOperationMeta(operationName);
          const operationType = tpl.operation_type || meta.type;
          const standardHours = Number(tpl.standard_hours) || 0;
          const workerCount = Number(tpl.worker_count) || 1;
          const workstationId = workstationFor(tpl.default_station_type || operationType);
          const result = insert.run(
            instanceId,
            component.id,
            operationName,
            operationType,
            Number(tpl.sequence_hint) || idx + 1,
            standardHours,
            workstationId,
            tpl.required_skill || meta.skill,
            tpl.id || null,
            tpl.required_position_code || null,
            workerCount,
            Number(tpl.qc_required) ? 1 : 0,
            Number(tpl.sop_required) ? 1 : 0,
            Number(tpl.drawing_required) ? 1 : 0,
            Number(component.id) * 100 + idx + 1,
            tpl.description || "按工序模板自动生成"
          );
          created += 1;
          if (standardHours > 0) {
            insertHours.run(result.lastInsertRowid, operationType, standardHours, workerCount, `模板：${operationName}`);
            createdHours += 1;
          }
          existingKeys.add(key);
        });
      }
    });
    tx();
    if (created > 0) {
      audit.record(db, req, {
        action: "process_route.generate_missing",
        resource_type: "equipment_instance",
        resource_id: instanceId,
        after: { created, created_hours: createdHours, templates: templates.length },
        diff_summary: `按工序模板补齐 ${created} 条工序（标准工时 ${createdHours} 条）`,
      });
    }
    res.json({ ok: true, created, created_hours: createdHours, template_count: templates.length });
  }));

}

module.exports = { register };
