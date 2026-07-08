const { ApiError } = require('../app/errors');
const { wrap } = require('../middleware/asyncHandler');
// services/workOrderService.js
const { emit, Events } = require("../app/ws/EventBus");
// P0-#1 拆 server.js: 工单/工序操作/焊缝记录
// Author: 三狗子 | Date: 2026-06-23

function register(app, db, auth) {
  const { createEngine } = require("../app/workflow/engine");
  const wf = createEngine(db);
  const all = (sql, params = []) => db.prepare(sql).all(params);
  const get = (sql, params = []) => db.prepare(sql).get(params);
  const run = (sql, params = []) => db.prepare(sql).run(params);

  // Step 1: Add columns (idempotent via try/catch)
  const addColumn = (table, colDef) => {
    try { run("ALTER TABLE " + table + " ADD COLUMN " + colDef); }
    catch (e) { /* column already exists */ }
  };
  addColumn("work_orders", "assigned_to INTEGER REFERENCES users(id)");
  addColumn("work_orders", "dispatched_at TEXT");
  addColumn("work_orders", "quantity_planned INTEGER DEFAULT 1");
  addColumn("work_orders", "quantity_completed INTEGER DEFAULT 0");
  addColumn("resource_allocations", "work_order_id INTEGER REFERENCES work_orders(id)");
  addColumn("work_order_operations", "quantity_completed INTEGER DEFAULT 0");
  addColumn("work_order_operations", "defect_quantity INTEGER DEFAULT 0");


app.get('/api/work_orders', wrap((req, res) => {
  const { equipment_instance_id, subsystem_id, status } = req.query;
  let sql = "SELECT wo.*, ei.instance_code, ei.instance_name, es.name_zh as subsystem_name FROM work_orders wo LEFT JOIN equipment_instances ei ON wo.equipment_instance_id = ei.id LEFT JOIN equipment_subsystems es ON wo.subsystem_id = es.id WHERE 1=1";
  const params = [];
  if (equipment_instance_id) { sql += ' AND wo.equipment_instance_id = ?'; params.push(equipment_instance_id); }
  if (subsystem_id) { sql += ' AND wo.subsystem_id = ?'; params.push(subsystem_id); }
  if (status) { sql += ' AND wo.status = ?'; params.push(status); }
  sql += ' ORDER BY wo.created_at DESC';
  res.json(all(sql, params));
}));

// 2. GET /api/work_orders/dispatchable — 可派工列表 (MUST be before /:id)
app.get('/api/work_orders/dispatchable', wrap((req, res) => {
  const list = all(
    "SELECT wo.id, wo.wo_code, wo.title, ei.instance_code, wo.priority, wo.planned_start, wo.planned_end, wo.status FROM work_orders wo LEFT JOIN equipment_instances ei ON wo.equipment_instance_id = ei.id WHERE wo.status = 'pending' AND wo.assigned_to IS NULL ORDER BY wo.priority DESC, wo.created_at ASC"
  );
  res.json(list);
}));

app.get('/api/work_orders/:id', wrap((req, res) => {
  const wo = get("SELECT wo.*, ei.instance_code, es.name_zh as subsystem_name FROM work_orders wo LEFT JOIN equipment_instances ei ON wo.equipment_instance_id = ei.id LEFT JOIN equipment_subsystems es ON wo.subsystem_id = es.id WHERE wo.id = ?", req.params.id);
  if (!wo) throw ApiError.notFound('not found')
  wo.operations = all('SELECT * FROM work_order_operations WHERE work_order_id = ? ORDER BY timestamp', req.params.id);
  res.json(wo);
}));

app.post('/api/work_orders', auth.onlyForemanOrAdmin, wrap((req, res) => {
  const { wo_code, equipment_instance_id, milestone_id, subsystem_id, title, workstation_id, estimated_hours, planned_start } = req.body;
  if (!wo_code || !equipment_instance_id || !title) throw ApiError.validation('wo_code/equipment_instance_id/title 必填')
  const r = run("INSERT INTO work_orders (wo_code, equipment_instance_id, milestone_id, subsystem_id, title, workstation_id, estimated_hours, planned_start, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')",
    [wo_code, equipment_instance_id, milestone_id || null, subsystem_id || null, title, workstation_id || null, estimated_hours || null, planned_start || null]);
  res.json({ id: r.lastInsertRowid });
}));

app.post('/api/work_orders/:id/operations', wrap((req, res) => {
  const { operator_id, action, hours_worked, notes } = req.body;
  const r = run("INSERT INTO work_order_operations (work_order_id, operator_id, action, hours_worked, notes) VALUES (?, ?, ?, ?, ?)",
    [req.params.id, operator_id || null, action, hours_worked || null, notes || null]);
  if (action === 'start') { run("UPDATE work_orders SET status = 'in_progress', actual_start = COALESCE(actual_start, datetime('now')) WHERE id = ?", req.params.id); emit(Events.WORKORDER_STATUS_CHANGED, { wo_id: req.params.id, status: 'in_progress', operator_id }); }
  else if (action === 'complete') { run("UPDATE work_orders SET status = 'completed', actual_end = datetime('now') WHERE id = ?", req.params.id); emit(Events.WORKORDER_STATUS_CHANGED, { wo_id: req.params.id, status: 'completed', operator_id }); }
  else if (action === 'pause') { run("UPDATE work_orders SET status = 'paused' WHERE id = ?", req.params.id); emit(Events.WORKORDER_STATUS_CHANGED, { wo_id: req.params.id, status: 'paused', operator_id }); }
  res.json({ id: r.lastInsertRowid });
}));

// P0-5: 工作流驱动的工单状态迁移
  app.post('/api/work_orders/:id/transit', wrap((req, res) => {
    const { action, comment } = req.body;
    if (!action) throw ApiError.validation('action 必填')

    let wfInst = db.prepare("SELECT * FROM workflow_instances WHERE entity_type = 'work_order' AND entity_id = ? ORDER BY id DESC LIMIT 1").get(req.params.id);
    if (!wfInst) {
      const wo = get("SELECT * FROM work_orders WHERE id = ?", req.params.id);
      if (!wo) throw ApiError.notFound('工单不存在')
      const r = wf.start("work_order", "work_order", Number(req.params.id), {
        assigned_to: req.user && req.user.sub,
        data: { wo_code: wo.wo_code, title: wo.title },
        created_by: req.user && req.user.sub,
        comment: "从 " + (wo.status || "created") + " 迁移",
      });
      wfInst = r.instance;
    }

    const result = wf.transit(Number(wfInst.id), action, req.user && req.user.sub, comment);

    // 同步 status 到 work_orders 表
    if (result.instance.current_state) {
      const state = result.instance.current_state;
      if (state === "in_progress") run("UPDATE work_orders SET status = 'in_progress', actual_start = COALESCE(actual_start, datetime('now')) WHERE id = ?", req.params.id);
      else if (state === "completed") run("UPDATE work_orders SET status = 'completed', actual_end = datetime('now') WHERE id = ?", req.params.id);
      else if (state === "paused") run("UPDATE work_orders SET status = 'paused' WHERE id = ?", req.params.id);
      else run("UPDATE work_orders SET status = ? WHERE id = ?", [state, req.params.id]);
    }

    res.json(result);
  }));

  // 查询工单的 workflow 状态
  app.get('/api/work_orders/:id/workflow', wrap((req, res) => {
    const instances = wf.getInstancesByEntity("work_order", Number(req.params.id));
    res.json(instances);
  }));

app.post('/api/work_orders/:id/welds', auth.onlyWelder, wrap((req, res) => {
  const { weld_no, welder_id, material_lot_id, weld_length_mm } = req.body;
  if (!weld_no || !welder_id) throw ApiError.validation('weld_no/welder_id 必填')
  const r = run("INSERT INTO weld_records (work_order_id, weld_no, welder_id, material_lot_id, weld_length_mm) VALUES (?, ?, ?, ?, ?)",
    [req.params.id, weld_no, welder_id, material_lot_id || null, weld_length_mm || null]);
  res.json({ id: r.lastInsertRowid });
}));

// ============ Part A: 派工 + 扫码上报 ============

// 1. PUT /api/work_orders/:id/dispatch — 派工
app.put('/api/work_orders/:id/dispatch', wrap((req, res) => {
  const { user_id, workstation_id, planned_start, planned_end, notes } = req.body;
  if (!user_id) throw ApiError.validation('user_id 必填');

  const wo = get("SELECT * FROM work_orders WHERE id = ?", req.params.id);
  if (!wo) throw ApiError.notFound('工单不存在');
  if (wo.status !== 'pending') throw ApiError.validation('只能派工 pending 状态的工单');

  run(
    "UPDATE work_orders SET assigned_to = ?, workstation_id = COALESCE(?, workstation_id), planned_start = COALESCE(?, planned_start), planned_end = COALESCE(?, planned_end), status = 'dispatched', dispatched_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
    [user_id, workstation_id || null, planned_start || null, planned_end || null, req.params.id]
  );

  run(
    "INSERT INTO resource_allocations (work_order_id, user_id, workstation_id, equipment_instance_id, assigned_at, status, notes) VALUES (?, ?, ?, ?, datetime('now'), 'active', ?)",
    [req.params.id, user_id, workstation_id || wo.workstation_id || null, wo.equipment_instance_id, notes || null]
  );

  const updated = get("SELECT wo.*, ei.instance_code FROM work_orders wo LEFT JOIN equipment_instances ei ON wo.equipment_instance_id = ei.id WHERE wo.id = ?", req.params.id);
  res.json(updated);
}));

// 3. POST /api/work_orders/:id/report — 扫码数量上报
app.post('/api/work_orders/:id/report', wrap((req, res) => {
  const { user_id, hours_worked, quantity_completed, defect_quantity, notes } = req.body;
  if (!user_id) throw ApiError.validation('user_id 必填');

  const wo = get("SELECT * FROM work_orders WHERE id = ?", req.params.id);
  if (!wo) throw ApiError.notFound('工单不存在');
  if (wo.status !== 'dispatched' && wo.status !== 'in_progress') throw ApiError.validation('只能上报 dispatched/in_progress 状态的工单');

  const qtyDone = (wo.quantity_completed || 0) + (quantity_completed || 0);
  const hrsDone = (wo.actual_hours || 0) + (hours_worked || 0);

  if (qtyDone >= (wo.quantity_planned || 1)) {
    run("UPDATE work_orders SET actual_hours = ?, quantity_completed = ?, status = 'completed', actual_end = COALESCE(actual_end, datetime('now')), updated_at = datetime('now') WHERE id = ?",
      [hrsDone, qtyDone, req.params.id]);
  } else {
    run("UPDATE work_orders SET actual_hours = ?, quantity_completed = ?, updated_at = datetime('now') WHERE id = ?",
      [hrsDone, qtyDone, req.params.id]);
  }

  const r = run(
    "INSERT INTO work_order_operations (work_order_id, operator_id, action, hours_worked, quantity_completed, defect_quantity, notes) VALUES (?, ?, 'report', ?, ?, ?, ?)",
    [req.params.id, user_id, hours_worked || null, quantity_completed || 0, defect_quantity || 0, notes || null]
  );

  res.json({ id: r.lastInsertRowid, quantity_completed: qtyDone, message: '上报已记录' });
}));

}

module.exports = { register };
