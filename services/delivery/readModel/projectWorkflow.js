"use strict";

const { PROCESS_ROUTE_GAPS, assessProcessRoute } = require("../../../app/domain/processRoute");
const { buildDeliveryStage, summarizeDeliveryWorkflow } = require("../../../app/domain/projectDelivery");

function createProjectWorkflowReadModel(ctx, helpers) {
  const { tableExists, has, safeAll } = ctx;
  const {
    count,
    countByStatus,
    pct,
    purchaseFollowupPath,
    purchaseFollowupsForInstance,
    costSummaryForInstance,
    riskBreakdownForProject,
    oeeForInstance,
  } = helpers;

  function appendQuery(path, params) {
    const [base, query = ""] = String(path || "/delivery").split("?");
    const search = new URLSearchParams(query);
    for (const [key, value] of Object.entries(params || {})) {
      if (value !== null && value !== undefined && String(value).trim() !== "") search.set(key, String(value));
    }
    const queryString = search.toString();
    return queryString ? `${base}?${queryString}` : base;
  }

  function projectPath(path, instanceId, stageKey = null) {
    return appendQuery(path, { instance_id: instanceId, from: "delivery", ...(stageKey ? { stage: stageKey } : {}) });
  }

  function workflowBlocker(type, severity, title, message, path, ownerRole, instanceId = null, stageKey = null) {
    const targetPath = instanceId ? projectPath(path, instanceId, stageKey) : path;
    return { type, severity: severity || "warning", title, message: message || title, path: targetPath, owner_role: ownerRole || null };
  }

  function stage(key, label, done, total, path, options = {}) {
    return buildDeliveryStage({
      key,
      label,
      done,
      total,
      path,
      ownerRole: options.owner_role,
      actionLabel: options.action_label,
      blockers: options.blockers || [],
      status: options.status,
    }, pct);
  }

  function bomStatsForInstance(id) {
    if (!tableExists("instance_bom") || !has("instance_bom", "equipment_instance_id")) {
      return { total: 0, done: 0, tier0: 0, tier1: 0, tier2: 0, blockers: [] };
    }
    const rows = safeAll("SELECT id, parent_id, tier, part_number, notes, quantity, material_id FROM instance_bom WHERE equipment_instance_id = ?", [id]);
    const tier0 = rows.filter((r) => Number(r.tier) === 0).length;
    const tier1 = rows.filter((r) => Number(r.tier) === 1).length;
    const tier2 = rows.filter((r) => Number(r.tier) === 2).length;
    const blockers = [];
    const bomPath = projectPath("/bom", id, "bom");
    if (!rows.length) blockers.push(workflowBlocker("bom_missing", "high", "未建立BOM", "需要先建立0级整机、1级部件、2级零件/外购件", bomPath, "工程/设计"));
    else {
      if (!tier0) blockers.push(workflowBlocker("bom_tier0_missing", "high", "缺0级整机", "BOM必须有整机根节点", bomPath, "工程/设计"));
      if (!tier1) blockers.push(workflowBlocker("bom_tier1_missing", "high", "缺1级部件", "TBM至少要按部件/模组拆分", bomPath, "工程/设计"));
      if (!tier2) blockers.push(workflowBlocker("bom_tier2_missing", "warning", "缺2级零件/外购件", "部件下需要展开到零件/外购件，才能驱动采购、齐套和成本", bomPath, "工程/设计"));
    }
    const done = blockers.length ? Math.max(0, rows.length - blockers.length) : rows.length;
    return { total: rows.length, done, tier0, tier1, tier2, blockers };
  }

  function processRouteSummaryForInstance(id) {
    const blockers = [];
    if (!tableExists("instance_bom") || !tableExists("process_nodes")) {
      blockers.push(workflowBlocker("route_missing_table", "warning", "工艺路线基础表未就绪", "需要先建立BOM和工序数据", projectPath("/process-tree", id, "process"), "工艺/生产"));
      return { component_count: 0, complete_count: 0, operation_count: 0, standard_man_hours: 0, blockers };
    }
    const bomRows = has("instance_bom", "equipment_instance_id")
      ? safeAll("SELECT id, parent_id, tier, part_number, notes, material_id FROM instance_bom WHERE equipment_instance_id = ?", [id])
      : [];
    const components = bomRows.filter((row) => Number(row.tier) === 1);
    const children = new Map();
    for (const row of bomRows) {
      const parentId = row.parent_id == null ? null : Number(row.parent_id);
      if (!children.has(parentId)) children.set(parentId, []);
      children.get(parentId).push(Number(row.id));
    }
    function scopeIds(rootId) {
      const ids = new Set([Number(rootId)]);
      const stack = [...(children.get(Number(rootId)) || [])];
      while (stack.length) {
        const next = stack.pop();
        if (ids.has(next)) continue;
        ids.add(next);
        stack.push(...(children.get(next) || []));
      }
      return ids;
    }
    const processRows = has("process_nodes", "equipment_instance_id")
      ? safeAll("SELECT * FROM process_nodes WHERE equipment_instance_id = ?", [id])
      : [];
    if (!components.length) {
      blockers.push(workflowBlocker("route_no_components", "high", "无法按部件建立工艺", "BOM缺少1级部件，工艺路线无法按装配单元展开", projectPath("/bom", id, "bom"), "工程/工艺"));
    }
    let complete = 0;
    let standardManHours = 0;
    for (const component of components) {
      const scope = scopeIds(component.id);
      const operations = processRows.filter((op) => op.bom_node_id && scope.has(Number(op.bom_node_id)));
      const assessment = assessProcessRoute(component, operations, "compact");
      const missing = assessment.missing;
      standardManHours += operations.reduce((sum, op) => sum + Number(op.standard_man_hours || op.estimated_hours || 0), 0);
      if (assessment.ok) complete += 1;
      else {
        const name = component.part_number || component.notes || `部件#${component.id}`;
        blockers.push(workflowBlocker("route_component_incomplete", assessment.gap_codes.includes(PROCESS_ROUTE_GAPS.NO_OPERATIONS) ? "high" : "warning", `${name} 工艺不完整`, missing.join("、"), projectPath("/process-tree", id, "process"), "工艺/生产"));
      }
    }
    return {
      component_count: components.length,
      complete_count: complete,
      operation_count: processRows.length,
      standard_man_hours: Math.round(standardManHours * 100) / 100,
      blockers: blockers.slice(0, 20),
    };
  }

  function buildProject(instance, exceptions) {
    const id = Number(instance.id);

    function statusDone(table, instanceColumn, doneStatuses) {
      const by = countByStatus(table, instanceColumn, id);
      const total = Object.values(by).reduce((a, b) => a + b, 0);
      const done = doneStatuses.reduce((s, st) => s + Number(by[st] || 0), 0);
      return { total, done, by_status: by };
    }

    function countByInstance(table, cols = ["equipment_instance_id", "instance_id"]) {
      if (!tableExists(table)) return 0;
      const col = cols.find((c) => has(table, c));
      return col ? count(table, `${col} = ?`, [id]) : 0;
    }

    function doneByInstance(table, statuses, cols = ["equipment_instance_id", "instance_id"]) {
      if (!tableExists(table) || !has(table, "status")) return 0;
      const col = cols.find((c) => has(table, c));
      if (!col) return 0;
      const marks = statuses.map(() => "?").join(",");
      return count(table, `${col} = ? AND status IN (${marks})`, [id, ...statuses]);
    }

    const workOrders = statusDone("work_orders", "equipment_instance_id", ["completed", "closed"]);
    const processNodes = statusDone("process_nodes", "equipment_instance_id", ["completed", "done"]);
    const bomStats = bomStatsForInstance(id);
    const routeSummary = processRouteSummaryForInstance(id);

    const docCol = has("documents", "equipment_instance_id") ? "equipment_instance_id" : has("documents", "instance_id") ? "instance_id" : null;
    const docTotal = docCol ? count("documents", `${docCol} = ?`, [id]) : 0;
    const docIssued = docCol && has("documents", "status") ? count("documents", `${docCol} = ? AND status IN ('issued', 'active', 'approved')`, [id]) : 0;

    const poTotal = countByInstance("purchase_orders");
    const poDone = doneByInstance("purchase_orders", ["received", "closed", "done"]);

    const projectExceptions = exceptions.filter((e) => Number(e.instance_id) === id && e.case_status !== "closed");
    const projectPurchaseFollowUps = purchaseFollowupsForInstance(id);
    const purchaseRisk = projectExceptions.filter((e) => e.type === "purchase_delay").length;
    const shortageCount = projectExceptions.filter((e) => e.type === "kit_shortage").length;
    const kitDone = shortageCount || purchaseRisk ? 0 : 1;

    const reportTable = ["work_order_operations", "process_reports", "operation_reports", "process_work_reports"].find(tableExists);
    const reportTotal = reportTable ? countByInstance(reportTable, ["equipment_instance_id", "instance_id"]) : 0;
    const reportDone = reportTotal;

    const qcTotal = countByInstance("qc_inspections");
    const qcPass = has("qc_inspections", "result") ? count("qc_inspections", "equipment_instance_id = ? AND result IN ('pass', 'passed', '合格')", [id]) : 0;

    const costTable = ["cost_rollups", "cost_allocations", "project_costs", "cost_items"].find(tableExists);
    const costTotal = costTable ? countByInstance(costTable) : 0;
    const costDone = costTotal;
    const cost = costSummaryForInstance(instance);

    const acceptanceTable = ["acceptance_records", "customer_acceptance", "tbm_acceptance"].find(tableExists);
    const acceptanceTotal = acceptanceTable ? countByInstance(acceptanceTable) : 0;
    const acceptanceDone = acceptanceTable ? doneByInstance(acceptanceTable, ["accepted", "passed", "closed", "done"]) : 0;

    const contractBlockers = [];
    if (!instance.instance_code) contractBlockers.push(workflowBlocker("contract_no_code", "warning", "缺项目编码", "实例编码是合同、采购、成本归集的主线索引", projectPath("/instances", id, "contract"), "项目经理"));
    if (!instance.customer_name) contractBlockers.push(workflowBlocker("contract_no_customer", "warning", "缺客户信息", "建议补齐客户，便于验收和售后追溯", projectPath("/instances", id, "contract"), "销售/项目"));

    const docBlockers = [];
    if (!docTotal) docBlockers.push(workflowBlocker("doc_missing", "high", "未上传图纸/工艺文件", "现场不能靠线下文件传递，至少绑定图纸、SOP、检验标准", projectPath("/documents", id, "documents"), "工程/文控"));
    else if (docIssued < docTotal) docBlockers.push(workflowBlocker("doc_unissued", "warning", `${docTotal - docIssued}份文件未签发`, "未签发文件不能作为现场执行依据", projectPath("/documents", id, "documents"), "文控/工程"));

    const purchaseBlockers = [];
    if (!poTotal && bomStats.total > 0) purchaseBlockers.push(workflowBlocker("po_missing", "warning", "未形成采购单", "BOM已有数据但没有采购跟催对象", projectPath("/purchase", id, "purchase"), "采购"));
    if (purchaseRisk) purchaseBlockers.push(workflowBlocker("po_overdue", "high", `${purchaseRisk}项采购延期`, "采购延期会直接影响齐套和排程", projectPath("/purchase", id, "purchase"), "采购"));
    const blockingPurchaseFollowUps = projectPurchaseFollowUps.filter((row) => row.is_blocking);
    if (blockingPurchaseFollowUps.length) {
      const missingOwner = blockingPurchaseFollowUps.filter((row) => !row.has_owner).length;
      const missingEta = blockingPurchaseFollowUps.filter((row) => !row.has_eta).length;
      const overdueCount = blockingPurchaseFollowUps.filter((row) => row.is_overdue).length;
      const pendingCount = blockingPurchaseFollowUps.filter((row) => row.tracking_status === "pending").length;
      const hint = [
        missingOwner ? `${missingOwner}项缺责任人` : null,
        missingEta ? `${missingEta}项缺ETA` : null,
        overdueCount ? `${overdueCount}项已逾期` : null,
        pendingCount ? `${pendingCount}项待启动` : null,
      ].filter(Boolean).join("；");
      purchaseBlockers.push(workflowBlocker(
        "purchase_followup_open",
        overdueCount ? "high" : "warning",
        `${blockingPurchaseFollowUps.length}项采购跟催未达受控`,
        hint || "BOM风险催办、缺料责任分派和ETA应在采购跟催清单统一闭环",
        purchaseFollowupPath(id),
        "采购"
      ));
    }

    const kitBlockers = [];
    if (shortageCount) kitBlockers.push(workflowBlocker("kit_shortage", "high", `${shortageCount}项缺料未闭环`, "缺料需要进入采购跟催或替代料评审", projectPath("/kit-closure", id, "kit"), "仓库/采购"));

    const woBlockers = [];
    if (!workOrders.total) woBlockers.push(workflowBlocker("wo_missing", "warning", "未生成工单", "BOM和工艺确认后应生成工单并派发到工位/人员", projectPath("/work-orders", id, "work_orders"), "生产计划"));
    const woDelay = projectExceptions.filter((e) => e.type === "delivery_delay").length;
    if (woDelay) woBlockers.push(workflowBlocker("wo_delay", "high", `${woDelay}个工单延期`, "需要重新排程或升级资源冲突", projectPath("/work-orders", id, "work_orders"), "生产计划"));

    const reportBlockers = [];
    if (workOrders.total && !reportTotal) reportBlockers.push(workflowBlocker("report_missing", "warning", "工单未形成报工明细", "车间需要按工序扫码报工，沉淀实际工时", projectPath("/process-hours", id, "report"), "车间班组"));

    const qcBlockers = [];
    if (!qcTotal && workOrders.total) qcBlockers.push(workflowBlocker("qc_missing", "warning", "未登记质检记录", "关键件、过程检和出厂检需要形成电子记录", projectPath("/quality", id, "quality"), "质量"));
    const ncrCount = projectExceptions.filter((e) => e.type === "quality_ncr").length;
    if (ncrCount) qcBlockers.push(workflowBlocker("ncr_open", "high", `${ncrCount}个NCR未闭环`, "NCR需完成处置、CAPA、复检和关闭", projectPath("/quality", id, "quality"), "质量"));

    const costBlockers = [];
    if (!costTotal && cost.actual_amount <= 0) costBlockers.push(workflowBlocker("cost_missing", "warning", "未归集成本", "材料、人工、外协、折旧、质量损失应归集到项目/设备", projectPath("/cost", id, "cost"), "财务/项目"));
    if (cost.risk_level !== "normal") costBlockers.push(workflowBlocker("cost_variance", cost.risk_level, `成本偏差 ${cost.variance_pct}%`, "实际成本相对挣值预算偏离，需要复核材料、人工、外协和返工", projectPath("/cost", id, "cost"), "财务/项目"));

    const acceptanceBlockers = [];
    if (!acceptanceTotal && Number(instance.progress_pct || 0) >= 80) acceptanceBlockers.push(workflowBlocker("acceptance_missing", "warning", "未建立客户验收记录", "总装/调试后应形成客户验收、整改和交付记录", projectPath("/tbm-advanced", id, "acceptance"), "项目/售后"));

    const riskBreakdown = riskBreakdownForProject(instance, exceptions);
    const progress = Number(instance.progress_pct || 0) || pct(workOrders.done + processNodes.done, workOrders.total + processNodes.total);
    const stages = [
      stage("contract", "合同/项目", contractBlockers.length ? 0 : 1, 1, projectPath("/instances", id, "contract"), { owner_role: "项目经理", action_label: "补项目档案", blockers: contractBlockers }),
      stage("bom", "BOM", bomStats.done, Math.max(bomStats.total, 1), projectPath("/bom", id, "bom"), { owner_role: "工程/设计", action_label: "维护BOM", blockers: bomStats.blockers }),
      stage("documents", "图纸", docIssued, Math.max(docTotal, 1), projectPath("/documents", id, "documents"), { owner_role: "工程/文控", action_label: "签发图纸", blockers: docBlockers }),
      stage("process", "工艺", routeSummary.complete_count, Math.max(routeSummary.component_count, 1), projectPath("/process-tree", id, "process"), { owner_role: "工艺/生产", action_label: "补工艺路线", blockers: routeSummary.blockers }),
      stage("purchase", "采购", poDone, Math.max(poTotal, 1), projectPath("/purchase", id, "purchase"), { owner_role: "采购", action_label: "采购跟催", blockers: purchaseBlockers }),
      stage("kit", "齐套", kitDone, 1, projectPath("/kit-closure", id, "kit"), { owner_role: "仓库/采购", action_label: "处理缺料", blockers: kitBlockers }),
      stage("work_orders", "工单", workOrders.done, Math.max(workOrders.total, 1), projectPath("/work-orders", id, "work_orders"), { owner_role: "生产计划", action_label: "派发工单", blockers: woBlockers }),
      stage("report", "报工", Math.max(reportDone, workOrders.done), Math.max(reportTotal, workOrders.done, 1), projectPath("/process-hours", id, "report"), { owner_role: "车间班组", action_label: "扫码报工", blockers: reportBlockers }),
      stage("quality", "质检", qcPass, Math.max(qcTotal, 1), projectPath("/quality", id, "quality"), { owner_role: "质量", action_label: "处理质检", blockers: qcBlockers }),
      stage("cost", "成本", costDone || (cost.actual_amount > 0 ? 1 : 0), Math.max(costTotal, cost.actual_amount > 0 ? 1 : 0, 1), projectPath("/cost", id, "cost"), { owner_role: "财务/项目", action_label: "复核成本", blockers: costBlockers }),
      stage("acceptance", "验收", acceptanceDone, Math.max(acceptanceTotal, 1), projectPath("/tbm-advanced", id, "acceptance"), { owner_role: "项目/售后", action_label: "登记验收", blockers: acceptanceBlockers }),
    ];
    const workflow = summarizeDeliveryWorkflow(stages);

    return {
      id,
      instance_code: instance.instance_code,
      instance_name: instance.instance_name,
      customer_name: instance.customer_name,
      status: instance.status,
      lifecycle_stage: instance.lifecycle_stage,
      progress_pct: Math.max(0, Math.min(100, progress)),
      risk_score: riskBreakdown.score,
      risk_level: riskBreakdown.risk_level,
      workflow_status: workflow.status,
      workflow_blockers: workflow.blockers,
      workflow_blocker_count: workflow.blocker_count,
      exception_count: projectExceptions.length,
      risk_breakdown: riskBreakdown,
      oee_30d: oeeForInstance(id),
      metrics: {
        contract: { total: 1, done: contractBlockers.length ? 0 : 1 },
        bom: { total: bomStats.total, done: bomStats.done, tier0: bomStats.tier0, tier1: bomStats.tier1, tier2: bomStats.tier2 },
        documents: { total: docTotal, issued: docIssued, done: docIssued },
        process_route: routeSummary,
        purchase: { total: poTotal, done: poDone },
        purchase_followup: {
          total: projectPurchaseFollowUps.length,
          overdue: projectPurchaseFollowUps.filter((row) => Number(row.delay_days || 0) > 0 && row.tracking_status !== "delivered" && row.tracking_status !== "cancelled").length,
        },
        kit: { total: 1, done: kitDone },
        work_orders: workOrders,
        process_nodes: processNodes,
        report: { total: Math.max(reportTotal, workOrders.done), done: Math.max(reportDone, workOrders.done) },
        quality: { total: qcTotal, pass: qcPass, done: qcPass },
        cost: { total: costTotal, done: costDone, variance_pct: cost.variance_pct, actual_amount: cost.actual_amount },
        acceptance: { total: acceptanceTotal, done: acceptanceDone },
      },
      stages,
      top_exceptions: projectExceptions.slice(0, 5),
    };
  }

  return {
    buildProject,
  };
}

module.exports = { createProjectWorkflowReadModel };
