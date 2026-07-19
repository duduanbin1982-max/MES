"use strict";

const { DEFAULT_DOC_FOLDERS, DEFAULT_MILESTONES } = require("./catalog");
const { hasTable, tableColumns } = require("./schema");

function createInstanceFactory({ db, all, get, run, ApiError, nextInstanceCode, templateStore }) {
  function ensureNotFrozen(id) {
    const instance = get("SELECT archive_status, frozen_at FROM equipment_instances WHERE id = ?", id);
    if (!instance) throw ApiError.notFound("项目装备不存在");
    if (instance.archive_status === "archived" || instance.frozen_at) {
      throw ApiError.validation("该项目装备已冻结/归档，禁止修改历史基线");
    }
    return instance;
  }

  function createDefaultMilestones(instanceId, plannedStart, plannedEnd) {
    const existing = get("SELECT COUNT(*) AS count FROM equipment_instance_milestones WHERE project_id = ?", instanceId).count;
    if (existing > 0) return;
    const statement = db.prepare(`
      INSERT INTO equipment_instance_milestones
        (project_id, phase_code, phase_name, sequence, planned_start, planned_end, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const [code, name, sequence] of DEFAULT_MILESTONES) {
      statement.run(
        instanceId,
        code,
        name,
        sequence,
        plannedStart || null,
        plannedEnd || null,
        sequence === 10 ? "active" : "pending",
        "实例创建向导自动生成"
      );
    }
  }

  function createBomShell(instanceId, instanceCode, instanceName) {
    if (!hasTable(db, "instance_bom")) return;
    const existing = get("SELECT COUNT(*) AS count FROM instance_bom WHERE equipment_instance_id = ?", instanceId).count;
    if (existing > 0) return;
    run(
      "INSERT INTO instance_bom (equipment_instance_id, parent_id, tier, version, part_number, quantity, unit, category, is_phantom, notes) VALUES (?, NULL, 0, 'A0', ?, 1, '台', '总装成品', 0, ?)",
      [instanceId, instanceCode, instanceName || "总装成品 BOM 空壳"]
    );
  }

  function createDocFolders(instanceId) {
    const statement = db.prepare("INSERT OR IGNORE INTO document_folders (equipment_instance_id, folder_name, folder_type) VALUES (?, ?, ?)");
    for (const folder of DEFAULT_DOC_FOLDERS) statement.run(instanceId, folder, folder);
  }

  function copyMilestones(templateId, instanceId, plannedStart, plannedEnd) {
    const rows = all("SELECT * FROM equipment_instance_milestones WHERE project_id = ? ORDER BY sequence, id", templateId);
    if (!rows.length) return createDefaultMilestones(instanceId, plannedStart, plannedEnd);
    const statement = db.prepare(`
      INSERT INTO equipment_instance_milestones
        (project_id, phase_code, phase_name, sequence, planned_start, planned_end, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of rows) {
      statement.run(
        instanceId,
        row.phase_code,
        row.phase_name,
        row.sequence,
        plannedStart || row.planned_start || null,
        plannedEnd || row.planned_end || null,
        row.sequence === 10 ? "active" : "pending",
        `从模板实例 #${templateId} 复制`
      );
    }
  }

  function copyTreeRows({ table, templateId, instanceId, orderBy, columns, valueFor }) {
    if (!hasTable(db, table)) return;
    const rows = all(`SELECT * FROM ${table} WHERE equipment_instance_id = ? ORDER BY ${orderBy}`, templateId);
    if (!rows.length) return;
    const availableColumns = tableColumns(db, table);
    const copyColumns = columns.filter((column) => availableColumns.has(column));
    const statement = db.prepare(`
      INSERT INTO ${table} (${copyColumns.join(", ")})
      VALUES (${copyColumns.map(() => "?").join(", ")})
    `);
    const idMap = new Map();
    for (const row of rows) {
      const values = copyColumns.map((column) => valueFor(column, row, idMap));
      const result = statement.run(values);
      idMap.set(row.id, result.lastInsertRowid);
    }
  }

  function copyBom(templateId, instanceId) {
    copyTreeRows({
      table: "instance_bom",
      templateId,
      instanceId,
      orderBy: "tier, parent_id, id",
      columns: [
        "equipment_instance_id", "parent_id", "tier", "version", "eco_id", "effective_from", "effective_to",
        "material_id", "part_number", "quantity", "unit", "scrap_factor", "category", "material_grade",
        "surface_treatment", "brand_recommend", "brand_grade", "is_alternative", "alternative_group",
        "alternative_priority", "operation_id", "is_phantom", "is_key_component", "is_wear_part",
        "storage_location", "unit_price", "weight", "notes", "created_by",
      ],
      valueFor(column, row, idMap) {
        if (column === "equipment_instance_id") return instanceId;
        if (column === "parent_id") return row.parent_id ? idMap.get(row.parent_id) || null : null;
        if (column === "notes") return row.notes || `从模板实例 #${templateId} 复制`;
        return row[column];
      },
    });
  }

  function copyProcessNodes(templateId, instanceId) {
    copyTreeRows({
      table: "process_nodes",
      templateId,
      instanceId,
      orderBy: "parent_id, sequence, id",
      columns: [
        "equipment_instance_id", "parent_id", "bom_node_id", "operation_name", "operation_type", "sequence",
        "estimated_hours", "required_workstation_id", "required_skill", "required_materials", "is_milestone",
        "phase_code", "status", "planned_start", "planned_end", "planned_cost", "auto_unblock", "sort_order",
        "notes", "assigned_to", "subsystem_id", "operation_template_id", "required_position_code", "worker_count",
        "qc_required", "sop_required", "drawing_required",
      ],
      valueFor(column, row, idMap) {
        if (column === "equipment_instance_id") return instanceId;
        if (column === "parent_id") return row.parent_id ? idMap.get(row.parent_id) || null : null;
        if (column === "status") return "ready";
        if (column === "notes") return row.notes || `从模板实例 #${templateId} 复制`;
        return row[column];
      },
    });
  }

  const createInstance = db.transaction((body, userId) => {
    const code = body.instance_code || nextInstanceCode(body.customer_name, body.planned_start?.slice(0, 4));
    if (!code || !body.customer_name) throw ApiError.validation("instance_code/customer_name 必填");
    const selectedTemplate = body.template_id ? templateStore.getTemplate(body.template_id) : null;
    if (selectedTemplate && selectedTemplate.status !== "published") throw ApiError.validation("只能使用已发布的项目装备模板");
    const templateSourceId = selectedTemplate?.source_instance_id || body.template_instance_id || null;
    if (templateSourceId && !get("SELECT id FROM equipment_instances WHERE id = ?", templateSourceId)) {
      throw ApiError.validation("模板来源项目装备不存在");
    }

    const selectedScope = selectedTemplate?.copy_scope || null;
    const useFlag = (field, fallback) => body[field] === undefined ? fallback : Boolean(body[field]);
    const options = {
      generateMilestones: useFlag("generate_milestones", selectedScope ? Boolean(selectedScope.milestones) : true),
      createBomShell: useFlag("create_bom_shell", selectedScope ? Boolean(selectedScope.bom_shell) : true),
      createDocDirs: useFlag("create_doc_dirs", selectedScope ? Boolean(selectedScope.doc_dirs) : true),
      copyMilestones: Boolean(templateSourceId) && useFlag("copy_template_milestones", selectedScope ? Boolean(selectedScope.milestones) : false),
      copyBom: Boolean(templateSourceId) && useFlag("copy_template_bom", selectedScope ? Boolean(selectedScope.bom) : false),
      copyProcess: Boolean(templateSourceId) && useFlag("copy_template_process", selectedScope ? Boolean(selectedScope.process) : false),
    };
    const lifecycle = "design";
    const result = run(
      "INSERT INTO equipment_instances (instance_code, instance_name, equipment_model_id, customer_name, customer_contact, site_location, contract_no, contract_amount, start_date, planned_start, planned_end, serial_no, status, lifecycle_stage, project_no, archive_status, notes, source_template_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        code, body.instance_name || code, body.equipment_model_id || null, body.customer_name,
        body.customer_contact || null, body.site_location || null, body.contract_no || null,
        body.contract_amount || null, body.start_date || null, body.planned_start || null,
        body.planned_end || null, body.serial_no || null, lifecycle, lifecycle, body.project_no || null,
        "active", body.notes || null, selectedTemplate?.id || null,
      ]
    );
    const instanceId = result.lastInsertRowid;

    if (templateSourceId) {
      if (options.copyMilestones) copyMilestones(templateSourceId, instanceId, body.planned_start, body.planned_end);
      else if (options.generateMilestones) createDefaultMilestones(instanceId, body.planned_start, body.planned_end);
      if (options.copyBom) copyBom(templateSourceId, instanceId);
      else if (options.createBomShell) createBomShell(instanceId, code, body.instance_name || code);
      if (options.copyProcess) copyProcessNodes(templateSourceId, instanceId);
    } else {
      if (options.generateMilestones) createDefaultMilestones(instanceId, body.planned_start, body.planned_end);
      if (options.createBomShell) createBomShell(instanceId, code, body.instance_name || code);
    }
    if (options.createDocDirs) createDocFolders(instanceId);
    run(
      "INSERT INTO equipment_instance_lifecycle_logs (equipment_instance_id, from_stage, to_stage, reason, changed_by) VALUES (?, NULL, ?, ?, ?)",
      [instanceId, lifecycle, "实例创建向导初始化", userId || null]
    );
    return { id: instanceId, code, lifecycle };
  });

  return { createInstance, ensureNotFrozen };
}

module.exports = { createInstanceFactory };
