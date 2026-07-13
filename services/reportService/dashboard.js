// services/reportService/dashboard.js
// 全局看板: 实例/工单/节点/BOM/长交期关键件 总览
// 2026-07-12 Hermes K-1 扩展: 加 long-leadtime + live-status endpoints
const { wrap } = require('../../middleware/asyncHandler');
function register(app, db) {
  const { all, get } = require('./_helpers').makeHelpers(db)

  app.get('/api/dashboard', wrap((req, res) => {
    res.json({
      equipment_types: get('SELECT count(*) c FROM equipment_types WHERE is_active = 1').c,
      equipment_models: get('SELECT count(*) c FROM equipment_models').c,
      instances: { total: get('SELECT count(*) c FROM equipment_instances').c, by_status: all('SELECT status, count(*) c FROM equipment_instances GROUP BY status') },
      work_orders: { total: get('SELECT count(*) c FROM work_orders').c, by_status: all('SELECT status, count(*) c FROM work_orders GROUP BY status') },
      process_nodes: { total: get('SELECT count(*) c FROM process_nodes').c, by_status: all('SELECT status, count(*) c FROM process_nodes GROUP BY status') },
      bom_total: get('SELECT count(*) c FROM instance_bom').c,
      key_components: get('SELECT count(*) c FROM key_components').c,
      long_leadtime: get('SELECT count(*) c FROM key_components WHERE lead_time_weeks >= 12').c,
      open_eco: get("SELECT count(*) c FROM instance_eco WHERE status='open'").c,
      open_field_service: get("SELECT count(*) c FROM field_service WHERE status='open'").c
    })
  }))

  // Long-leadtime 材料明细
  app.get('/api/dashboard/long-leadtime', wrap((req, res) => {
    const items = all(
      `SELECT m.material_code, m.material_name, kc.lead_time_weeks, kc.supplier, kc.unit_price
       FROM key_components kc
       JOIN materials m ON kc.material_id = m.id
       WHERE kc.lead_time_weeks >= 12
       ORDER BY kc.lead_time_weeks DESC
       LIMIT 50`
    );
    res.json({ items });
  }));

  // 实例实时状态
  app.get('/api/dashboard/live-status', wrap((req, res) => {
    const items = all(
      `SELECT ei.id, ei.instance_code, ei.instance_name, ei.status, ei.lifecycle_stage,
              (SELECT COUNT(*) FROM work_orders wo WHERE wo.equipment_instance_id = ei.id AND wo.status='in_progress') AS active_orders,
              (SELECT COUNT(*) FROM process_nodes pn WHERE pn.equipment_instance_id = ei.id AND pn.status='blocked') AS blocked_nodes
       FROM equipment_instances ei
       ORDER BY (CASE ei.status WHEN 'in_production' THEN 0 WHEN 'design' THEN 1 ELSE 2 END), ei.id`
    );
    res.json({ items, total: items.length, as_of: new Date().toISOString() });
  }));
}
module.exports = { register }
