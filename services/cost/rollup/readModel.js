"use strict";
// services/cost/rollup/readModel.js
// 2026-11-02：成本归集（rollup / breakdown）的只读视图。
//
// 背景：成本归集要跨域读 equipment_instances / instance_bom / materials /
// key_components / key_component_prices / work_orders，之前 SQL 直接写在接口里。
// 现在同 reportService 的做法：跨域读集中到视图，聚合接口只读 v_* 视图。
//
// 两组粒度是刻意分开的（保持改造前行为一致）：
//   · *_lines   每行 BOM 一条（breakdown 明细用）
//   · *_costs   按物料/关键件聚合一条（rollup 汇总用）
//
// 变更流程：改视图 -> 提升 registry 里 cost 的 schemaVersion -> npm run schema:write
// 注意：SQLite 没有 CREATE OR REPLACE VIEW，必须 DROP + CREATE 才能让已有库更新视图定义。

const CONTRACT_SUMMARY = {
  name: "v_instance_contract_summary",
  sql: `
CREATE VIEW v_instance_contract_summary AS
SELECT ei.id                   AS id,
       ei.instance_code        AS instance_code,
       ei.instance_name        AS instance_name,
       ei.customer_name        AS customer_name,
       ei.contract_no          AS contract_no,
       ei.contract_amount      AS contract_amount,
       ei.contract_amount_unit AS contract_amount_unit,
       ei.status               AS status,
       ei.progress_pct         AS progress_pct
FROM equipment_instances ei
`,
};

const KEY_COMPONENT_LINES = {
  name: "v_instance_bom_key_component_lines",
  sql: `
CREATE VIEW v_instance_bom_key_component_lines AS
SELECT ib.equipment_instance_id AS instance_id,
       ib.id                    AS bom_id,
       kc.id                    AS key_component_id,
       m.id                     AS material_id,
       m.material_code          AS material_code,
       m.material_name          AS material_name,
       kc.component_type        AS component_type,
       kc.supplier              AS supplier,
       ib.quantity              AS quantity,
       kc.unit_price            AS estimated_unit_price,
       kcp.actual_price         AS actual_unit_price,
       kcp.contract_no          AS contract_no,
       kcp.vendor_po            AS vendor_po,
       kcp.currency             AS currency,
       kcp.valid_from           AS valid_from,
       kcp.valid_to             AS valid_to,
       kcp.id                   AS price_id
FROM instance_bom ib
JOIN key_components kc ON kc.material_id = ib.material_id
JOIN materials m       ON m.id = ib.material_id
LEFT JOIN key_component_prices kcp ON kcp.id = kc.last_price_id
WHERE ib.is_key_component = 1
`,
};

const MATERIAL_LINES = {
  name: "v_instance_bom_material_lines",
  sql: `
CREATE VIEW v_instance_bom_material_lines AS
SELECT ib.equipment_instance_id AS instance_id,
       ib.id                    AS bom_id,
       m.id                     AS material_id,
       m.material_code          AS material_code,
       m.material_name          AS material_name,
       m.material_type          AS material_type,
       m.unit                   AS unit,
       ib.quantity              AS quantity,
       m.estimated_unit_price   AS estimated_unit_price
FROM instance_bom ib
JOIN materials m ON m.id = ib.material_id
WHERE COALESCE(ib.is_key_component, 0) = 0
`,
};

const KEY_COMPONENT_COSTS = {
  name: "v_instance_key_component_costs",
  sql: `
CREATE VIEW v_instance_key_component_costs AS
SELECT instance_id,
       key_component_id,
       MIN(material_id)          AS material_id,
       MIN(material_code)        AS material_code,
       MIN(material_name)        AS material_name,
       MIN(component_type)       AS component_type,
       MIN(supplier)             AS supplier,
       MIN(bom_id)               AS bom_id,
       SUM(quantity)             AS quantity,
       MIN(estimated_unit_price) AS estimated_unit_price,
       MIN(actual_unit_price)    AS actual_unit_price,
       MIN(price_id)             AS price_id,
       MIN(contract_no)          AS contract_no,
       MIN(vendor_po)            AS vendor_po,
       MIN(currency)             AS currency,
       MIN(valid_from)           AS valid_from,
       MIN(valid_to)             AS valid_to
FROM v_instance_bom_key_component_lines
GROUP BY instance_id, key_component_id
`,
};

const MATERIAL_COSTS = {
  name: "v_instance_material_costs",
  sql: `
CREATE VIEW v_instance_material_costs AS
SELECT instance_id,
       material_id,
       MIN(material_code)        AS material_code,
       MIN(material_name)        AS material_name,
       MIN(material_type)        AS material_type,
       MIN(unit)                 AS unit,
       SUM(quantity)             AS quantity,
       MIN(estimated_unit_price) AS estimated_unit_price
FROM v_instance_bom_material_lines
GROUP BY instance_id, material_id
`,
};

// 工时汇总（每个实例一行，即使没有工单）
// completed_count 故意不带 COALESCE：没有工单时 SUM 返回 NULL，
// 与改造前 COUNT(*)/SUM(CASE...) 的口径逐字节一致。
const LABOR_TOTALS = {
  name: "v_instance_labor_totals",
  sql: `
CREATE VIEW v_instance_labor_totals AS
SELECT ei.id                                    AS instance_id,
       COALESCE(SUM(wo.estimated_hours), 0)     AS estimated_hours,
       COALESCE(SUM(wo.actual_hours), 0)        AS actual_hours,
       COUNT(wo.id)                             AS work_order_count,
       SUM(CASE WHEN wo.id IS NULL THEN NULL WHEN wo.status = 'completed' THEN 1 ELSE 0 END) AS completed_count
FROM equipment_instances ei
LEFT JOIN work_orders wo ON wo.equipment_instance_id = ei.id
GROUP BY ei.id
`,
};

const COST_ENTRY_LINES = {
  name: "v_instance_cost_entry_lines",
  sql: `
CREATE VIEW v_instance_cost_entry_lines AS
SELECT pce.equipment_instance_id AS instance_id,
       pce.bom_node_id           AS bom_node_id,
       pce.id                    AS item_id,
       pce.cost_type             AS cost_type,
       pce.description           AS description,
       pce.currency              AS currency,
       pce.amount                AS amount,
       pce.source_ref            AS source_ref,
       pce.source_type           AS source_type,
       pce.vendor                AS vendor,
       pce.occurred_on           AS occurred_on,
       pce.notes                 AS notes,
       pce.status                AS status,
       CASE pce.cost_type
         WHEN 'outsourcing'   THEN '外协'
         WHEN 'depreciation'  THEN '折旧'
         WHEN 'rework'        THEN '返工'
         WHEN 'quality_loss'  THEN '质量损失'
         ELSE pce.cost_type
       END                       AS cost_type_label
FROM project_cost_entries pce
WHERE pce.deleted_at IS NULL AND pce.status != 'void'
`,
};

const COST_READ_MODEL_VIEWS = [
  CONTRACT_SUMMARY,
  KEY_COMPONENT_LINES,
  MATERIAL_LINES,
  KEY_COMPONENT_COSTS,
  MATERIAL_COSTS,
  LABOR_TOTALS,
  COST_ENTRY_LINES,
];

/**
 * 重建只读视图（幂等）。
 * SQLite 不支持 CREATE OR REPLACE VIEW，所以先 DROP 再 CREATE；
 * DDL 计入 cost 服务的 schemaVersion（改定义必须升版本）。
 */
function ensureReadModel(db) {
  for (const view of COST_READ_MODEL_VIEWS) {
    db.exec(`DROP VIEW IF EXISTS ${view.name}`);
    db.exec(view.sql);
  }
}

module.exports = { ensureReadModel, COST_READ_MODEL_VIEWS };
