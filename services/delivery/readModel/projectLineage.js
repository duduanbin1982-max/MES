"use strict";

function createProjectLineageReadModel(ctx, deps) {
  const { tableExists, has, safeAll } = ctx;
  const { pct, buildProject, costSummaryForInstance } = deps;

  function buildProjectLineage(instance, exceptions) {
    const id = Number(instance.id);
    const gaps = [];
    const segments = [];
    const appendQuery = (path, params) => {
      const [base, query = ""] = String(path || "/delivery").split("?");
      const search = new URLSearchParams(query);
      for (const [key, value] of Object.entries(params || {})) {
        if (value !== null && value !== undefined && String(value).trim() !== "") search.set(key, String(value));
      }
      const queryString = search.toString();
      return queryString ? `${base}?${queryString}` : base;
    };
    const fixTemplates = {
      contract: { module: "装备实例", label: "完善项目档案", path: "/instances", checklist: ["补齐项目编码/合同号/序列号", "确认客户与计划节点", "保存后返回交付看板复检"] },
      bom: { module: "BOM 管理", label: "修复 BOM 结构", path: "/bom", checklist: ["建立 0级整机、1级部件、2级零件", "补齐物料或图号", "校验层级和虚拟件"] },
      documents: { module: "文档/图纸", label: "上传/签发/绑定图纸", path: "/documents", checklist: ["上传图纸/SOP/检验标准", "绑定装备实例和 BOM 节点", "签发并要求现场签收"] },
      process: { module: "工艺路线", label: "补工艺路线/工时/工位", path: "/process-tree", checklist: ["按 1级部件建立工序", "补标准工时", "指定装配/焊接/检验工位"] },
      purchase: { module: "采购跟催", label: "生成采购/跟催", path: "/purchase?tab=followup", checklist: ["由 BOM 生成采购需求", "补物料和 BOM 关联", "指定 ETA 与跟催责任人"] },
      kit: { module: "齐套缺料", label: "处理缺料闭环", path: "/kit-closure", checklist: ["分派缺料责任人", "回写预计到货日期", "生成或关联采购催办"] },
      work_orders: { module: "工单管理", label: "生成/派发工单", path: "/work-orders", checklist: ["由工艺路线生成工单", "指定工位和人员", "补预计工时"] },
      report: { module: "工时与报工", label: "补工序级报工", path: "/process-hours", checklist: ["扫码或录入工序报工", "补实际工时", "同步完工进度"] },
      quality: { module: "质检管理", label: "补检验/NCR 闭环", path: "/quality", checklist: ["录入来料/过程/出厂检验", "关闭 NCR/CAPA", "绑定工单和批次"] },
      cost: { module: "成本归集", label: "补成本归集", path: "/cost", checklist: ["归集材料/人工/外协/折旧", "绑定项目/BOM 节点", "复核成本偏差"] },
      trace: { module: "端到端追溯", label: "补批次谱系", path: "/trace", checklist: ["记录 lot_id/serial_no", "绑定发料、工单和装配位置", "支持正反向追溯"] },
      acceptance: { module: "客户验收", label: "补验收记录", path: "/tbm-advanced?tab=accept", checklist: ["建立客户验收单", "记录整改项", "完成交付/运维移交"] },
    };
    const fixEntryFor = (segment, path, ownerRole) => {
      const template = fixTemplates[segment] || { module: ownerRole || "业务模块", label: "进入处理", path: path || "/delivery", checklist: [] };
      const preferTemplatePath = segment === "purchase" && (!path || path === "/purchase");
      const targetPath = preferTemplatePath ? template.path : (path || template.path);
      return {
        module: template.module,
        label: template.label,
        path: appendQuery(targetPath, { instance_id: id, from: "delivery-lineage", segment }),
        owner_role: ownerRole || null,
        checklist: template.checklist,
      };
    };
    const addGap = (segment, severity, title, message, path, ownerRole, count = 1, samples = []) => {
      gaps.push({
        id: `${segment}_${gaps.length + 1}`,
        segment,
        severity,
        title,
        message,
        path,
        action_path: fixEntryFor(segment, path, ownerRole).path,
        fix_entry: fixEntryFor(segment, path, ownerRole),
        owner_role: ownerRole || null,
        count,
        samples: samples.slice(0, 8),
      });
    };
    const addSegment = (key, label, total, linked, path, ownerRole) => {
      const segmentGaps = gaps.filter((gap) => gap.segment === key);
      const criticalOrHigh = segmentGaps.some((gap) => gap.severity === "critical" || gap.severity === "high");
      const status = criticalOrHigh ? "blocked" : segmentGaps.length ? "warning" : total <= 0 ? "empty" : "ok";
      segments.push({
        key,
        label,
        total,
        linked,
        percent: pct(Math.max(0, linked), Math.max(total, 1)),
        status,
        path,
        action_path: fixEntryFor(key, path, ownerRole).path,
        fix_entry: fixEntryFor(key, path, ownerRole),
        owner_role: ownerRole,
        gap_count: segmentGaps.length,
        severe_gap_count: segmentGaps.filter((gap) => gap.severity === "critical" || gap.severity === "high").length,
      });
    };
    const missing = (value) => value === null || value === undefined || String(value).trim() === "";

    const contractFields = [
      ["instance_code", "项目编码"],
      ["instance_name", "项目名称"],
      ["customer_name", "客户"],
      ["contract_no", "合同号"],
      ["serial_no", "设备序列号"],
    ];
    const missingContract = contractFields.filter(([field]) => missing(instance[field]));
    if (missingContract.length) {
      addGap("contract", missingContract.some(([field]) => field === "instance_code" || field === "instance_name") ? "high" : "warning", "项目档案主键不完整", `缺少 ${missingContract.map(([, label]) => label).join("、")}，会影响合同、成本、验收、售后统一追踪`, "/instances", "项目经理", missingContract.length);
    }
    addSegment("contract", "合同/项目", contractFields.length, contractFields.length - missingContract.length, "/instances", "项目经理");

    const bomRows = tableExists("instance_bom") && has("instance_bom", "equipment_instance_id")
      ? safeAll("SELECT id, parent_id, tier, material_id, part_number, is_phantom, quantity FROM instance_bom WHERE equipment_instance_id = ? ORDER BY tier, id", [id])
      : [];
    const bomTier0 = bomRows.filter((row) => Number(row.tier) === 0).length;
    const bomTier1 = bomRows.filter((row) => Number(row.tier) === 1).length;
    const bomTier2 = bomRows.filter((row) => Number(row.tier) === 2).length;
    const bomMissingIdentity = bomRows.filter((row) => Number(row.tier) >= 2 && !Number(row.is_phantom || 0) && !row.material_id && missing(row.part_number));
    if (!bomRows.length) addGap("bom", "high", "未建立 BOM", "盾构机项目必须先建立 0级整机、1级部件、2级零件/外购件，后续采购/齐套/成本都依赖 BOM", "/bom", "工程/设计");
    if (bomRows.length && !bomTier0) addGap("bom", "high", "缺 0 级整机", "BOM 根节点缺失，整机成本和发货结构无法闭合", "/bom", "工程/设计");
    if (bomRows.length && !bomTier1) addGap("bom", "high", "缺 1 级部件", "TBM 应按刀盘、盾体、主驱动、液压、电气等部件/模组拆分", "/bom", "工程/设计");
    if (bomRows.length && !bomTier2) addGap("bom", "warning", "缺 2 级零件/外购件", "采购、齐套和成本需要展开到零件/外购件层级", "/bom", "工程/设计");
    if (bomMissingIdentity.length) addGap("bom", "warning", "BOM 明细缺物料/图号", "2级及以下明细应至少绑定物料编码或图号/型号，避免采购和库存无法识别", "/bom", "工程/设计", bomMissingIdentity.length, bomMissingIdentity.map((row) => `BOM#${row.id}`));
    addSegment("bom", "BOM结构", Math.max(bomRows.length, 1), Math.max(0, bomRows.length - bomMissingIdentity.length), "/bom", "工程/设计");

    const documentRows = tableExists("documents") && has("documents", "equipment_instance_id")
      ? safeAll("SELECT id, bom_node_id, status, doc_type, title, doc_name, version FROM documents WHERE equipment_instance_id = ?", [id])
      : [];
    const issuedDocs = documentRows.filter((row) => ["issued", "active", "approved"].includes(String(row.status || ""))).length;
    const bomDocIds = new Set(documentRows.map((row) => Number(row.bom_node_id || 0)).filter(Boolean));
    const bomWithoutDocs = bomRows.filter((row) => Number(row.tier) >= 1 && !Number(row.is_phantom || 0) && !bomDocIds.has(Number(row.id)));
    const docsWithoutBom = documentRows.filter((row) => !row.bom_node_id);
    if (!documentRows.length) addGap("documents", "high", "未上传图纸/工艺文件", "现场执行需要图纸、SOP、检验标准电子化签发，不能只靠线下文件", "/documents", "工程/文控");
    if (documentRows.length && issuedDocs < documentRows.length) addGap("documents", "warning", "存在未签发文件", "未签发文件不能作为现场执行依据", "/documents", "工程/文控", documentRows.length - issuedDocs);
    if (bomRows.length && bomWithoutDocs.length) addGap("documents", "warning", "BOM 节点未绑定图纸", "部件/零件应能从 BOM 一键追到图纸或工艺文件", "/documents", "工程/文控", bomWithoutDocs.length, bomWithoutDocs.map((row) => `BOM#${row.id}`));
    if (docsWithoutBom.length) addGap("documents", "info", "文件未绑定 BOM 节点", "建议把图纸/SOP绑定到 BOM 节点，便于 ECO 和现场签收追踪", "/documents", "文控", docsWithoutBom.length);
    addSegment("documents", "图纸/文档", Math.max(documentRows.length, 1), issuedDocs, "/documents", "工程/文控");

    const processRows = tableExists("process_nodes") && has("process_nodes", "equipment_instance_id")
      ? safeAll("SELECT id, bom_node_id, operation_name, estimated_hours, required_workstation_id, required_skill, status FROM process_nodes WHERE equipment_instance_id = ?", [id])
      : [];
    const processBomIds = new Set(processRows.map((row) => Number(row.bom_node_id || 0)).filter(Boolean));
    const tier1WithoutProcess = bomRows.filter((row) => Number(row.tier) === 1 && !processBomIds.has(Number(row.id)));
    const processMissingHours = processRows.filter((row) => !Number(row.estimated_hours || 0));
    const processMissingWorkstation = processRows.filter((row) => !row.required_workstation_id);
    if (bomTier1 && !processRows.length) addGap("process", "high", "未建立工艺路线", "每个 1级部件应有装配/加工/检验工序、标准工时和工位", "/process-tree", "工艺");
    if (tier1WithoutProcess.length) addGap("process", "warning", "部件缺工艺路线", "1级部件未形成工序级执行路径，无法精准派工和报工", "/process-tree", "工艺", tier1WithoutProcess.length, tier1WithoutProcess.map((row) => `BOM#${row.id}`));
    if (processMissingHours.length) addGap("process", "warning", "工序缺标准工时", "标准工时是排程、绩效和成本归集基础", "/process-master", "工艺", processMissingHours.length);
    if (processMissingWorkstation.length) addGap("process", "warning", "工序缺工位", "工序必须落到装配/焊接/检验等工位才能执行", "/process-master", "工艺", processMissingWorkstation.length);
    addSegment("process", "工艺路线", Math.max(processRows.length || bomTier1, 1), Math.max(0, processRows.length - processMissingHours.length - processMissingWorkstation.length), "/process-tree", "工艺");

    const purchaseOrders = tableExists("purchase_orders") && has("purchase_orders", "equipment_instance_id")
      ? safeAll("SELECT id, po_no, status FROM purchase_orders WHERE equipment_instance_id = ?", [id])
      : [];
    const purchaseItems = tableExists("purchase_order_items") && tableExists("purchase_orders")
      ? safeAll(`
          SELECT poi.*, po.po_no, po.status AS po_status
          FROM purchase_order_items poi
          JOIN purchase_orders po ON po.id = poi.po_id
          WHERE po.equipment_instance_id = ?
        `, [id])
      : [];
    const itemsMissingMaterial = purchaseItems.filter((row) => !row.material_id);
    const itemsMissingBom = purchaseItems.filter((row) => !row.bom_node_id);
    const poWithItems = new Set(purchaseItems.map((row) => Number(row.po_id)).filter(Boolean));
    const poWithoutItems = purchaseOrders.filter((row) => !poWithItems.has(Number(row.id)));
    if (bomRows.length && !purchaseOrders.length) addGap("purchase", "warning", "BOM 未驱动采购单", "已有 BOM 但未形成采购单/跟催对象，缺料风险无法闭环", "/purchase", "采购");
    if (itemsMissingMaterial.length) addGap("purchase", "warning", "采购明细缺物料", "采购行必须绑定 material_id 才能回写库存、齐套和成本", "/purchase", "采购", itemsMissingMaterial.length);
    if (itemsMissingBom.length) addGap("purchase", "info", "采购明细未绑定 BOM 节点", "建议采购行绑定 bom_node_id，便于从风险部件钻取采购单", "/purchase", "采购", itemsMissingBom.length);
    if (poWithoutItems.length) addGap("purchase", "warning", "采购单无明细", "采购订单没有行项目，无法支撑 ETA、到货和成本核算", "/purchase", "采购", poWithoutItems.length, poWithoutItems.map((row) => row.po_no || `PO#${row.id}`));
    addSegment("purchase", "采购链路", Math.max(purchaseItems.length || purchaseOrders.length, 1), Math.max(0, purchaseItems.length - itemsMissingMaterial.length), "/purchase", "采购");

    const shortageRows = tableExists("shortage_cases") && has("shortage_cases", "equipment_instance_id")
      ? safeAll("SELECT * FROM shortage_cases WHERE equipment_instance_id = ? AND COALESCE(status, '') NOT IN ('closed', 'resolved', 'arrived', 'received', 'cancelled')", [id])
      : [];
    const shortageMissingOwner = shortageRows.filter((row) => !row.owner_id && missing(row.owner_name));
    const shortageMissingEta = shortageRows.filter((row) => missing(row.expected_date));
    const shortageMissingRequest = shortageRows.filter((row) => missing(row.purchase_request_no));
    if (shortageMissingOwner.length) addGap("kit", "high", "缺料未分派责任人", "缺料必须明确采购/仓库/工程责任人，否则无法闭环", "/kit-closure", "仓库/采购", shortageMissingOwner.length);
    if (shortageMissingEta.length) addGap("kit", "warning", "缺料缺 ETA", "缺料没有预计到货日，无法判断对工单和里程碑的影响", "/kit-closure", "采购", shortageMissingEta.length);
    if (shortageMissingRequest.length) addGap("kit", "warning", "缺料未生成采购催办", "缺料应进入采购跟催列表或替代料评审", "/kit-closure", "仓库/采购", shortageMissingRequest.length);
    addSegment("kit", "齐套/缺料", Math.max(shortageRows.length, 1), shortageRows.length ? Math.max(0, shortageRows.length - shortageMissingOwner.length - shortageMissingEta.length) : 1, "/kit-closure", "仓库/采购");

    const workOrders = tableExists("work_orders") && has("work_orders", "equipment_instance_id")
      ? safeAll("SELECT id, wo_code, status, workstation_id, assigned_to, estimated_hours, actual_hours FROM work_orders WHERE equipment_instance_id = ?", [id])
      : [];
    const woMissingStation = workOrders.filter((row) => !row.workstation_id);
    const woMissingAssignee = workOrders.filter((row) => !row.assigned_to);
    const woMissingHours = workOrders.filter((row) => !Number(row.estimated_hours || 0));
    if (processRows.length && !workOrders.length) addGap("work_orders", "high", "工艺未生成工单", "工艺路线应下发为工单/派工，才能进入车间执行", "/work-orders", "生产计划");
    if (woMissingStation.length) addGap("work_orders", "warning", "工单缺工位", "工单应明确装配、焊接、机加或检验工位", "/work-orders", "生产计划", woMissingStation.length);
    if (woMissingAssignee.length) addGap("work_orders", "warning", "工单未派人", "工单未分派班组/人员，现场无法执行", "/work-orders", "生产计划", woMissingAssignee.length);
    if (woMissingHours.length) addGap("work_orders", "info", "工单缺预计工时", "预计工时用于排程与人工成本归集", "/work-orders", "生产计划", woMissingHours.length);
    addSegment("work_orders", "工单/派工", Math.max(workOrders.length, 1), Math.max(0, workOrders.length - woMissingStation.length - woMissingAssignee.length), "/work-orders", "生产计划");

    const reportTable = ["work_order_operations", "process_reports", "operation_reports", "process_work_reports"].find(tableExists);
    const reports = reportTable
      ? safeAll(has(reportTable, "equipment_instance_id")
          ? `SELECT * FROM ${reportTable} WHERE equipment_instance_id = ?`
          : tableExists("work_orders") && has(reportTable, "work_order_id")
            ? `SELECT r.* FROM ${reportTable} r JOIN work_orders wo ON wo.id = r.work_order_id WHERE wo.equipment_instance_id = ?`
            : "SELECT * FROM sqlite_master WHERE 1=0", [id])
      : [];
    if (workOrders.length && !reports.length) addGap("report", "warning", "缺工序级报工明细", "车间需要按工序扫码报工，沉淀实际工时和进度", "/process-hours", "车间班组");
    addSegment("report", "工时/报工", Math.max(workOrders.length, 1), Math.max(reports.length, workOrders.filter((row) => Number(row.actual_hours || 0) > 0).length), "/process-hours", "车间班组");

    const qcRows = tableExists("qc_inspections") && has("qc_inspections", "equipment_instance_id")
      ? safeAll("SELECT * FROM qc_inspections WHERE equipment_instance_id = ?", [id])
      : [];
    const qcWithoutWo = qcRows.filter((row) => !row.work_order_id);
    const ncrRows = tableExists("ncr_reports") && has("ncr_reports", "equipment_instance_id")
      ? safeAll("SELECT * FROM ncr_reports WHERE equipment_instance_id = ?", [id])
      : [];
    const openNcr = ncrRows.filter((row) => !row.closed_at);
    if (workOrders.length && !qcRows.length) addGap("quality", "warning", "缺质检记录", "关键件、过程检、出厂检应形成电子检验记录", "/quality", "质量");
    if (qcWithoutWo.length) addGap("quality", "info", "质检未绑定工单", "质检记录建议绑定 work_order_id，方便从问题反查工序和责任人", "/quality", "质量", qcWithoutWo.length);
    if (openNcr.length) addGap("quality", "high", "NCR 未闭环", "NCR 需要完成处置、CAPA、复检和关闭", "/quality", "质量", openNcr.length, openNcr.map((row) => row.ncr_code || `NCR#${row.id}`));
    addSegment("quality", "质量闭环", Math.max(qcRows.length + ncrRows.length, 1), Math.max(0, qcRows.length + ncrRows.length - openNcr.length), "/quality", "质量");

    const cost = costSummaryForInstance(instance);
    const costRows = cost.by_account || [];
    if (cost.actual_amount <= 0) addGap("cost", "warning", "缺成本归集", "材料、人工、外协、折旧、返工和质量损失应归集到项目/设备/BOM节点", "/cost", "财务/项目");
    if (cost.risk_level !== "normal") addGap("cost", cost.risk_level, `成本偏差 ${cost.variance_pct}%`, "实际成本与按进度预算偏离，需要复核材料、外协、折旧和返工", "/cost", "财务/项目");
    addSegment("cost", "成本归集", Math.max(costRows.length, 1), costRows.length || (cost.actual_amount > 0 ? 1 : 0), "/cost", "财务/项目");

    const traceTables = ["serial_movements", "material_movements", "material_issue_records", "material_issues", "pick_records", "picking_records", "work_order_materials"].filter(tableExists);
    if (!traceTables.length && workOrders.length) addGap("trace", "warning", "缺批次发料/装配关系记录", "要做到端到端追溯，需要记录 lot_id/serial_no 发到哪个工单、装到哪个部件", "/trace", "仓库/质量");
    addSegment("trace", "批次/谱系", 1, traceTables.length ? 1 : 0, "/trace", "仓库/质量");

    const acceptanceTable = ["acceptance_records", "customer_acceptance", "tbm_acceptance"].find(tableExists);
    const acceptanceRows = acceptanceTable
      ? safeAll(has(acceptanceTable, "equipment_instance_id") ? `SELECT * FROM ${acceptanceTable} WHERE equipment_instance_id = ?` : "SELECT * FROM sqlite_master WHERE 1=0", [id])
      : [];
    if (Number(instance.progress_pct || 0) >= 80 && !acceptanceRows.length) addGap("acceptance", "warning", "缺客户验收记录", "总装/调试后应建立验收、整改、交付和售后接收记录", "/tbm-advanced?tab=accept", "项目/售后");
    addSegment("acceptance", "客户验收", Math.max(acceptanceRows.length, 1), acceptanceRows.length, "/tbm-advanced?tab=accept", "项目/售后");

    const severityWeight = { critical: 14, high: 10, warning: 5, info: 2 };
    const penalty = gaps.reduce((sum, gap) => sum + (severityWeight[gap.severity] || 2) * Math.max(1, Math.min(Number(gap.count || 1), 5)), 0);
    const score = Math.max(0, 100 - penalty);
    const level = score < 60 || gaps.some((gap) => gap.severity === "critical") ? "critical" : score < 75 || gaps.some((gap) => gap.severity === "high") ? "high" : score < 90 || gaps.some((gap) => gap.severity === "warning") ? "warning" : "normal";
    const bySeverity = { critical: 0, high: 0, warning: 0, info: 0 };
    for (const gap of gaps) bySeverity[gap.severity] = (bySeverity[gap.severity] || 0) + 1;

    return {
      project: {
        id,
        instance_code: instance.instance_code,
        instance_name: instance.instance_name,
        customer_name: instance.customer_name,
        contract_no: instance.contract_no,
        project_no: instance.project_no,
        serial_no: instance.serial_no,
        progress_pct: Number(instance.progress_pct || 0),
      },
      score,
      level,
      summary: {
        gap_count: gaps.length,
        severe_gap_count: gaps.filter((gap) => gap.severity === "critical" || gap.severity === "high").length,
        by_severity: bySeverity,
      },
      link_keys: ["project_id/equipment_instance_id", "bom_node_id", "work_order_id", "material_id", "lot_id/serial_no"],
      segments,
      gaps,
      project_snapshot: buildProject(instance, exceptions),
    };
  }

  return { buildProjectLineage };
}

module.exports = { createProjectLineageReadModel };
