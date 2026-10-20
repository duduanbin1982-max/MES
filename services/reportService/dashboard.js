// services/reportService/dashboard.js
// 全局看板: 实例/工单/节点/BOM/长交期关键件 总览
const { wrap } = require('../../middleware/asyncHandler');
const { metric, evaluateStage, summarize } = require('../../app/processHealth');

function register(app, db) {
  const { all, get } = require('./_helpers').makeHelpers(db)

  function safeAll(sql, params = []) {
    try {
      return all(sql, params)
    } catch (_error) {
      return []
    }
  }

  function safeCount(sql, params = []) {
    try {
      return Number((get(sql, params) || {}).c || 0)
    } catch (_error) {
      return 0
    }
  }

  function buildRiskSummary() {
    const today = new Date().toISOString().replace('T', ' ').slice(0, 19)
    const workOrderDelays = safeCount(
      "SELECT count(*) c FROM work_orders WHERE planned_end < ? AND planned_end IS NOT NULL AND status NOT IN ('completed', 'cancelled')",
      [today]
    )
    const processNodeDelays = safeCount(
      "SELECT count(*) c FROM process_nodes WHERE planned_end < ? AND planned_end IS NOT NULL AND status NOT IN ('completed', 'cancelled')",
      [today]
    )
    const delays = workOrderDelays + processNodeDelays
    const longLeadtime = safeCount('SELECT count(*) c FROM key_components WHERE lead_time_weeks >= 12')
    const openEco = safeCount("SELECT count(*) c FROM instance_eco WHERE status='open'")
    const openFieldService = safeCount("SELECT count(*) c FROM field_service WHERE status='open'")
    const total = delays + longLeadtime + openEco + openFieldService
    const level = total >= 10
      ? { type: 'danger', label: '高风险' }
      : total >= 4
        ? { type: 'warning', label: '需关注' }
        : { type: 'success', label: '平稳' }

    return {
      total,
      level,
      today,
      delays: {
        work_order_delays: workOrderDelays,
        process_node_delays: processNodeDelays,
        total: delays,
        today,
      },
      sources: {
        delays,
        long_leadtime: longLeadtime,
        open_eco: openEco,
        open_field_service: openFieldService,
      },
      items: [
        { key: 'delays', label: '延误项', value: delays, hint: '工单与工序延期', type: delays ? 'danger' : 'success' },
        { key: 'long_leadtime', label: '长交期关键件', value: longLeadtime, hint: '采购到货风险', type: longLeadtime ? 'warning' : 'success' },
        { key: 'open_eco', label: '待处理 ECO', value: openEco, hint: '设计变更影响', type: openEco ? 'warning' : 'success' },
        { key: 'open_field_service', label: '服务工单', value: openFieldService, hint: '现场/售后问题', type: openFieldService ? 'info' : 'success' },
      ],
    }
  }

  app.get('/api/dashboard', wrap((req, res) => {
    const riskSummary = buildRiskSummary()
    res.json({
      equipment_types: safeCount('SELECT count(*) c FROM equipment_types WHERE is_active = 1'),
      equipment_models: safeCount('SELECT count(*) c FROM equipment_models'),
      instances: {
        total: safeCount('SELECT count(*) c FROM equipment_instances'),
        by_status: safeAll('SELECT status, count(*) c FROM equipment_instances GROUP BY status'),
      },
      work_orders: {
        total: safeCount('SELECT count(*) c FROM work_orders'),
        by_status: safeAll('SELECT status, count(*) c FROM work_orders GROUP BY status'),
      },
      process_nodes: {
        total: safeCount('SELECT count(*) c FROM process_nodes'),
        by_status: safeAll('SELECT status, count(*) c FROM process_nodes GROUP BY status'),
      },
      bom_total: safeCount('SELECT count(*) c FROM instance_bom'),
      key_components: safeCount('SELECT count(*) c FROM key_components'),
      long_leadtime: riskSummary.sources.long_leadtime,
      open_eco: riskSummary.sources.open_eco,
      open_field_service: riskSummary.sources.open_field_service,
      risk_summary: riskSummary,
    })
  }))

  app.get('/api/dashboard/risk-summary', wrap((req, res) => {
    res.json(buildRiskSummary())
  }))

  app.get('/api/dashboard/long-leadtime', wrap((req, res) => {
    const items = safeAll(
      `SELECT m.material_code, m.material_name, kc.lead_time_weeks, kc.supplier, kc.unit_price
       FROM key_components kc
       JOIN materials m ON kc.material_id = m.id
       WHERE kc.lead_time_weeks >= 12
       ORDER BY kc.lead_time_weeks DESC
       LIMIT 50`
    )
    res.json({ items })
  }))

  app.get('/api/dashboard/live-status', wrap((req, res) => {
    const items = safeAll(
      `SELECT ei.id, ei.instance_code, ei.instance_name, ei.status, ei.lifecycle_stage,
              (SELECT COUNT(*) FROM work_orders wo WHERE wo.equipment_instance_id = ei.id AND wo.status='in_progress') AS active_orders,
              (SELECT COUNT(*) FROM process_nodes pn WHERE pn.equipment_instance_id = ei.id AND pn.status='blocked') AS blocked_nodes
       FROM equipment_instances ei
       ORDER BY (CASE ei.status WHEN 'in_production' THEN 0 WHEN 'design' THEN 1 ELSE 2 END), ei.id`
    )
    res.json({ items, total: items.length, as_of: new Date().toISOString() })
  }))

  // 2026-10-19：全流程健康检查 —— 一眼看出 8 个环节哪些有数据、哪些卡住、下一步补哪
  function buildProcessMetrics(instanceId) {
    const c = (sql, params = []) => safeCount(sql, params)
    return {
      project: [
        metric("milestones", "里程碑", c('SELECT COUNT(*) c FROM instance_milestones WHERE equipment_instance_id = ?', [instanceId]), 1),
        metric("contract", "合同号", c("SELECT COUNT(*) c FROM equipment_instances WHERE id = ? AND contract_no IS NOT NULL AND contract_no <> ''", [instanceId]), 1),
      ],
      design_bom: [
        metric("bom_rows", "BOM 行", c('SELECT COUNT(*) c FROM instance_bom WHERE equipment_instance_id = ?', [instanceId])),
        metric("bom_with_material", "挂物料", c('SELECT COUNT(*) c FROM instance_bom WHERE equipment_instance_id = ? AND material_id IS NOT NULL', [instanceId])),
        metric("bom_with_lot", "挂实装批次", c('SELECT COUNT(*) c FROM instance_bom WHERE equipment_instance_id = ? AND material_lot_id IS NOT NULL', [instanceId])),
        metric("eco", "ECO", c('SELECT COUNT(*) c FROM instance_eco WHERE equipment_instance_id = ?', [instanceId])),
      ],
      process: [
        metric("nodes", "工序节点", c('SELECT COUNT(*) c FROM process_nodes WHERE equipment_instance_id = ?', [instanceId])),
        metric("nodes_scheduled", "有排程时间", c('SELECT COUNT(*) c FROM process_nodes WHERE equipment_instance_id = ? AND planned_start IS NOT NULL', [instanceId])),
        metric("nodes_with_workstation", "有工位", c('SELECT COUNT(*) c FROM process_nodes WHERE equipment_instance_id = ? AND required_workstation_id IS NOT NULL', [instanceId])),
      ],
      execution: [
        metric("work_orders", "工单", c('SELECT COUNT(*) c FROM work_orders WHERE equipment_instance_id = ?', [instanceId])),
        metric("work_orders_with_workstation", "已派工位", c('SELECT COUNT(*) c FROM work_orders WHERE equipment_instance_id = ? AND workstation_id IS NOT NULL', [instanceId])),
        metric("operations_with_hours", "有工时的报工", c('SELECT COUNT(*) c FROM work_order_operations o JOIN work_orders w ON w.id = o.work_order_id WHERE w.equipment_instance_id = ? AND o.hours_worked > 0', [instanceId])),
      ],
      material: [
        // 2026-10-20：原来数的是全库批次，导致"新建的空实例"也显示批次=19、齐套环节莫名"部分"；
        // 改为本实例 BOM 已挂的批次（去重）
        metric("lots", "已挂批次", c('SELECT COUNT(DISTINCT material_lot_id) c FROM instance_bom WHERE equipment_instance_id = ? AND material_lot_id IS NOT NULL', [instanceId])),
        metric("issue_movements", "领料流水", c("SELECT COUNT(*) c FROM material_movements mm WHERE mm.movement_type = 'issue' AND mm.work_order_id IN (SELECT id FROM work_orders WHERE equipment_instance_id = ?)", [instanceId])),
        metric("serials", "序列号", c('SELECT COUNT(*) c FROM serial_numbers WHERE equipment_instance_id = ?', [instanceId])),
      ],
      quality: [
        metric("inspections", "检验记录", c('SELECT COUNT(*) c FROM qc_inspections WHERE equipment_instance_id = ?', [instanceId])),
        metric("work_order_qc", "工单检验", c('SELECT COUNT(*) c FROM work_order_qc q JOIN work_orders w ON w.id = q.work_order_id WHERE w.equipment_instance_id = ?', [instanceId])),
        metric("welds", "焊缝", c('SELECT COUNT(*) c FROM weld_records wr JOIN work_orders w ON w.id = wr.work_order_id WHERE w.equipment_instance_id = ?', [instanceId])),
        metric("ndt", "NDT", c('SELECT COUNT(*) c FROM ndt_records nr JOIN work_orders w ON w.id = nr.work_order_id WHERE w.equipment_instance_id = ?', [instanceId])),
        metric("assembly", "装配记录", c('SELECT COUNT(*) c FROM assembly_records ar JOIN work_orders w ON w.id = ar.work_order_id WHERE w.equipment_instance_id = ?', [instanceId])),
      ],
      documents: [
        metric("documents", "文档", c('SELECT COUNT(*) c FROM documents WHERE equipment_instance_id = ? OR work_order_id IN (SELECT id FROM work_orders WHERE equipment_instance_id = ?)', [instanceId, instanceId])),
      ],
      delivery_cost: [
        metric("delivery_milestones", "交付/验收里程碑", c("SELECT COUNT(*) c FROM instance_milestones WHERE equipment_instance_id = ? AND (phase_code LIKE '%deliver%' OR phase_name LIKE '%交付%' OR phase_name LIKE '%验收%')", [instanceId])),
        metric("cost_entries", "成本台账", c('SELECT COUNT(*) c FROM project_cost_entries WHERE equipment_instance_id = ? AND deleted_at IS NULL', [instanceId])),
        metric("cost_types", "成本类型数", c('SELECT COUNT(DISTINCT cost_type) c FROM project_cost_entries WHERE equipment_instance_id = ? AND deleted_at IS NULL', [instanceId])),
      ],
    };
  }

  function buildProcessHealth(instanceId) {
    const metricsByStage = buildProcessMetrics(instanceId);
    const order = ["project", "design_bom", "process", "execution", "material", "quality", "documents", "delivery_cost"];
    const stages = order.map((key) => evaluateStage(key, metricsByStage[key] || []));
    return { stages, summary: summarize(stages) };
  }

  app.get('/api/dashboard/process-health', wrap((req, res) => {
    const instances = safeAll('SELECT id, instance_code, instance_name, status, progress_pct FROM equipment_instances ORDER BY id');
    const briefs = instances.map((inst) => {
      const { summary } = buildProcessHealth(inst.id);
      return { id: inst.id, instance_code: inst.instance_code, instance_name: inst.instance_name, status: inst.status, progress_pct: inst.progress_pct, score: summary.score, grade: summary.grade, counts: summary.counts };
    });
    const requested = Number(req.query.instance_id) || null;
    const selectedId = requested || (briefs.slice().sort((a, b) => b.score - a.score)[0] || {}).id || null;
    const selected = selectedId ? { instance_id: selectedId, ...buildProcessHealth(selectedId) } : { instance_id: null, stages: [], summary: summarize([]) };
    res.json({ as_of: new Date().toISOString(), instances: briefs, selected });
  }))
}

module.exports = { register }
