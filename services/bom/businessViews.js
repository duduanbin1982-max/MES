"use strict";
const { buildPurchaseView } = require("./businessViews/purchaseView");
const { buildAssemblyView } = require("./businessViews/assemblyView");

function createBusinessViewsBuilder(deps) {
  const {
    PURCHASED_CATEGORIES,
    SELF_MADE_CATEGORIES,
    buildChildrenMap,
    calcCost,
    cleanText,
    validateTree,
    tierSummary,
    detectDuplicates,
    collectDescendantIds,
    earliestDate,
    hasColumns,
    isActiveShortageStatus,
    isResolvedShortageStatus,
    normalizeBool,
    normalizeFloat,
    normalizeInt,
    round2,
    round3,
    statusType,
    tableColumns,
    tableExists,
    uniqText,
  } = deps;

function buildBusinessViews(db, instanceId, rowsArg = null) {
  const rows = rowsArg || db.prepare(`
    SELECT b.*, m.material_code, m.material_name, m.spec, m.unit AS m_unit
    FROM instance_bom b
    LEFT JOIN materials m ON m.id = b.material_id
    WHERE b.equipment_instance_id = ?
    ORDER BY b.tier, b.parent_id, b.id
  `).all(instanceId);
  const childMap = buildChildrenMap(rows);
  const costItems = calcCost(db, instanceId);
  const costMap = new Map(costItems.map((item) => [Number(item.id), item]));
  const roots = rows.filter((row) => Number(row.tier) === 0 && (row.parent_id === null || Number(row.parent_id) === 0));
  const totalCost = roots.reduce((sum, row) => sum + Number(costMap.get(Number(row.id))?.cost || 0), 0);

  const documents = tableExists(db, "documents")
    ? db.prepare("SELECT id, bom_node_id, doc_type, status, version, title, doc_code FROM documents WHERE bom_node_id IS NOT NULL").all()
    : [];
  const docMap = new Map();
  for (const doc of documents) {
    const key = Number(doc.bom_node_id);
    const arr = docMap.get(key) || [];
    arr.push(doc);
    docMap.set(key, arr);
  }

  const processNodes = tableExists(db, "process_nodes")
    ? db.prepare(`
      SELECT pn.*, w.code AS workstation_code, w.name AS workstation_name, w.station_type,
             COALESCE((SELECT SUM(psh.standard_hours * psh.worker_count) FROM process_standard_hours psh WHERE psh.process_node_id = pn.id), 0) AS standard_man_hours
      FROM process_nodes pn
      LEFT JOIN workstations w ON w.id = pn.required_workstation_id
      WHERE pn.equipment_instance_id = ?
      ORDER BY pn.bom_node_id, pn.sequence, pn.sort_order, pn.id
    `).all(instanceId)
    : [];

  const inventoryRows = hasColumns(db, "inventory", ["material_lot_id", "quantity", "status"]) && hasColumns(db, "material_lots", ["id", "material_id"])
    ? db.prepare(`
      SELECT ml.material_id, SUM(i.quantity) AS available_qty
      FROM inventory i
      JOIN material_lots ml ON ml.id = i.material_lot_id
      WHERE i.status = 'available'
      GROUP BY ml.material_id
    `).all()
    : [];
  const stockMap = new Map(inventoryRows.map((row) => [Number(row.material_id), Number(row.available_qty || 0)]));

  const poItemColumns = tableColumns(db, "purchase_order_items");
  const poColumns = tableColumns(db, "purchase_orders");
  const supplierColumns = tableColumns(db, "suppliers");
  const userColumns = tableColumns(db, "users");
  const supplierJoin = poColumns.has("supplier_id") && supplierColumns.has("id") ? "LEFT JOIN suppliers s ON s.id = po.supplier_id" : "";
  const orderedUserJoin = poColumns.has("ordered_by") && userColumns.has("id") ? "LEFT JOIN users u_ordered ON u_ordered.id = po.ordered_by" : "";
  const approvedUserJoin = poColumns.has("approved_by") && userColumns.has("id") ? "LEFT JOIN users u_approved ON u_approved.id = po.approved_by" : "";
  const purchaseOrderRows = poItemColumns.size && poColumns.size
    && poItemColumns.has("po_id") && poItemColumns.has("quantity")
    && poColumns.has("id") && poColumns.has("equipment_instance_id")
    ? db.prepare(`
      SELECT
        po.id AS purchase_order_id,
        poi.id,
        poi.po_id,
        ${poItemColumns.has("material_id") ? "poi.material_id" : "NULL AS material_id"},
        ${poItemColumns.has("bom_node_id") ? "poi.bom_node_id" : "NULL AS bom_node_id"},
        COALESCE(poi.quantity, 0) AS quantity,
        ${poItemColumns.has("received_qty") ? "COALESCE(poi.received_qty, 0)" : "0"} AS received_qty,
        ${poItemColumns.has("unit_price") ? "poi.unit_price" : "NULL AS unit_price"},
        ${poItemColumns.has("total_price") ? "poi.total_price" : "NULL AS total_price"},
        po.po_no,
        po.status AS po_status,
        ${poColumns.has("expected_date") ? "po.expected_date" : "NULL AS expected_date"},
        ${poColumns.has("received_date") ? "po.received_date" : "NULL AS received_date"},
        ${poColumns.has("currency") ? "po.currency" : "'CNY' AS currency"},
        ${poColumns.has("ordered_by") ? "po.ordered_by" : "NULL AS ordered_by"},
        ${poColumns.has("approved_by") ? "po.approved_by" : "NULL AS approved_by"},
        ${supplierColumns.has("supplier_name")
          ? "s.supplier_name"
          : supplierColumns.has("name")
            ? "s.name AS supplier_name"
            : "NULL AS supplier_name"},
        ${poColumns.has("ordered_by") && userColumns.has("full_name")
          ? "u_ordered.full_name"
          : poColumns.has("ordered_by") && userColumns.has("username")
            ? "u_ordered.username AS full_name"
            : "NULL AS full_name"},
        ${poColumns.has("approved_by") && userColumns.has("full_name")
          ? "u_approved.full_name AS approved_by_name"
          : poColumns.has("approved_by") && userColumns.has("username")
            ? "u_approved.username AS approved_by_name"
            : "NULL AS approved_by_name"}
      FROM purchase_order_items poi
      JOIN purchase_orders po ON po.id = poi.po_id
      ${supplierJoin}
      ${orderedUserJoin}
      ${approvedUserJoin}
      WHERE po.equipment_instance_id = ?
    `).all(instanceId)
    : [];

  const shortageColumns = tableColumns(db, "shortage_cases");
  const allShortageRows = shortageColumns.size
    && shortageColumns.has("material_id")
    && shortageColumns.has("equipment_instance_id")
    ? db.prepare(`
      SELECT
        sc.id,
        sc.work_order_id,
        sc.equipment_instance_id,
        sc.material_id,
        sc.shortage_qty,
        sc.required_qty,
        sc.available_qty,
        ${shortageColumns.has("unit") ? "sc.unit" : "NULL AS unit"},
        ${shortageColumns.has("status") ? "sc.status" : "NULL AS status"},
        ${shortageColumns.has("owner_id") ? "sc.owner_id" : "NULL AS owner_id"},
        ${shortageColumns.has("owner_name") ? "sc.owner_name" : "NULL AS owner_name"},
        ${shortageColumns.has("expected_date") ? "sc.expected_date" : "NULL AS expected_date"},
        ${shortageColumns.has("purchase_request_no") ? "sc.purchase_request_no" : "NULL AS purchase_request_no"},
        ${shortageColumns.has("priority") ? "sc.priority" : "NULL AS priority"},
        ${shortageColumns.has("last_note") ? "sc.last_note" : "NULL AS last_note"}
      FROM shortage_cases sc
      WHERE sc.equipment_instance_id = ?
      ORDER BY sc.id DESC
    `).all(instanceId)
    : [];
  const shortageCaseRows = allShortageRows.filter((row) => isActiveShortageStatus(row.status));
  const resolvedShortageRows = allShortageRows.filter((row) => isResolvedShortageStatus(row.status));

  const purchasePoByMaterial = new Map();
  const purchasePoByBomNode = new Map();
  const inboundByMaterial = new Map();
  const shortageByMaterial = new Map();
  const resolvedShortageByMaterial = new Map();
  for (const row of purchaseOrderRows) {
    const materialId = normalizeInt(row.material_id, null);
    const bomNodeId = normalizeInt(row.bom_node_id, null);
    if (materialId) {
      const arr = purchasePoByMaterial.get(materialId) || [];
      arr.push(row);
      purchasePoByMaterial.set(materialId, arr);
    }
    if (bomNodeId) {
      const arr = purchasePoByBomNode.get(bomNodeId) || [];
      arr.push(row);
      purchasePoByBomNode.set(bomNodeId, arr);
    }
    if (materialId) {
      const openQty = Math.max(Number(row.quantity || 0) - Number(row.received_qty || 0), 0);
      const bucket = inboundByMaterial.get(materialId) || { open_qty: 0, next_expected_date: null, po_nos: [] };
      bucket.open_qty += openQty;
      if (openQty > 0) {
        bucket.next_expected_date = earliestDate([bucket.next_expected_date, row.expected_date]);
        if (row.po_no) bucket.po_nos.push(row.po_no);
      }
      inboundByMaterial.set(materialId, bucket);
    }
  }
  for (const row of shortageCaseRows) {
    const materialId = normalizeInt(row.material_id, null);
    if (!materialId) continue;
    const arr = shortageByMaterial.get(materialId) || [];
    arr.push(row);
    shortageByMaterial.set(materialId, arr);
  }
  for (const row of resolvedShortageRows) {
    const materialId = normalizeInt(row.material_id, null);
    if (!materialId) continue;
    const arr = resolvedShortageByMaterial.get(materialId) || [];
    arr.push(row);
    resolvedShortageByMaterial.set(materialId, arr);
  }

  const kitRelevantRows = rows.filter((row) => {
    if (normalizeBool(row.is_phantom)) return false;
    if (!normalizeInt(row.material_id, null)) return false;
    return PURCHASED_CATEGORIES.has(row.category) || Number(row.tier) === 3;
  });
  const totalDemandMap = new Map();
  for (const row of kitRelevantRows) {
    const materialId = Number(row.material_id);
    totalDemandMap.set(materialId, Number(totalDemandMap.get(materialId) || 0) + Number(row.quantity || 0));
  }

  const { purchaseItems, purchaseContractItems } = buildPurchaseView({
    rows,
    PURCHASED_CATEGORIES,
    normalizeBool,
    normalizeFloat,
    costMap,
    purchasePoByMaterial,
    purchasePoByBomNode,
    round2,
    round3,
    uniqText,
    earliestDate,
  });

  const rawSource = rows.filter((row) => Number(row.tier) === 3 && !normalizeBool(row.is_phantom));
  const rawItems = rawSource.map((row) => ({
    bom_id: row.id,
    parent_id: row.parent_id,
    material_id: row.material_id || null,
    material_code: row.material_code || null,
    material_name: row.material_name || null,
    part_number: row.part_number || null,
    category: row.category || null,
    quantity: Number(row.quantity || 0),
    unit: row.unit || row.m_unit || null,
    material_grade: row.material_grade || null,
    surface_treatment: row.surface_treatment || null,
    scrap_factor: Number(row.scrap_factor || 1),
    weight: normalizeFloat(row.weight, null),
    unit_price: normalizeFloat(row.unit_price, null),
    estimated_amount: round2(Number(costMap.get(Number(row.id))?.self || 0)),
    notes: row.notes || null,
  })).sort((a, b) => b.estimated_amount - a.estimated_amount);

  const { assemblyComponents, processComponents } = buildAssemblyView({
    rows,
    childMap,
    costMap,
    docMap,
    processNodes,
    totalDemandMap,
    stockMap,
    inboundByMaterial,
    purchasePoByMaterial,
    shortageByMaterial,
    resolvedShortageByMaterial,
    PURCHASED_CATEGORIES,
    SELF_MADE_CATEGORIES,
    collectDescendantIds,
    normalizeBool,
    normalizeInt,
    normalizeFloat,
    isActiveShortageStatus,
    cleanText,
    earliestDate,
    round2,
    round3,
    statusType,
    uniqText,
  });

  const categoryCostMap = new Map();
  for (const row of rows.filter((row) => Number(row.tier) >= 2 && !normalizeBool(row.is_phantom))) {
    const key = row.category || "未分类";
    if (!categoryCostMap.has(key)) categoryCostMap.set(key, { category: key, node_count: 0, estimated_amount: 0, missing_price: 0 });
    const bucket = categoryCostMap.get(key);
    bucket.node_count += 1;
    bucket.estimated_amount += Number(costMap.get(Number(row.id))?.self || 0);
    if (normalizeFloat(row.unit_price, null) === null) bucket.missing_price += 1;
  }
  const costByCategory = [...categoryCostMap.values()]
    .map((item) => ({ ...item, estimated_amount: round2(item.estimated_amount) }))
    .sort((a, b) => b.estimated_amount - a.estimated_amount);

  const topCostItems = rows
    .filter((row) => Number(row.tier) >= 2 && !normalizeBool(row.is_phantom))
    .map((row) => ({
      bom_id: row.id,
      material_code: row.material_code || null,
      material_name: row.material_name || null,
      part_number: row.part_number || null,
      category: row.category || null,
      tier: row.tier,
      self_cost: round2(Number(costMap.get(Number(row.id))?.self || 0)),
      quantity: Number(row.quantity || 0),
      unit: row.unit || null,
      unit_price: normalizeFloat(row.unit_price, null),
    }))
    .sort((a, b) => b.self_cost - a.self_cost)
    .slice(0, 20);

  const riskComponents = assemblyComponents
    .filter((item) => item.kit_status !== "ready")
    .map((item) => ({
      component_id: item.component_id,
      component_name: item.component_name,
      part_number: item.part_number,
      kit_status: item.kit_status,
      shortage_line_count: item.kit_shortage_count,
      blocked_material_count: item.kit_blocked_count,
      incoming_material_count: item.kit_incoming_count,
      next_expected_date: item.next_expected_date,
      shortage_amount: item.shortage_amount,
      owners: uniqText((item.risk_items || []).flatMap((risk) => risk.owners || [])),
      purchase_order_count: (item.risk_items || []).reduce((sum, risk) => sum + Number((risk.purchase_orders || []).length), 0),
      purchase_request_count: uniqText((item.risk_items || []).flatMap((risk) => risk.purchase_request_nos || [])).length,
      items: item.risk_items,
    }))
    .sort((a, b) => {
      const weight = { blocked: 3, incoming: 2, ready: 1 };
      return (weight[b.kit_status] || 0) - (weight[a.kit_status] || 0)
        || Number(b.shortage_amount || 0) - Number(a.shortage_amount || 0);
    });

  return {
    summary: {
      total_nodes: rows.length,
      total_cost: round2(totalCost),
      purchase_line_count: purchaseItems.length,
      raw_line_count: rawItems.length,
      component_count: assemblyComponents.length,
      missing_price_count: rows.filter((row) => Number(row.tier) >= 2 && !normalizeBool(row.is_phantom) && normalizeFloat(row.unit_price, null) === null).length,
      complete_process_components: processComponents.filter((item) => item.process_status === "success").length,
      purchase_contract_signed_count: purchaseContractItems.filter((item) => item.actual_unit_price !== null).length,
      purchase_contract_pending_count: purchaseContractItems.filter((item) => item.actual_unit_price === null).length,
      assembly_risk_component_count: riskComponents.length,
    },
    purchase: {
      total_quantity: round3(purchaseItems.reduce((sum, item) => sum + item.quantity, 0)),
      total_estimated_amount: round2(purchaseItems.reduce((sum, item) => sum + item.estimated_amount, 0)),
      missing_price_count: purchaseItems.reduce((sum, item) => sum + item.missing_price, 0),
      items: purchaseItems,
      contract_diff: {
        signed_count: purchaseContractItems.filter((item) => item.actual_unit_price !== null).length,
        pending_count: purchaseContractItems.filter((item) => item.actual_unit_price === null).length,
        over_budget_count: purchaseContractItems.filter((item) => item.diff_status === "over_budget" || item.diff_status === "over_20pct").length,
        total_estimated_amount: round2(purchaseContractItems.reduce((sum, item) => sum + Number(item.estimated_amount || 0), 0)),
        total_actual_amount: round2(purchaseContractItems.reduce((sum, item) => sum + Number(item.actual_amount || 0), 0)),
        total_diff_amount: round2(purchaseContractItems.reduce((sum, item) => sum + Number(item.diff_amount || 0), 0)),
        items: purchaseContractItems,
      },
    },
    assembly: {
      components: assemblyComponents,
      total_cost: round2(assemblyComponents.reduce((sum, item) => sum + item.total_cost, 0)),
      kit_summary: {
        ready_count: assemblyComponents.filter((item) => item.kit_status === "ready").length,
        incoming_count: assemblyComponents.filter((item) => item.kit_status === "incoming").length,
        blocked_count: assemblyComponents.filter((item) => item.kit_status === "blocked").length,
        shortage_line_count: riskComponents.reduce((sum, item) => sum + Number(item.shortage_line_count || 0), 0),
      },
      kit_risks: riskComponents,
    },
    raw: {
      total_estimated_amount: round2(rawItems.reduce((sum, item) => sum + item.estimated_amount, 0)),
      total_weight: round2(rawItems.reduce((sum, item) => sum + Number(item.weight || 0), 0)),
      items: rawItems,
    },
    cost: {
      total_cost: round2(totalCost),
      by_category: costByCategory,
      by_component: assemblyComponents.map((component) => ({
        component_id: component.component_id,
        component_name: component.component_name,
        total_cost: component.total_cost,
        purchased_count: component.purchased_count,
        self_made_count: component.self_made_count,
        raw_count: component.raw_count,
      })),
      top_items: topCostItems,
    },
    process: {
      summary: {
        component_count: processComponents.length,
        complete_count: processComponents.filter((item) => item.process_status === "success").length,
        missing_route_count: processComponents.filter((item) => item.missing.includes("未建立工序")).length,
        missing_hours_count: processComponents.filter((item) => item.missing.some((msg) => msg.includes("标准工时"))).length,
        missing_workstation_count: processComponents.filter((item) => item.missing.some((msg) => msg.includes("工位"))).length,
      },
      components: processComponents,
    },
  };
}

function computeHealth(db, instanceId, rowsArg = null) {
  const rows = rowsArg || db.prepare("SELECT * FROM instance_bom WHERE equipment_instance_id = ? ORDER BY tier, id").all(instanceId);
  const validation = validateTree(db, instanceId, rows);
  const duplicates = detectDuplicates(rows);
  const missingMaterialOrPart = rows.filter((r) => Number(r.tier) >= 2 && !r.material_id && !cleanText(r.part_number) && !normalizeBool(r.is_phantom));
  const missingMaterialGrade = rows.filter((r) => SELF_MADE_CATEGORIES.has(r.category) && !cleanText(r.material_grade));
  const missingSurface = rows.filter((r) => SELF_MADE_CATEGORIES.has(r.category) && !cleanText(r.surface_treatment));
  const missingBrand = rows.filter((r) => PURCHASED_CATEGORIES.has(r.category) && !cleanText(r.brand_recommend));
  const missingUnitPrice = rows.filter((r) => Number(r.tier) >= 2 && !normalizeBool(r.is_phantom) && normalizeFloat(r.unit_price, null) === null);
  const missingVersion = rows.filter((r) => !cleanText(r.version));
  const missingOperation = rows.filter((r) => Number(r.tier) >= 1 && Number(r.tier) <= 2 && !normalizeBool(r.is_phantom) && !normalizeInt(r.operation_id, null));
  const alternativeWithoutGroup = rows.filter((r) => normalizeBool(r.is_alternative) && !cleanText(r.alternative_group));
  const materialWarnings = rows.filter((r) => r.material_id && cleanText(r.part_number) && normalizeInt(r.tier, 0) >= 2);

  let unlinkedDocuments = [];
  if (tableExists(db, "documents")) {
    try {
      unlinkedDocuments = rows.filter((r) => {
        const doc = db.prepare("SELECT id FROM documents WHERE bom_node_id = ? LIMIT 1").get(r.id);
        return Number(r.tier) >= 1 && !doc;
      });
    } catch (_e) {
      unlinkedDocuments = [];
    }
  }

  const issues = [
    validation.errors.length * 8,
    duplicates.duplicateMaterialNodes.length * 5,
    duplicates.duplicatePartNumbers.length * 4,
    missingMaterialOrPart.length * 4,
    missingMaterialGrade.length * 3,
    missingSurface.length * 3,
    missingBrand.length * 2,
    missingUnitPrice.length * 2,
    missingOperation.length * 1,
    alternativeWithoutGroup.length * 2,
    unlinkedDocuments.length * 1,
  ].reduce((sum, value) => sum + value, 0);

  const score = Math.max(0, 100 - issues);
  const samples = [];
  if (missingMaterialOrPart[0]) samples.push(`缺物料/图号: #${missingMaterialOrPart[0].id}`);
  if (missingUnitPrice[0]) samples.push(`缺估价: #${missingUnitPrice[0].id}`);
  if (duplicates.duplicateMaterialNodes[0]) samples.push(`重复物料: ${duplicates.duplicateMaterialNodes[0][0]}`);
  if (missingOperation[0]) samples.push(`缺工艺: #${missingOperation[0].id}`);
  if (unlinkedDocuments[0]) samples.push(`缺图纸: #${unlinkedDocuments[0].id}`);

  return {
    score,
    summary: tierSummary(rows),
    total_nodes: rows.length,
    errors_count: validation.errors.length,
    warnings_count: validation.warnings.length,
    checks: {
      duplicate_material_nodes: duplicates.duplicateMaterialNodes.length,
      duplicate_part_numbers: duplicates.duplicatePartNumbers.length,
      missing_material_or_part: missingMaterialOrPart.length,
      missing_material_grade: missingMaterialGrade.length,
      missing_surface_treatment: missingSurface.length,
      missing_brand_recommend: missingBrand.length,
      missing_unit_price: missingUnitPrice.length,
      missing_version: missingVersion.length,
      missing_operation_route: missingOperation.length,
      alternative_without_group: alternativeWithoutGroup.length,
      nodes_without_documents: unlinkedDocuments.length,
      material_and_part_both_filled: materialWarnings.length,
    },
    highlights: samples,
    validation,
  };
}

  return { buildBusinessViews, computeHealth };
}

module.exports = { createBusinessViewsBuilder };
