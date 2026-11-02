// services/reportService/dashboard.js
// 全局看板: 实例/工单/节点/BOM/长交期关键件 总览
//
// 2026-11-02：跨域聚合读统一走只读视图（./schema.js），本文件不再直接 SELECT 别的模块的表。
// 收益：① 跨域 SQL 集中到一处；② /api/dashboard/process-health 从「每实例 ~22 次 count」
// 降为「整页 1 次查询」；③ 业务模块改表只需同步改视图。
const { wrap } = require('../../middleware/asyncHandler');
const { metric, evaluateStage, summarize } = require('../../app/processHealth');
const { ensureReadModel } = require('./schema');

function register(app, db) {
  // 只读视图是 reportService 自己拥有的 DDL，注册时幂等创建（DDL 计入 schemaVersion）
  ensureReadModel(db);

  const { all, get } = require('./_helpers').makeHelpers(db)

  function safeAll(sql, params = []) {
    try {
      return all(sql, params)
    } catch (_error) {
      return []
    }
  }

  function safeGet(sql, params = []) {
    try {
      return get(sql, params) || null
    } catch (_error) {
      return null
    }
  }

  function num(value) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  function dashboardCounts() {
    return safeGet('SELECT * FROM v_dashboard_counts') || {}
  }

  function buildRiskSummary(riskCounts) {
    const today = new Date().toISOString().replace('T', ' ').slice(0, 19)
    // 允许调用方传入已取到的计数（/api/dashboard 复用同一次查询，避免重复 count）
    const counts = riskCounts || safeGet('SELECT * FROM v_risk_counts') || {}
    const workOrderDelays = num(counts.work_order_delays)
    const processNodeDelays = num(counts.process_node_delays)
    const delays = workOrderDelays + processNodeDelays
    const longLeadtime = num(counts.long_leadtime)
    const openEco = num(counts.open_eco)
    const openFieldService = num(counts.open_field_service)
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
    // 一次查询拿到全部头部计数，风险口径复用同一行（v_dashboard_counts 已内联 v_risk_counts）
    const counts = dashboardCounts()
    const riskSummary = buildRiskSummary(counts)
    res.json({
      equipment_types: num(counts.equipment_types_active),
      equipment_models: num(counts.equipment_models),
      instances: {
        total: num(counts.instances_total),
        by_status: safeAll('SELECT status, c FROM v_instance_status_counts'),
      },
      work_orders: {
        total: num(counts.work_orders_total),
        by_status: safeAll('SELECT status, c FROM v_work_order_status_counts'),
      },
      process_nodes: {
        total: num(counts.process_nodes_total),
        by_status: safeAll('SELECT status, c FROM v_process_node_status_counts'),
      },
      bom_total: num(counts.bom_total),
      key_components: num(counts.key_components_total),
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
      `SELECT material_code, material_name, lead_time_weeks, supplier, unit_price
       FROM v_long_leadtime_components
       ORDER BY lead_time_weeks DESC
       LIMIT 50`
    )
    res.json({ items })
  }))

  app.get('/api/dashboard/live-status', wrap((req, res) => {
    const items = safeAll(
      `SELECT id, instance_code, instance_name, status, lifecycle_stage, active_orders, blocked_nodes
       FROM v_instance_live_status
       ORDER BY (CASE status WHEN 'in_production' THEN 0 WHEN 'design' THEN 1 ELSE 2 END), id`
    )
    res.json({ items, total: items.length, as_of: new Date().toISOString() })
  }))

  // 2026-10-19：全流程健康检查 —— 一眼看出 8 个环节哪些有数据、哪些卡住、下一步补哪
  // 2026-11-02：指标全部取自 v_instance_health_metrics（一行一实例），不再逐项 count
  function metricsFromRow(row) {
    const n = (key) => num(row[key])
    return {
      project: [
        metric("milestones", "里程碑", n('milestones'), 1),
        metric("contract", "合同号", n('has_contract'), 1),
      ],
      design_bom: [
        metric("bom_rows", "BOM 行", n('bom_rows')),
        metric("bom_with_material", "挂物料", n('bom_with_material')),
        metric("bom_with_lot", "挂实装批次", n('bom_with_lot')),
        metric("eco", "ECO", n('eco')),
      ],
      process: [
        metric("nodes", "工序节点", n('nodes')),
        metric("nodes_scheduled", "有排程时间", n('nodes_scheduled')),
        metric("nodes_with_workstation", "有工位", n('nodes_with_workstation')),
      ],
      execution: [
        metric("work_orders", "工单", n('work_orders')),
        metric("work_orders_with_workstation", "已派工位", n('work_orders_with_workstation')),
        metric("operations_with_hours", "有工时的报工", n('operations_with_hours')),
      ],
      material: [
        metric("lots", "已挂批次", n('lots')),
        metric("issue_movements", "领料流水", n('issue_movements')),
        metric("serials", "序列号", n('serials')),
      ],
      quality: [
        metric("inspections", "检验记录", n('inspections')),
        metric("work_order_qc", "工单检验", n('work_order_qc')),
        metric("welds", "焊缝", n('welds')),
        metric("ndt", "NDT", n('ndt')),
        metric("assembly", "装配记录", n('assembly')),
      ],
      documents: [
        metric("documents", "文档", n('documents')),
      ],
      delivery_cost: [
        metric("delivery_milestones", "交付/验收里程碑", n('delivery_milestones')),
        metric("delivery_orders", "交付单", n('delivery_orders')),
        metric("acceptance_records", "验收单", n('acceptance_records')),
        metric("cost_entries", "成本台账", n('cost_entries')),
        metric("cost_types", "成本类型数", n('cost_types')),
      ],
    }
  }

  function buildProcessHealthFromRow(row) {
    const metricsByStage = metricsFromRow(row)
    const order = ["project", "design_bom", "process", "execution", "material", "quality", "documents", "delivery_cost"]
    const stages = order.map((key) => evaluateStage(key, metricsByStage[key] || []))
    return { stages, summary: summarize(stages) }
  }

  app.get('/api/dashboard/process-health', wrap((req, res) => {
    // 整页一次查询：原来每个实例 ~22 次 count，5 个实例约 110 次
    const rows = safeAll('SELECT * FROM v_instance_health_metrics ORDER BY instance_id')
    const evaluated = rows.map((row) => ({ row, health: buildProcessHealthFromRow(row) }))
    const briefs = evaluated.map(({ row, health }) => ({
      id: row.instance_id,
      instance_code: row.instance_code,
      instance_name: row.instance_name,
      status: row.status,
      progress_pct: row.progress_pct,
      score: health.summary.score,
      grade: health.summary.grade,
      counts: health.summary.counts,
    }))
    const requested = Number(req.query.instance_id) || null
    const selectedEntry = requested
      ? evaluated.find((entry) => Number(entry.row.instance_id) === requested) || null
      : evaluated.slice().sort((left, right) => right.health.summary.score - left.health.summary.score)[0] || null
    const selected = selectedEntry
      ? { instance_id: selectedEntry.row.instance_id, ...selectedEntry.health }
      : { instance_id: null, stages: [], summary: summarize([]) }
    res.json({ as_of: new Date().toISOString(), instances: briefs, selected })
  }))
}

module.exports = { register }
