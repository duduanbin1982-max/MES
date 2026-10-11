"use strict";
// services/setupWizardService.js
// Blank MES first-day setup checklist.

const { wrap } = require("../middleware/asyncHandler");

const logger = require("../app/logger").createLogger("setupWizardService");

function tableExists(db, name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

const SETUP_ALLOWED_TABLES = new Set(["workstations", "users", "roles", "suppliers", "worker_certificates", "equipment_instances", "shift_schedules", "skill_matrices", "work_orders", "schedule_assignments", "process_nodes", "materials", "material_lots", "inventory", "production_orders", "iot_devices", "iot_data_points", "iot_readings", "iot_alarms", "documents", "quality_check_records", "resource_allocations", "mdm_issue_waivers", "instance_bom"]);

function columns(db, table) {
  if (!SETUP_ALLOWED_TABLES.has(table)) throw new Error("Invalid table name: " + table);
  if (!tableExists(db, table)) return new Set();
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
}

function has(db, table, column) {
  return columns(db, table).has(column);
}

function count(db, table, where = "1=1", params = []) {
  if (!SETUP_ALLOWED_TABLES.has(table)) throw new Error("Invalid table name: " + table);
  if (!tableExists(db, table)) return 0;
  try {
    return db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE ${where}`).get(params).c || 0;
  } catch (_e) {
    return 0;
  }
}

function scalar(db, sql, params = [], fallback = 0) {
  try {
    const row = db.prepare(sql).get(params);
    return row ? Object.values(row)[0] : fallback;
  } catch (_e) {
    return fallback;
  }
}

function pct(done, total) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

function statusOf(progress, severity) {
  if (progress >= 100) return "done";
  if (severity === "critical") return "blocked";
  if (progress > 0) return "partial";
  return "empty";
}

function issue(severity, title, detail, route, ownerRole) {
  return { severity, title, detail, route, owner_role: ownerRole };
}

function maxSeverity(issues) {
  const rank = { critical: 4, high: 3, warning: 2, info: 1 };
  return issues.reduce((max, item) => (rank[item.severity] > rank[max] ? item.severity : max), "info");
}

function step({ id, title, route, progress, metrics, issues, actions, ownerRole, businessGoal }) {
  const severity = issues.length ? maxSeverity(issues) : "info";
  return {
    id,
    title,
    route,
    progress,
    status: statusOf(progress, severity),
    severity,
    owner_role: ownerRole,
    business_goal: businessGoal,
    metrics,
    issues,
    missing: issues.map((item) => item.title),
    actions,
  };
}

function buildSetupStatus(db) {
  const users = count(db, "users");
  const activeUsers = count(db, "users", has(db, "users", "is_active") ? "is_active = 1" : "1=1");
  const roles = count(db, "roles");
  const roleCodes = tableExists(db, "roles")
    ? db.prepare("SELECT role_code FROM roles").all().map((row) => row.role_code)
    : [];
  const requiredRoles = ["admin", "foreman", "engineer", "worker", "qc", "warehouse"];
  const roleDone = requiredRoles.filter((role) => roleCodes.includes(role)).length;

  const workstations = count(db, "workstations", has(db, "workstations", "is_active") ? "is_active = 1" : "1=1");
  const assemblyStations = count(db, "workstations", has(db, "workstations", "station_type") ? "station_type = 'assembly'" : "1=0");
  const weldingStations = count(db, "workstations", has(db, "workstations", "station_type") ? "station_type = 'welding'" : "1=0");
  const inspectionStations = count(db, "workstations", has(db, "workstations", "station_type") ? "station_type = 'inspection'" : "1=0");
  const suppliers = count(db, "suppliers");
  const keySuppliers = count(db, "suppliers", has(db, "suppliers", "category") ? "category = 'key_component'" : "1=0");
  const outsourcingSuppliers = count(db, "suppliers", has(db, "suppliers", "category") ? "category = 'outsourcing'" : "1=0");
  const certificates = count(db, "worker_certificates");

  const materials = count(db, "materials");
  const materialWithCode = count(db, "materials", "material_code IS NOT NULL AND material_code != ''");
  const materialWithSafety = count(db, "materials", "COALESCE(safety_stock, 0) > 0 OR COALESCE(reorder_point, 0) > 0");
  const duplicateMaterialCodes = scalar(db, `
    SELECT COUNT(*) FROM (
      SELECT material_code FROM materials
      WHERE material_code IS NOT NULL AND material_code != ''
      GROUP BY material_code HAVING COUNT(*) > 1
    )
  `);

  const instances = count(db, "equipment_instances");
  const activeInstances = count(db, "equipment_instances", has(db, "equipment_instances", "status") ? "COALESCE(status,'') NOT IN ('cancelled','archived')" : "1=1");
  const lifecycleInstances = count(db, "equipment_instances", has(db, "equipment_instances", "lifecycle_stage") ? "lifecycle_stage IS NOT NULL AND lifecycle_stage != ''" : "1=0");
  const codedInstances = count(db, "equipment_instances", has(db, "equipment_instances", "instance_code") ? "instance_code IS NOT NULL AND instance_code != ''" : "1=0");

  const bomRows = count(db, "instance_bom");
  const bomInstances = scalar(db, "SELECT COUNT(DISTINCT equipment_instance_id) AS c FROM instance_bom");
  const bomTier0 = count(db, "instance_bom", "tier = 0");
  const bomTier1 = count(db, "instance_bom", "tier = 1");
  const bomTier2 = count(db, "instance_bom", "tier = 2");
  const bomWithoutMaterial = count(db, "instance_bom", "tier >= 2 AND material_id IS NULL");

  const docs = count(db, "documents");
  const issuedDocs = count(db, "documents", "status IN ('issued','active','approved')");
  const docsLinked = count(db, "documents", "bom_node_id IS NOT NULL OR equipment_instance_id IS NOT NULL OR instance_id IS NOT NULL");

  const processNodes = count(db, "process_nodes");
  const processWithHours = count(db, "process_nodes", "COALESCE(estimated_hours, 0) > 0");
  const processWithStation = count(db, "process_nodes", "required_workstation_id IS NOT NULL");
  const processWithSkill = count(db, "process_nodes", has(db, "process_nodes", "required_skill") ? "required_skill IS NOT NULL AND required_skill != ''" : "1=0");

  const workOrders = count(db, "work_orders");
  const dispatchedWorkOrders = count(db, "work_orders", "status IN ('released','dispatched','in_progress','completed')");
  const scheduleAssignments = count(db, "schedule_assignments");

  const usersIssues = [
    ...(activeUsers < 6 ? [issue("critical", "至少建立生产主管、工程师、仓库员、质检员、工人、管理员", "否则无法按角色派工、领料、质检和审批。", "/users", "系统管理员")] : []),
    ...(roleDone < requiredRoles.length ? [issue("high", "角色模板不完整", `缺少必备角色 ${requiredRoles.filter((role) => !roleCodes.includes(role)).join("、")}`, "/users", "系统管理员")] : []),
  ];
  const resourceIssues = [
    ...(workstations < 6 ? [issue("critical", "工位/工站数量不足", "至少准备装配、焊接、机加、检验、调试、仓储相关工位。", "/resources", "生产主管")] : []),
    ...(assemblyStations < 1 ? [issue("high", "缺装配工位", "TBM以装配为主，装配工位是工单派发的基础。", "/resources", "生产主管")] : []),
    ...(weldingStations < 1 ? [issue("high", "缺焊接工位", "结构件和关键焊接过程需要独立工位与资质约束。", "/resources", "生产主管")] : []),
    ...(inspectionStations < 1 ? [issue("warning", "缺检验工位", "来料、过程、出厂检验需要可分派的检验资源。", "/resources", "质量主管")] : []),
    ...(suppliers < 3 ? [issue("high", "供应商档案不足", "至少建立关键件、外协、标准件三类供应商。", "/purchase", "采购主管")] : []),
    ...(keySuppliers < 1 ? [issue("warning", "缺关键件供应商分类", "主轴承、液压、电气等关键件需要独立跟催和证书管理。", "/purchase", "采购主管")] : []),
    ...(outsourcingSuppliers < 1 ? [issue("warning", "缺外协供应商分类", "外协进度会影响齐套和总装节拍。", "/purchase", "采购主管")] : []),
    ...(certificates < 3 ? [issue("warning", "人员资质证书不足", "焊工、检验、起重等资质应纳入派工约束。", "/labor", "生产/质量")] : []),
  ];
  const materialIssues = [
    ...(materials < 30 ? [issue("critical", "物料主数据不足", "建议先导入标准件、外购件、自制件和辅料基础库。", "/materials", "物料管理员")] : []),
    ...(duplicateMaterialCodes > 0 ? [issue("critical", "存在重复物料编码", "一物一码是库存、BOM、成本和追溯的地基。", "/materials", "物料管理员")] : []),
    ...(materialWithSafety < 10 ? [issue("warning", "安全库存/再订货点覆盖不足", "常用件和长周期物料应配置预警线。", "/materials", "仓库/采购")] : []),
  ];
  const instanceIssues = [
    ...(activeInstances < 1 ? [issue("critical", "至少建立一台 TBM/盾构机项目装备", "后续BOM、图纸、采购、工单和成本都必须归属到项目装备。", "/instances", "项目经理")] : []),
    ...(codedInstances < activeInstances ? [issue("high", "项目装备编码不完整", "建议统一项目号、合同号、序列号、客户、年份规则。", "/instances", "项目经理")] : []),
    ...(lifecycleInstances < activeInstances ? [issue("warning", "生命周期阶段不完整", "建议维护设计中、采购中、制造中、总装中、调试中、验收中、交付、运维。", "/instances", "项目经理")] : []),
  ];
  const bomIssues = [
    ...(bomRows === 0 ? [issue("critical", "尚未导入 BOM", "没有BOM就无法驱动采购、齐套、工艺、成本和追溯。", "/bom", "工程/设计")] : []),
    ...(bomTier0 < 1 ? [issue("critical", "缺少 0 级整机", "BOM根节点必须代表整台TBM。", "/bom", "工程/设计")] : []),
    ...(bomTier1 < 5 ? [issue("high", "1 级部件/模组不足", "建议按机架、刀盘、液压、电气、推进、管片拼装等模组拆分。", "/bom", "工程/设计")] : []),
    ...(bomTier2 < 20 ? [issue("high", "2 级零件/外购件不足", "部件下必须展开到零件/外购件，才能采购和领料。", "/bom", "工程/设计")] : []),
    ...(bomWithoutMaterial > 0 ? [issue("warning", "部分2级BOM未绑定物料主数据", "会影响采购、库存和成本归集。", "/bom", "工程/设计")] : []),
  ];
  const docIssues = [
    ...(docs < 5 ? [issue("critical", "图纸/SOP/检验标准数量不足", "现场必须查看最新版图纸、工艺和检验标准。", "/documents", "文控/工程")] : []),
    ...(issuedDocs < 3 ? [issue("high", "签发文档不足", "未签发文件不能作为生产依据。", "/documents", "文控/工程")] : []),
    ...(docsLinked < 5 ? [issue("warning", "文档未充分绑定装备/BOM节点", "图号、BOM节点和文件版本需要可追溯。", "/documents", "文控/工程")] : []),
  ];
  const processIssues = [
    ...(processNodes < 30 ? [issue("critical", "工艺节点不足", "至少要覆盖主要部件的装配、焊接、机加、检验、调试工序。", "/process-tree", "工艺工程师")] : []),
    ...(processWithHours < 20 ? [issue("high", "标准工时覆盖不足", "没有标准工时就无法做产能、成本和绩效分析。", "/process-tree", "工艺工程师")] : []),
    ...(processWithStation < 20 ? [issue("high", "工位绑定不足", "工序必须绑定工位才能排程和派工。", "/process-tree", "工艺/生产")] : []),
    ...(processWithSkill < 20 ? [issue("warning", "技能/工种约束不足", "焊接、检验等关键工序应受人员资质约束。", "/process-tree", "工艺/质量")] : []),
  ];
  const orderIssues = [
    ...(workOrders < 5 ? [issue("critical", "工单数量不足", "工艺确认后应生成工单并下发到工位/人员。", "/work-orders", "生产计划")] : []),
    ...(dispatchedWorkOrders < 3 ? [issue("high", "已下发/执行工单不足", "工单需要进入派工、领料、报工闭环。", "/work-orders", "生产计划")] : []),
    ...(scheduleAssignments < 5 ? [issue("warning", "排程指派不足", "建议按周计划把工序级任务排到工位和人员。", "/schedule", "生产计划")] : []),
  ];

  const steps = [
    step({ id: "users_roles", title: "1. 用户和角色权限", route: "/users", progress: pct(Math.min(activeUsers, 6) + roleDone, 12), metrics: {
      active_users: activeUsers, roles, required_roles: roleDone + "/" + requiredRoles.length,
    }, issues: usersIssues, actions: [
      { label: "用户管理", route: "/users", primary: true },
      { label: "审计日志", route: "/audit" },
    ], ownerRole: "系统管理员", businessGoal: "先把谁能看、谁能改、谁审批定下来。" }),
    step({ id: "resources_suppliers", title: "2. 工位、人员、供应商", route: "/resources", progress: pct(Math.min(workstations, 6) + Math.min(suppliers, 3) + Math.min(certificates, 3), 12), metrics: {
      workstations, assembly_stations: assemblyStations, welding_stations: weldingStations, inspection_stations: inspectionStations, suppliers, key_suppliers: keySuppliers, outsourcing_suppliers: outsourcingSuppliers, certificates,
    }, issues: resourceIssues, actions: [
      { label: "资源看板", route: "/resources", primary: true },
      { label: "供应商管理", route: "/purchase" },
      { label: "劳动力管理", route: "/labor" },
    ], ownerRole: "生产主管/采购主管", businessGoal: "准备可排程的工位、可派工的人员、可跟催的供应商。" }),
    step({ id: "materials", title: "3. 物料主数据", route: "/materials", progress: pct(Math.min(materialWithCode, 30) + Math.min(materialWithSafety, 10) - Math.min(duplicateMaterialCodes, 10), 40), metrics: {
      materials, material_with_code: materialWithCode, material_with_safety: materialWithSafety, duplicate_codes: duplicateMaterialCodes,
    }, issues: materialIssues, actions: [
      { label: "物料中心", route: "/materials", primary: true },
      { label: "物料预警", route: "/material-alerts" },
      { label: "主数据治理", route: "/mdm" },
    ], ownerRole: "物料管理员", businessGoal: "统一一物一码、分类、单位、库存预警。" }),
    step({ id: "instances", title: "4. 项目装备", route: "/instances", progress: pct(Math.min(activeInstances, 1) + Math.min(codedInstances, activeInstances) + Math.min(lifecycleInstances, activeInstances), Math.max(activeInstances * 3, 1)), metrics: {
      instances, active_instances: activeInstances, coded_instances: codedInstances, lifecycle_instances: lifecycleInstances,
    }, issues: instanceIssues, actions: [
      { label: "项目装备", route: "/instances", primary: true },
      { label: "项目交付闭环", route: "/delivery" },
    ], ownerRole: "项目经理", businessGoal: "建立一台TBM作为合同、BOM、图纸、采购、工单、成本的主线。" }),
    step({ id: "bom", title: "5. 导入 BOM", route: "/bom", progress: pct(Math.min(bomTier0, 1) + Math.min(bomTier1, 5) + Math.min(bomTier2, 20) - Math.min(bomWithoutMaterial, 5), 26), metrics: {
      bom_rows: bomRows, bom_instances: bomInstances, tier0: bomTier0, tier1: bomTier1, tier2: bomTier2, bom_without_material: bomWithoutMaterial,
    }, issues: bomIssues, actions: [
      { label: "BOM 管理", route: "/bom", primary: true },
      { label: "PLM 图纸", route: "/plm" },
    ], ownerRole: "工程/设计", businessGoal: "形成0级整机、1级部件、2级零件/外购件的树状BOM。" }),
    step({ id: "documents", title: "6. 绑定图纸/文档", route: "/documents", progress: pct(Math.min(docs, 5) + Math.min(issuedDocs, 3) + Math.min(docsLinked, 5), 13), metrics: {
      documents: docs, issued_docs: issuedDocs, linked_docs: docsLinked,
    }, issues: docIssues, actions: [
      { label: "文档/图纸", route: "/documents", primary: true },
      { label: "BOM 管理", route: "/bom" },
    ], ownerRole: "文控/工程", businessGoal: "让现场看到最新版图纸、SOP、检验标准，并能签收追溯。" }),
    step({ id: "process", title: "7. 建工艺路线", route: "/process-tree", progress: pct(Math.min(processNodes, 30) + Math.min(processWithHours, 20) + Math.min(processWithStation, 20) + Math.min(processWithSkill, 20), 90), metrics: {
      process_nodes: processNodes, with_hours: processWithHours, with_station: processWithStation, with_skill: processWithSkill,
    }, issues: processIssues, actions: [
      { label: "工艺树", route: "/process-tree", primary: true },
      { label: "工时与报工", route: "/process-hours" },
    ], ownerRole: "工艺工程师", businessGoal: "明确每个部件经过哪些工序、标准工时、工位和技能要求。" }),
    step({ id: "orders_schedule", title: "8. 生成工单和排程", route: "/work-orders", progress: pct(Math.min(workOrders, 5) + Math.min(dispatchedWorkOrders, 3) + Math.min(scheduleAssignments, 5), 13), metrics: {
      work_orders: workOrders, dispatched_work_orders: dispatchedWorkOrders, schedule_assignments: scheduleAssignments,
    }, issues: orderIssues, actions: [
      { label: "工单管理", route: "/work-orders", primary: true },
      { label: "项目排程", route: "/schedule" },
      { label: "齐套缺料", route: "/kit-closure" },
    ], ownerRole: "生产计划", businessGoal: "把BOM和工艺转成可执行工单、排程、领料和报工。" }),
  ];

  const overall = Math.round(steps.reduce((sum, item) => sum + item.progress, 0) / steps.length);
  const blockerCount = steps.reduce((sum, item) => sum + item.issues.filter((i) => i.severity === "critical" || i.severity === "high").length, 0);
  const issueCount = steps.reduce((sum, item) => sum + item.issues.length, 0);
  const nextStep = steps.find((item) => item.status === "blocked") || steps.find((item) => item.progress < 100) || null;
  return {
    overall,
    status: statusOf(overall, blockerCount ? "critical" : "info"),
    generated_at: new Date().toISOString(),
    summary: {
      step_count: steps.length,
      done_steps: steps.filter((item) => item.status === "done").length,
      blocked_steps: steps.filter((item) => item.status === "blocked").length,
      issue_count: issueCount,
      blocker_count: blockerCount,
    },
    steps,
    next_step: nextStep,
    exit_actions: [
      { label: "进入项目交付闭环", route: "/delivery" },
      { label: "查看异常中心", route: "/exceptions" },
      { label: "主数据治理", route: "/mdm" },
    ],
  };
}

function register(app, db) {
  app.get("/api/setup/status", wrap((req, res) => {
    res.json(buildSetupStatus(db));
  }));
  logger.info("[setupWizardService] registered");
}

module.exports = { register, buildSetupStatus };
