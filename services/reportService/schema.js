// services/reportService/schema.js
// 2026-11-02：只读视图（read model）。
//
// 设计规则：
//   1. 报表 / 看板 / 健康检查等「聚合模块」只读本文件的视图，
//      不再直接 SELECT 别的业务模块的表；
//   2. 跨域读的 SQL 集中在这里，业务模块改表结构时只需同步改本文件；
//   3. 视图只读（CREATE VIEW），不写任何数据，不影响各模块的事务与写入路径。
//
// 变更流程：改视图 -> 提升 registry 里 reportService 的 schemaVersion -> npm run schema:write

// 风险口径（5 个计数）：risk-summary 只需要这 5 个，单独成型避免多算
const RISK_COUNTS = `
CREATE VIEW IF NOT EXISTS v_risk_counts AS
SELECT
  (SELECT COUNT(*) FROM work_orders
    WHERE planned_end IS NOT NULL AND planned_end < datetime('now')
      AND status NOT IN ('completed', 'cancelled'))                             AS work_order_delays,
  (SELECT COUNT(*) FROM process_nodes
    WHERE planned_end IS NOT NULL AND planned_end < datetime('now')
      AND status NOT IN ('completed', 'cancelled'))                             AS process_node_delays,
  (SELECT COUNT(*) FROM key_components WHERE lead_time_weeks >= 12)             AS long_leadtime,
  (SELECT COUNT(*) FROM instance_eco WHERE status = 'open')                     AS open_eco,
  (SELECT COUNT(*) FROM field_service WHERE status = 'open')                    AS open_field_service
`;

// 看板头部计数：7 个规模指标 + 复用风险口径（一次查询拿全）
const DASHBOARD_COUNTS = `
CREATE VIEW IF NOT EXISTS v_dashboard_counts AS
SELECT
  (SELECT COUNT(*) FROM equipment_types WHERE is_active = 1)                    AS equipment_types_active,
  (SELECT COUNT(*) FROM equipment_models)                                       AS equipment_models,
  (SELECT COUNT(*) FROM equipment_instances)                                    AS instances_total,
  (SELECT COUNT(*) FROM work_orders)                                            AS work_orders_total,
  (SELECT COUNT(*) FROM process_nodes)                                          AS process_nodes_total,
  (SELECT COUNT(*) FROM instance_bom)                                           AS bom_total,
  (SELECT COUNT(*) FROM key_components)                                         AS key_components_total,
  risk.work_order_delays                                                        AS work_order_delays,
  risk.process_node_delays                                                      AS process_node_delays,
  risk.long_leadtime                                                            AS long_leadtime,
  risk.open_eco                                                                 AS open_eco,
  risk.open_field_service                                                       AS open_field_service
FROM v_risk_counts risk
`;

// 按状态分组（工单 / 工序 / 项目）
const WORK_ORDER_STATUS = `
CREATE VIEW IF NOT EXISTS v_work_order_status_counts AS
SELECT status, COUNT(*) AS c FROM work_orders GROUP BY status
`;

const PROCESS_NODE_STATUS = `
CREATE VIEW IF NOT EXISTS v_process_node_status_counts AS
SELECT status, COUNT(*) AS c FROM process_nodes GROUP BY status
`;

const INSTANCE_STATUS = `
CREATE VIEW IF NOT EXISTS v_instance_status_counts AS
SELECT status, COUNT(*) AS c FROM equipment_instances GROUP BY status
`;

// 长交期关键件（>= 12 周）：原来在接口里 JOIN key_components + materials
const LONG_LEADTIME = `
CREATE VIEW IF NOT EXISTS v_long_leadtime_components AS
SELECT m.material_code, m.material_name, kc.lead_time_weeks, kc.supplier, kc.unit_price
FROM key_components kc
JOIN materials m ON m.id = kc.material_id
WHERE kc.lead_time_weeks >= 12
`;

// 实例级健康指标：一次查询拿到 8 个环节所需的全部计数（原来每实例 ~22 次 count）
const INSTANCE_HEALTH_METRICS = `
CREATE VIEW IF NOT EXISTS v_instance_health_metrics AS
SELECT
  ei.id                       AS instance_id,
  ei.instance_code            AS instance_code,
  ei.instance_name            AS instance_name,
  ei.status                   AS status,
  ei.lifecycle_stage          AS lifecycle_stage,
  ei.progress_pct             AS progress_pct,
  -- 1 项目与里程碑
  (SELECT COUNT(*) FROM instance_milestones m WHERE m.equipment_instance_id = ei.id) AS milestones,
  CASE WHEN ei.contract_no IS NOT NULL AND TRIM(ei.contract_no) <> '' THEN 1 ELSE 0 END AS has_contract,
  -- 2 设计与 BOM
  (SELECT COUNT(*) FROM instance_bom b WHERE b.equipment_instance_id = ei.id) AS bom_rows,
  (SELECT COUNT(*) FROM instance_bom b WHERE b.equipment_instance_id = ei.id AND b.material_id IS NOT NULL) AS bom_with_material,
  (SELECT COUNT(*) FROM instance_bom b WHERE b.equipment_instance_id = ei.id AND b.material_lot_id IS NOT NULL) AS bom_with_lot,
  (SELECT COUNT(DISTINCT b.material_lot_id) FROM instance_bom b WHERE b.equipment_instance_id = ei.id AND b.material_lot_id IS NOT NULL) AS lots,
  (SELECT COUNT(*) FROM instance_eco e WHERE e.equipment_instance_id = ei.id) AS eco,
  -- 3 工艺树与排程
  (SELECT COUNT(*) FROM process_nodes p WHERE p.equipment_instance_id = ei.id) AS nodes,
  (SELECT COUNT(*) FROM process_nodes p WHERE p.equipment_instance_id = ei.id AND p.planned_start IS NOT NULL) AS nodes_scheduled,
  (SELECT COUNT(*) FROM process_nodes p WHERE p.equipment_instance_id = ei.id AND p.required_workstation_id IS NOT NULL) AS nodes_with_workstation,
  (SELECT COUNT(*) FROM process_nodes p WHERE p.equipment_instance_id = ei.id AND p.status = 'blocked') AS blocked_nodes,
  -- 4 派工与报工
  (SELECT COUNT(*) FROM work_orders w WHERE w.equipment_instance_id = ei.id) AS work_orders,
  (SELECT COUNT(*) FROM work_orders w WHERE w.equipment_instance_id = ei.id AND w.workstation_id IS NOT NULL) AS work_orders_with_workstation,
  (SELECT COUNT(*) FROM work_orders w WHERE w.equipment_instance_id = ei.id AND w.status = 'in_progress') AS active_orders,
  (SELECT COUNT(*) FROM work_order_operations o
     JOIN work_orders w ON w.id = o.work_order_id
    WHERE w.equipment_instance_id = ei.id AND o.hours_worked > 0) AS operations_with_hours,
  -- 5 齐套与领料
  (SELECT COUNT(*) FROM material_movements mm
    WHERE mm.movement_type = 'issue'
      AND mm.work_order_id IN (SELECT w.id FROM work_orders w WHERE w.equipment_instance_id = ei.id)) AS issue_movements,
  (SELECT COUNT(*) FROM serial_numbers s WHERE s.equipment_instance_id = ei.id) AS serials,
  -- 6 检验与证据
  (SELECT COUNT(*) FROM qc_inspections q WHERE q.equipment_instance_id = ei.id) AS inspections,
  (SELECT COUNT(*) FROM work_order_qc q
     JOIN work_orders w ON w.id = q.work_order_id
    WHERE w.equipment_instance_id = ei.id) AS work_order_qc,
  (SELECT COUNT(*) FROM weld_records r
     JOIN work_orders w ON w.id = r.work_order_id
    WHERE w.equipment_instance_id = ei.id) AS welds,
  (SELECT COUNT(*) FROM ndt_records r
     JOIN work_orders w ON w.id = r.work_order_id
    WHERE w.equipment_instance_id = ei.id) AS ndt,
  (SELECT COUNT(*) FROM assembly_records r
     JOIN work_orders w ON w.id = r.work_order_id
    WHERE w.equipment_instance_id = ei.id) AS assembly,
  -- 7 文档与图纸
  (SELECT COUNT(*) FROM documents d
    WHERE d.equipment_instance_id = ei.id
       OR d.work_order_id IN (SELECT w.id FROM work_orders w WHERE w.equipment_instance_id = ei.id)) AS documents,
  -- 8 交付与成本
  (SELECT COUNT(*) FROM instance_milestones m
    WHERE m.equipment_instance_id = ei.id
      AND (m.phase_code LIKE '%deliver%' OR m.phase_name LIKE '%交付%' OR m.phase_name LIKE '%验收%')) AS delivery_milestones,
  (SELECT COUNT(*) FROM project_cost_entries c WHERE c.equipment_instance_id = ei.id AND c.deleted_at IS NULL) AS cost_entries,
  (SELECT COUNT(DISTINCT c.cost_type) FROM project_cost_entries c WHERE c.equipment_instance_id = ei.id AND c.deleted_at IS NULL) AS cost_types
FROM equipment_instances ei
`;

// 现场实时状态：在健康指标视图上再收敛一层，接口只读这一张
const INSTANCE_LIVE_STATUS = `
CREATE VIEW IF NOT EXISTS v_instance_live_status AS
SELECT
  instance_id AS id,
  instance_code,
  instance_name,
  status,
  lifecycle_stage,
  active_orders,
  blocked_nodes
FROM v_instance_health_metrics
`;

// 顺序有依赖：v_dashboard_counts 依赖 v_risk_counts
const READ_MODEL_VIEWS = [
  RISK_COUNTS,
  DASHBOARD_COUNTS,
  WORK_ORDER_STATUS,
  PROCESS_NODE_STATUS,
  INSTANCE_STATUS,
  LONG_LEADTIME,
  INSTANCE_HEALTH_METRICS,
  INSTANCE_LIVE_STATUS,
];

/**
 * 创建只读视图（幂等）。
 * 由 reportService 的 register 调用；DDL 计入 reportService 的 schemaVersion。
 */
function ensureReadModel(db) {
  for (const sql of READ_MODEL_VIEWS) {
    db.exec(sql);
  }
}

module.exports = { ensureReadModel, READ_MODEL_VIEWS };
