// 报表: 项目进度 / 设备状态 / 工单汇总 / 关键件到货
const { wrap } = require('../../middleware/asyncHandler');
function register(app, db) {
  const { all, get } = require('./_helpers').makeHelpers(db)

  app.get('/api/reports/project_progress', wrap((req, res) => {
    const instances = all('SELECT * FROM equipment_instances ORDER BY created_at DESC')
    // Fix N+1: batch query all wo/pn stats
    const woStats = {}
    for (const r of all("SELECT equipment_instance_id, count(*) total, sum(CASE WHEN status='completed' THEN 1 ELSE 0 END) completed FROM work_orders GROUP BY equipment_instance_id"))
      woStats[r.equipment_instance_id] = r
    const pnStats = {}
    for (const r of all("SELECT equipment_instance_id, count(*) total, sum(CASE WHEN status='completed' THEN 1 ELSE 0 END) completed, sum(CASE WHEN status='in_progress' THEN 1 ELSE 0 END) in_progress, sum(CASE WHEN status='blocked' THEN 1 ELSE 0 END) blocked FROM process_nodes GROUP BY equipment_instance_id"))
      pnStats[r.equipment_instance_id] = r

    const report = instances.map((inst) => {
      const wo = woStats[inst.id] || { total: 0, completed: 0 }
      const pn = pnStats[inst.id] || { total: 0, completed: 0, in_progress: 0, blocked: 0 }
      return {
        instance_code: inst.instance_code, instance_name: inst.instance_name,
        customer: inst.customer_name, status: inst.status, lifecycle: inst.lifecycle_stage,
        planned_start: inst.planned_start, planned_end: inst.planned_end,
        contract_amount: inst.contract_amount,
        work_orders: { total: wo.total, completed: wo.completed, progress_pct: wo.total ? Math.round(wo.completed * 100 / wo.total) : 0 },
        process_nodes: { total: pn.total, completed: pn.completed, in_progress: pn.in_progress, blocked: pn.blocked, progress_pct: pn.total ? Math.round(pn.completed * 100 / pn.total) : 0 }
      }
    })
    res.json({ count: report.length, projects: report })
  }))

  app.get('/api/reports/equipment_status', wrap((req, res) => {
    const by_status = all("SELECT status, lifecycle_stage, count(*) as cnt FROM equipment_instances GROUP BY status, lifecycle_stage ORDER BY status, lifecycle_stage")
    const by_type = all("SELECT et.name_zh as type_name, count(*) as cnt FROM equipment_instances ei JOIN equipment_models em ON ei.equipment_model_id = em.id JOIN equipment_types et ON em.equipment_type_id = et.id GROUP BY et.name_zh ORDER BY cnt DESC")
    const totals = get("SELECT count(*) as total, sum(contract_amount) as total_amount FROM equipment_instances") || {}
    res.json({ totals, by_status_lifecycle: by_status, by_type })
  }))

  app.get('/api/reports/work_order_summary', wrap((req, res) => {
    const by_status = all("SELECT status, count(*) as cnt, sum(estimated_hours) as total_est_hours, sum(actual_hours) as total_actual_hours FROM work_orders GROUP BY status")
    const by_subsystem = all("SELECT es.name_zh as subsystem, count(*) as cnt, sum(CASE WHEN wo.status='completed' THEN 1 ELSE 0 END) as completed FROM work_orders wo LEFT JOIN equipment_subsystems es ON wo.subsystem_id = es.id GROUP BY es.name_zh ORDER BY cnt DESC")
    const overdue = all("SELECT wo.*, ei.instance_code FROM work_orders wo JOIN equipment_instances ei ON wo.equipment_instance_id = ei.id WHERE wo.status NOT IN ('completed','cancelled') AND wo.planned_end < date('now') ORDER BY wo.planned_end LIMIT 20")
    res.json({ by_status, by_subsystem, overdue_count: overdue.length, overdue })
  }))

  app.get('/api/reports/key_components_arrival', wrap((req, res) => {
    const items = all("SELECT kc.*, m.material_name, m.spec, m.default_supplier FROM key_components kc JOIN materials m ON kc.material_id = m.id ORDER BY kc.lead_time_weeks DESC")
    const summary = {
      total: items.length,
      high_risk: items.filter(i => i.lead_time_weeks >= 16).length,
      medium_risk: items.filter(i => i.lead_time_weeks >= 12 && i.lead_time_weeks < 16).length,
      total_lead_weeks: items.reduce((sum, i) => sum + (i.lead_time_weeks || 0), 0)
    }
    res.json({ summary, items })
  }))
}
module.exports = { register }
