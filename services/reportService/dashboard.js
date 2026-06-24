// 全局看板: 实例/工单/节点/BOM/长交期关键件 总览
function register(app, db) {
  const { all, get, wrap } = require('./_helpers').makeHelpers(db)

  app.get('/api/dashboard', wrap((req, res) => {
    res.json({
      equipment_types: get('SELECT count(*) c FROM equipment_types WHERE is_active = 1').c,
      equipment_models: get('SELECT count(*) c FROM equipment_models').c,
      instances: { total: get('SELECT count(*) c FROM equipment_instances').c, by_status: all('SELECT status, count(*) c FROM equipment_instances GROUP BY status') },
      work_orders: { total: get('SELECT count(*) c FROM work_orders').c, by_status: all('SELECT status, count(*) c FROM work_orders GROUP BY status') },
      process_nodes: { total: get('SELECT count(*) c FROM process_nodes').c, by_status: all('SELECT status, count(*) c FROM process_nodes GROUP BY status') },
      bom_total: get('SELECT count(*) c FROM instance_bom').c,
      key_components: get('SELECT count(*) c FROM key_components').c,
      long_leadtime: get('SELECT count(*) c FROM key_components WHERE lead_time_weeks >= 12').c
    })
  }))
}

module.exports = { register }