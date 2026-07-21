"use strict";

function loadDocuments(db, tableExists) {
  if (!tableExists(db, "documents")) return [];
  return db.prepare(`
    SELECT id, bom_node_id, doc_type, status, version, title, doc_code
    FROM documents
    WHERE bom_node_id IS NOT NULL
  `).all();
}

function loadProcessNodes(db, instanceId, tableExists) {
  if (!tableExists(db, "process_nodes")) return [];
  return db.prepare(`
    SELECT pn.*, w.code AS workstation_code, w.name AS workstation_name, w.station_type,
           COALESCE((
             SELECT SUM(psh.standard_hours * psh.worker_count)
             FROM process_standard_hours psh
             WHERE psh.process_node_id = pn.id
           ), 0) AS standard_man_hours
    FROM process_nodes pn
    LEFT JOIN workstations w ON w.id = pn.required_workstation_id
    WHERE pn.equipment_instance_id = ?
    ORDER BY pn.bom_node_id, pn.sequence, pn.sort_order, pn.id
  `).all(instanceId);
}

function loadInventoryRows(db, hasColumns) {
  if (!hasColumns(db, "inventory", ["material_lot_id", "quantity", "status"])
    || !hasColumns(db, "material_lots", ["id", "material_id"])) return [];
  return db.prepare(`
    SELECT ml.material_id, SUM(i.quantity) AS available_qty
    FROM inventory i
    JOIN material_lots ml ON ml.id = i.material_lot_id
    WHERE i.status = 'available'
    GROUP BY ml.material_id
  `).all();
}

function purchaseOrderSelects({ poItemColumns, poColumns, supplierColumns, userColumns }) {
  return {
    materialId: poItemColumns.has("material_id") ? "poi.material_id" : "NULL AS material_id",
    bomNodeId: poItemColumns.has("bom_node_id") ? "poi.bom_node_id" : "NULL AS bom_node_id",
    receivedQty: poItemColumns.has("received_qty") ? "COALESCE(poi.received_qty, 0)" : "0",
    unitPrice: poItemColumns.has("unit_price") ? "poi.unit_price" : "NULL AS unit_price",
    totalPrice: poItemColumns.has("total_price") ? "poi.total_price" : "NULL AS total_price",
    expectedDate: poColumns.has("expected_date") ? "po.expected_date" : "NULL AS expected_date",
    receivedDate: poColumns.has("received_date") ? "po.received_date" : "NULL AS received_date",
    currency: poColumns.has("currency") ? "po.currency" : "'CNY' AS currency",
    orderedBy: poColumns.has("ordered_by") ? "po.ordered_by" : "NULL AS ordered_by",
    approvedBy: poColumns.has("approved_by") ? "po.approved_by" : "NULL AS approved_by",
    supplierName: supplierColumns.has("supplier_name")
      ? "s.supplier_name"
      : supplierColumns.has("name") ? "s.name AS supplier_name" : "NULL AS supplier_name",
    orderedByName: poColumns.has("ordered_by") && userColumns.has("full_name")
      ? "u_ordered.full_name"
      : poColumns.has("ordered_by") && userColumns.has("username")
        ? "u_ordered.username AS full_name" : "NULL AS full_name",
    approvedByName: poColumns.has("approved_by") && userColumns.has("full_name")
      ? "u_approved.full_name AS approved_by_name"
      : poColumns.has("approved_by") && userColumns.has("username")
        ? "u_approved.username AS approved_by_name" : "NULL AS approved_by_name",
  };
}

function loadPurchaseOrderRows(db, instanceId, tableColumns) {
  const poItemColumns = tableColumns(db, "purchase_order_items");
  const poColumns = tableColumns(db, "purchase_orders");
  const supplierColumns = tableColumns(db, "suppliers");
  const userColumns = tableColumns(db, "users");
  if (!poItemColumns.has("po_id") || !poItemColumns.has("quantity")
    || !poColumns.has("id") || !poColumns.has("equipment_instance_id")) return [];

  const select = purchaseOrderSelects({ poItemColumns, poColumns, supplierColumns, userColumns });
  const supplierJoin = poColumns.has("supplier_id") && supplierColumns.has("id") ? "LEFT JOIN suppliers s ON s.id = po.supplier_id" : "";
  const orderedUserJoin = poColumns.has("ordered_by") && userColumns.has("id") ? "LEFT JOIN users u_ordered ON u_ordered.id = po.ordered_by" : "";
  const approvedUserJoin = poColumns.has("approved_by") && userColumns.has("id") ? "LEFT JOIN users u_approved ON u_approved.id = po.approved_by" : "";

  return db.prepare(`
    SELECT po.id AS purchase_order_id, poi.id, poi.po_id,
           ${select.materialId}, ${select.bomNodeId},
           COALESCE(poi.quantity, 0) AS quantity,
           ${select.receivedQty} AS received_qty,
           ${select.unitPrice}, ${select.totalPrice},
           po.po_no, po.status AS po_status,
           ${select.expectedDate}, ${select.receivedDate}, ${select.currency},
           ${select.orderedBy}, ${select.approvedBy},
           ${select.supplierName}, ${select.orderedByName}, ${select.approvedByName}
    FROM purchase_order_items poi
    JOIN purchase_orders po ON po.id = poi.po_id
    ${supplierJoin}
    ${orderedUserJoin}
    ${approvedUserJoin}
    WHERE po.equipment_instance_id = ?
  `).all(instanceId);
}

function loadShortageRows(db, instanceId, tableColumns) {
  const columns = tableColumns(db, "shortage_cases");
  if (!columns.has("material_id") || !columns.has("equipment_instance_id")) return [];
  const optional = (name) => columns.has(name) ? `sc.${name}` : `NULL AS ${name}`;
  return db.prepare(`
    SELECT sc.id, sc.work_order_id, sc.equipment_instance_id, sc.material_id,
           sc.shortage_qty, sc.required_qty, sc.available_qty,
           ${optional("unit")}, ${optional("status")}, ${optional("owner_id")},
           ${optional("owner_name")}, ${optional("expected_date")},
           ${optional("purchase_request_no")}, ${optional("priority")}, ${optional("last_note")}
    FROM shortage_cases sc
    WHERE sc.equipment_instance_id = ?
    ORDER BY sc.id DESC
  `).all(instanceId);
}

module.exports = {
  loadDocuments,
  loadInventoryRows,
  loadProcessNodes,
  loadPurchaseOrderRows,
  loadShortageRows,
};
