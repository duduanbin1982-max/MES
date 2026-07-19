// services/reportService/dashboard.js
// 全局看板: 实例/工单/节点/BOM/长交期关键件 总览
const { wrap } = require('../../middleware/asyncHandler');

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
}

module.exports = { register }
