const { ApiError } = require('../app/errors');
const { wrap } = require('../middleware/asyncHandler');
// services/workOrderService.js
const { emit, Events } = require("../app/ws/EventBus");
const woStateMachine = require("./workOrder/stateMachine");
const woAudit = require("./workOrder/workflowAudit");
// F4 (brooks-audit): all status transitions go through stateMachine.plan/apply.
// P0-#1 ? server.js: ??/????/????
// Author: ??? | Date: 2026-06-23

function register(app, db, auth) {
  const all = (sql, params = []) => db.prepare(sql).all(params);
  const get = (sql, params = []) => db.prepare(sql).get(params);
  const run = (sql, params = []) => db.prepare(sql).run(params);

  // F9 (brooks-audit): helper available in db/schemaHelpers.js for future adoption.
  //   Keeping the inline addColumn here preserves the existing schema fingerprint
  //   (workOrderService@1) ? see plan: gradual migration across all 18 services.
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

// 2. GET /api/work_orders/dispatchable ? ????? (MUST be before /:id)
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
  if (!wo_code || !equipment_instance_id || !title) throw ApiError.validation('wo_code/equipment_instance_id/title ??')
  const r = run("INSERT INTO work_orders (wo_code, equipment_instance_id, milestone_id, subsystem_id, title, workstation_id, estimated_hours, planned_start, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')",
    [wo_code, equipment_instance_id, milestone_id || null, subsystem_id || null, title, workstation_id || null, estimated_hours || null, planned_start || null]);
  woAudit.startInstance(db, { id: Number(r.lastInsertRowid), wo_code, title, status: 'pending' }, req.user && req.user.sub);
  res.json({ id: r.lastInsertRowid });
}));

// F4 refactored: single state machine call replaces inline if/else
app.post('/api/work_orders/:id/operations', auth.foremanOrWorker, wrap((req, res) => {
  const { operator_id, action, hours_worked, notes } = req.body;
  const r = run("INSERT INTO work_order_operations (work_order_id, operator_id, action, hours_worked, notes) VALUES (?, ?, ?, ?, ?)",
    [req.params.id, operator_id || null, action, hours_worked || null, notes || null]);
  // Map operations.action -> state machine event
  // F6: 'start' -> start event; 'pause' -> pause event; 'complete' -> complete event
  const eventMap = { start: 'start', pause: 'pause', complete: 'complete' };
  const event = eventMap[action];
  if (!event) {
    res.json({ id: r.lastInsertRowid });
    return;
  }
  const wo = get("SELECT * FROM work_orders WHERE id = ?", req.params.id);
  if (!wo) throw ApiError.notFound('?????');
  try {
    const newStatus = woStateMachine.apply(wo, event, {}, run);
    woAudit.recordTransition(db, wo, event, wo.status, newStatus, (req.user && req.user.sub) || operator_id, notes || null, { operator_id: operator_id || null });
    emit(Events.WORKORDER_STATUS_CHANGED, { wo_id: Number(req.params.id), status: newStatus, operator_id });
  } catch (e) {
    if (e && e.code === 'VALIDATION_ERROR') {
      // Status transition not allowed from current state; ignore for ops log
    } else throw e;
  }
  res.json({ id: r.lastInsertRowid });
}));

  // 工单流转（2026-10-13 选项 ii）：action 名与工作流定义中的 action 同名，
  // 由 stateMachine（= workOrderDefinition 适配器）校验并写 work_orders，
  // 随后写审计流水；不再让 workflow 引擎反向驱动业务状态（避免双向写）。
  app.post('/api/work_orders/:id/transit', auth.onlyForemanOrAdmin, wrap((req, res) => {
    const { action, comment } = req.body;
    const wo = get("SELECT * FROM work_orders WHERE id = ?", req.params.id);
    if (!wo) throw ApiError.notFound('工单不存在');

    const event = String(action || '');
    const newStatus = woStateMachine.apply(wo, event, {}, run);
    woAudit.recordTransition(db, wo, event, wo.status, newStatus, req.user && req.user.sub, comment || null);
    emit(Events.WORKORDER_STATUS_CHANGED, { wo_id: Number(req.params.id), status: newStatus, actor_id: req.user && req.user.sub });
    res.json({ work_order: { id: Number(req.params.id), status: newStatus }, timeline: woAudit.getTimeline(db, Number(req.params.id)) });
  }));

  // ????? workflow ??
  app.get('/api/work_orders/:id/workflow', wrap((req, res) => {
    res.json(woAudit.getTimeline(db, Number(req.params.id)));
  }));

app.post('/api/work_orders/:id/welds', auth.onlyWelder, wrap((req, res) => {
  const { weld_no, welder_id, material_lot_id, weld_length_mm } = req.body;
  if (!weld_no || !welder_id) throw ApiError.validation('weld_no/welder_id ??')
  const r = run("INSERT INTO weld_records (work_order_id, weld_no, welder_id, material_lot_id, weld_length_mm) VALUES (?, ?, ?, ?, ?)",
    [req.params.id, weld_no, welder_id, material_lot_id || null, weld_length_mm || null]);
  res.json({ id: r.lastInsertRowid });
}));

// ============ Part A: ?? + ???? ============

// 1. PUT /api/work_orders/:id/dispatch ? ?? (F4 refactored)
app.put('/api/work_orders/:id/dispatch', auth.onlyForemanOrAdmin, wrap((req, res) => {
  const { user_id, workstation_id, planned_start, planned_end, notes } = req.body;
  if (!user_id) throw ApiError.validation('user_id ??');

  const wo = get("SELECT * FROM work_orders WHERE id = ?", req.params.id);
  if (!wo) throw ApiError.notFound('?????');

  // Pre-transition setters (workstation, planned dates, assigned_to) - then run state machine
  run(
    "UPDATE work_orders SET assigned_to = ?, workstation_id = COALESCE(?, workstation_id), planned_start = COALESCE(?, planned_start), planned_end = COALESCE(?, planned_end) WHERE id = ?",
    [user_id, workstation_id || null, planned_start || null, planned_end || null, req.params.id]
  );
  const woUpdated = get("SELECT * FROM work_orders WHERE id = ?", req.params.id);
  const dispatchedStatus = woStateMachine.apply(woUpdated, 'dispatch', {}, run);
  woAudit.recordTransition(db, woUpdated, 'dispatch', woUpdated.status, dispatchedStatus, (req.user && req.user.sub) || user_id, notes || null, { user_id, workstation_id: workstation_id || null });

  run(
    "INSERT INTO resource_allocations (work_order_id, user_id, workstation_id, equipment_instance_id, assigned_at, status, notes) VALUES (?, ?, ?, ?, datetime('now'), 'active', ?)",
    [req.params.id, user_id, workstation_id || woUpdated.workstation_id || null, woUpdated.equipment_instance_id, notes || null]
  );

  const updated = get("SELECT wo.*, ei.instance_code FROM work_orders wo LEFT JOIN equipment_instances ei ON wo.equipment_instance_id = ei.id WHERE wo.id = ?", req.params.id);
  res.json(updated);
}));

// 3. POST /api/work_orders/:id/report ? ?????? (F4 refactored)
app.post('/api/work_orders/:id/report', auth.foremanOrWorker, wrap((req, res) => {
  const { user_id, hours_worked, quantity_completed, defect_quantity, notes } = req.body;
  if (!user_id) throw ApiError.validation('user_id ??');

  const wo = get("SELECT * FROM work_orders WHERE id = ?", req.params.id);
  if (!wo) throw ApiError.notFound('?????');

  // State machine computes new status from accumulated quantity and emits setters
  let newStatus;
  try {
    newStatus = woStateMachine.apply(wo, 'report', { quantity_completed: quantity_completed || 0, hours_worked: hours_worked || 0 }, run);
    woAudit.recordTransition(db, wo, 'report', wo.status, newStatus, (req.user && req.user.sub) || user_id, notes || null,
      { quantity_completed: quantity_completed || 0, hours_worked: hours_worked || 0, defect_quantity: defect_quantity || 0 });
  } catch (e) {
    if (e && e.code === 'VALIDATION_ERROR') {
      throw ApiError.validation('???? dispatched/in_progress ?????');
    }
    throw e;
  }

  const r = run(
    "INSERT INTO work_order_operations (work_order_id, operator_id, action, hours_worked, quantity_completed, defect_quantity, notes) VALUES (?, ?, 'report', ?, ?, ?, ?)",
    [req.params.id, user_id, hours_worked || null, quantity_completed || 0, defect_quantity || 0, notes || null]
  );

  const qtyDone = (wo.quantity_completed || 0) + (quantity_completed || 0);
  res.json({ id: r.lastInsertRowid, quantity_completed: qtyDone, message: '?????' });
}));

}

module.exports = { register };
