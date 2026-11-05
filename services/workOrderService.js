"use strict";
// services/workOrderService.js
// 工单生命周期 API。
//
// 2026-11-05（工单管理模块审计整改）：
//   · 修掉全部乱码的用户可见文案（原 '??' / '?????'）；
//   · 创建/派工/改工位放行 planer（原只放行 foreman/admin，计划员看到派工按钮却 403）；
//   · 创建支持 planned_end / priority / description，并校验计划结束不早于开始；
//   · 派工前校验工单状态、人员在职、工位启用、同人重复派工（force 可越过）；
//   · 新增取消工单（stateMachine 的 cancel 事件此前没有入口）；
//   · 报工校验非负数，并返回是否超计划；
//   · 新增计划日期补齐（planned_end 有、planned_start 空的已排工单）；
//   · 状态流转错误文案改中文（app/workflow/workOrderDefinition.js）。
const { ApiError } = require('../app/errors');
const { wrap } = require('../middleware/asyncHandler');
const { emit, Events } = require('../app/ws/EventBus');
const woStateMachine = require('./workOrder/stateMachine');
const woAudit = require('./workOrder/workflowAudit');

const HOURS_PER_DAY = 8;

function register(app, db, auth) {
  const all = (sql, params = []) => db.prepare(sql).all(params);
  const get = (sql, params = []) => db.prepare(sql).get(params);
  const run = (sql, params = []) => db.prepare(sql).run(params);

  // 计划员可创建/派工/改工位；测试里只 mock 了旧守卫时退回旧守卫，保证向后兼容
  const canDispatch = auth.onlyForemanAdminOrPlanner || auth.onlyForemanOrAdmin;
  // 测试库/精简部署的 users 表可能没有 is_active 列（列存在才校验启用状态）
  const userColumns = (() => {
    try { return new Set(all('PRAGMA table_info(users)').map((column) => column.name)); }
    catch (_error) { return new Set(); }
  })();
  const hasUserActive = userColumns.has('is_active');

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

  const formatDate = (value) => {
    if (!value) return null;
    const raw = String(value).trim();
    const normalized = raw.length === 10 ? `${raw}T00:00:00` : raw.replace(' ', 'T');
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const formatSqlDate = (date) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };
  const addHoursToText = (value, hours) => {
    const date = formatDate(value);
    if (!date) return null;
    const next = new Date(date.getTime() + Number(hours || 0) * 3600 * 1000);
    return `${formatSqlDate(next)} ${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')}:${String(next.getSeconds()).padStart(2, '0')}`;
  };

  // 1. 列表
  app.get('/api/work_orders', wrap((req, res) => {
    const dataScope = require('../app/dataScope');
    const { equipment_instance_id, subsystem_id, status } = req.query;
    let sql = "SELECT wo.*, ei.instance_code, ei.instance_name, es.name_zh as subsystem_name, u.full_name AS assigned_name FROM work_orders wo LEFT JOIN equipment_instances ei ON wo.equipment_instance_id = ei.id LEFT JOIN equipment_subsystems es ON wo.subsystem_id = es.id LEFT JOIN users u ON u.id = wo.assigned_to WHERE 1=1";
    const params = [];
    if (equipment_instance_id) { sql += ' AND wo.equipment_instance_id = ?'; params.push(equipment_instance_id); }
    if (subsystem_id) { sql += ' AND wo.subsystem_id = ?'; params.push(subsystem_id); }
    if (status) { sql += ' AND wo.status = ?'; params.push(status); }
    const scopeFilter = dataScope.buildFilter('work_orders', dataScope.scopeOf(req), 'wo');
    if (scopeFilter.clause) { sql += ' AND ' + scopeFilter.clause; params.push(...scopeFilter.params); }
    sql += ' ORDER BY wo.created_at DESC';
    res.json(all(sql, params));
  }));

  // 2. 待派工（必须放在 /:id 之前）
  app.get('/api/work_orders/dispatchable', wrap((req, res) => {
    const list = all(
      "SELECT wo.id, wo.wo_code, wo.title, ei.instance_code, wo.priority, wo.planned_start, wo.planned_end, wo.status FROM work_orders wo LEFT JOIN equipment_instances ei ON wo.equipment_instance_id = ei.id WHERE wo.status = 'pending' AND wo.assigned_to IS NULL ORDER BY wo.priority DESC, wo.created_at ASC"
    );
    res.json(list);
  }));

  app.get('/api/work_orders/:id', wrap((req, res) => {
    const wo = get("SELECT wo.*, ei.instance_code, es.name_zh as subsystem_name, u.full_name AS assigned_name FROM work_orders wo LEFT JOIN equipment_instances ei ON wo.equipment_instance_id = ei.id LEFT JOIN equipment_subsystems es ON wo.subsystem_id = es.id LEFT JOIN users u ON u.id = wo.assigned_to WHERE wo.id = ?", [req.params.id]);
    if (!wo) throw ApiError.notFound('工单不存在');
    const dataScope = require('../app/dataScope');
    if (!dataScope.rowInScope('work_orders', dataScope.scopeOf(req), wo)) throw ApiError.forbidden('超出数据范围：该工单不在你的数据权限内');
    wo.operations = all('SELECT * FROM work_order_operations WHERE work_order_id = ? ORDER BY timestamp', [req.params.id]);
    res.json(wo);
  }));

  // 3. 创建
  app.post('/api/work_orders', canDispatch, wrap((req, res) => {
    const { wo_code, equipment_instance_id, milestone_id, subsystem_id, title, workstation_id, estimated_hours, planned_start, planned_end, priority, description } = req.body || {};
    if (!wo_code || !equipment_instance_id || !title) throw ApiError.validation('工单号、项目、标题必填');
    const instance = get('SELECT id FROM equipment_instances WHERE id = ?', [equipment_instance_id]);
    if (!instance) throw ApiError.notFound('项目不存在');
    if (wo_code && get('SELECT id FROM work_orders WHERE wo_code = ?', [wo_code])) throw ApiError.validation('工单号已存在');
    const startDate = formatDate(planned_start);
    const endDate = formatDate(planned_end);
    if (planned_start && !startDate) throw ApiError.validation('计划开始格式应为 YYYY-MM-DD[ HH:mm[:ss]]');
    if (planned_end && !endDate) throw ApiError.validation('计划结束格式应为 YYYY-MM-DD[ HH:mm[:ss]]');
    if (startDate && endDate && endDate < startDate) throw ApiError.validation('计划结束不能早于计划开始');
    if (priority !== undefined && ![1, 2, 3].includes(Number(priority))) throw ApiError.validation('优先级只能是 1/2/3');
    if (estimated_hours !== undefined && Number(estimated_hours) < 0) throw ApiError.validation('预估工时不能为负');
    const result = run(
      "INSERT INTO work_orders (wo_code, equipment_instance_id, milestone_id, subsystem_id, title, description, workstation_id, estimated_hours, planned_start, planned_end, priority, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')",
      [wo_code, equipment_instance_id, milestone_id || null, subsystem_id || null, title, description || null, workstation_id || null, estimated_hours || null, planned_start || null, planned_end || null, priority || 3],
    );
    woAudit.startInstance(db, { id: Number(result.lastInsertRowid), wo_code, title, status: 'pending' }, req.user && req.user.sub);
    res.json({ id: result.lastInsertRowid });
  }));

  // 4. 操作流水 + 状态事件
  app.post('/api/work_orders/:id/operations', auth.foremanOrWorker, wrap((req, res) => {
    const { operator_id, action, hours_worked, notes } = req.body || {};
    const result = run("INSERT INTO work_order_operations (work_order_id, operator_id, action, hours_worked, notes) VALUES (?, ?, ?, ?, ?)",
      [req.params.id, operator_id || null, action, hours_worked || null, notes || null]);
    const eventMap = { start: 'start', pause: 'pause', complete: 'complete' };
    const event = eventMap[action];
    if (!event) {
      res.json({ id: result.lastInsertRowid });
      return;
    }
    const wo = get("SELECT * FROM work_orders WHERE id = ?", [req.params.id]);
    if (!wo) throw ApiError.notFound('工单不存在');
    try {
      const newStatus = woStateMachine.apply(wo, event, {}, run);
      woAudit.recordTransition(db, wo, event, wo.status, newStatus, (req.user && req.user.sub) || operator_id, notes || null, { operator_id: operator_id || null });
      emit(Events.WORKORDER_STATUS_CHANGED, { wo_id: Number(req.params.id), status: newStatus, operator_id });
    } catch (error) {
      // 当前状态不允许该动作：操作流水已记录，状态不变
      if (error && error.code === 'VALIDATION_ERROR') {
        res.json({ id: result.lastInsertRowid, status_unchanged: true, message: error.message });
        return;
      }
      throw error;
    }
    res.json({ id: result.lastInsertRowid });
  }));

  // 5. 状态流转
  app.post('/api/work_orders/:id/transit', auth.onlyForemanOrAdmin, wrap((req, res) => {
    const { action, comment } = req.body || {};
    const wo = get("SELECT * FROM work_orders WHERE id = ?", [req.params.id]);
    if (!wo) throw ApiError.notFound('工单不存在');
    const event = String(action || '');
    const newStatus = woStateMachine.apply(wo, event, {}, run);
    woAudit.recordTransition(db, wo, event, wo.status, newStatus, req.user && req.user.sub, comment || null);
    emit(Events.WORKORDER_STATUS_CHANGED, { wo_id: Number(req.params.id), status: newStatus, actor_id: req.user && req.user.sub });
    res.json({ work_order: { id: Number(req.params.id), status: newStatus }, timeline: woAudit.getTimeline(db, Number(req.params.id)) });
  }));

  // 6. 流转时间线
  app.get('/api/work_orders/:id/workflow', wrap((req, res) => {
    res.json(woAudit.getTimeline(db, Number(req.params.id)));
  }));

  // 7. 焊接记录
  app.post('/api/work_orders/:id/welds', auth.onlyWelder, wrap((req, res) => {
    const { weld_no, welder_id, material_lot_id, weld_length_mm } = req.body || {};
    if (!weld_no || !welder_id) throw ApiError.validation('焊缝号与焊工必填');
    const result = run("INSERT INTO weld_records (work_order_id, weld_no, welder_id, material_lot_id, weld_length_mm) VALUES (?, ?, ?, ?, ?)",
      [req.params.id, weld_no, welder_id, material_lot_id || null, weld_length_mm || null]);
    res.json({ id: result.lastInsertRowid });
  }));

  // 8. 派工
  app.put('/api/work_orders/:id/dispatch', canDispatch, wrap((req, res) => {
    const { user_id, workstation_id, planned_start, planned_end, notes, force } = req.body || {};
    if (!user_id) throw ApiError.validation('请选择派工人员');
    const wo = get("SELECT * FROM work_orders WHERE id = ?", [req.params.id]);
    if (!wo) throw ApiError.notFound('工单不存在');
    if (wo.status !== 'pending' && wo.status !== 'dispatched') throw ApiError.validation(`工单当前状态为「${wo.status}」，只有待派工/已派工可以重新派工`);

    const user = get(`SELECT id, full_name${hasUserActive ? ', is_active' : ''} FROM users WHERE id = ?`, [user_id]);
    if (!user) throw ApiError.notFound('人员不存在');
    if (hasUserActive && Number(user.is_active) !== 1) throw ApiError.validation('人员已停用，不能派工');
    if (workstation_id) {
      const workstation = get('SELECT id, is_active FROM workstations WHERE id = ?', [workstation_id]);
      if (!workstation) throw ApiError.notFound('工位不存在');
      if (Number(workstation.is_active) !== 1) throw ApiError.validation('工位已停用，不能派工');
    }
    const startDate = formatDate(planned_start);
    const endDate = formatDate(planned_end);
    if (planned_start && !startDate) throw ApiError.validation('计划开始格式应为 YYYY-MM-DD[ HH:mm[:ss]]');
    if (planned_end && !endDate) throw ApiError.validation('计划结束格式应为 YYYY-MM-DD[ HH:mm[:ss]]');
    if (startDate && endDate && endDate < startDate) throw ApiError.validation('计划结束不能早于计划开始');

    // 同一人员已有在执行的其它工单 → 提示重复派工（force 可越过）
    const busy = get(
      "SELECT ra.work_order_id, wo2.wo_code FROM resource_allocations ra LEFT JOIN work_orders wo2 ON wo2.id = ra.work_order_id WHERE ra.user_id = ? AND ra.status = 'active' AND ra.work_order_id IS NOT NULL AND ra.work_order_id <> ? LIMIT 1",
      [user_id, req.params.id],
    );
    if (busy && force !== true) {
      throw ApiError.validation(`该人员已在工单 ${busy.wo_code || busy.work_order_id} 上执行中（如需并行派工请加 force=true）`, { busy_work_order_id: busy.work_order_id });
    }

    // 先过状态机（校验），再在事务里写库，避免"校验失败但计划时间已被改"
    const woUpdated = { ...wo, planned_start: planned_start || wo.planned_start, planned_end: planned_end || wo.planned_end, assigned_to: user_id, workstation_id: workstation_id || wo.workstation_id };
    const nextStatus = woStateMachine.plan(woUpdated, 'dispatch', {}).to;
    const applyDispatch = db.transaction(() => {
      run(
        "UPDATE work_orders SET assigned_to = ?, workstation_id = COALESCE(?, workstation_id), planned_start = COALESCE(?, planned_start), planned_end = COALESCE(?, planned_end), status = 'dispatched', dispatched_at = COALESCE(dispatched_at, datetime('now')), updated_at = datetime('now') WHERE id = ?",
        [user_id, workstation_id || null, planned_start || null, planned_end || null, req.params.id],
      );
      run(
        "INSERT INTO resource_allocations (work_order_id, user_id, workstation_id, equipment_instance_id, assigned_at, status, notes) VALUES (?, ?, ?, ?, datetime('now'), 'active', ?)",
        [req.params.id, user_id, workstation_id || woUpdated.workstation_id || null, wo.equipment_instance_id, notes || null],
      );
    });
    applyDispatch();
    woAudit.recordTransition(db, wo, 'dispatch', wo.status, nextStatus, (req.user && req.user.sub) || user_id, notes || null, { user_id, workstation_id: workstation_id || null });

    const updated = get("SELECT wo.*, ei.instance_code, u.full_name AS assigned_name FROM work_orders wo LEFT JOIN equipment_instances ei ON wo.equipment_instance_id = ei.id LEFT JOIN users u ON u.id = wo.assigned_to WHERE wo.id = ?", [req.params.id]);
    res.json(updated);
  }));

  // 9. 工单改派（只改工位）
  app.put('/api/work_orders/:id/workstation', canDispatch, wrap((req, res) => {
    const { workstation_id } = req.body || {};
    if (workstation_id === undefined || workstation_id === null || workstation_id === '') {
      throw ApiError.validation('workstation_id 必填');
    }
    const wo = get("SELECT * FROM work_orders WHERE id = ?", [req.params.id]);
    if (!wo) throw ApiError.notFound('工单不存在');
    const workstation = get("SELECT id, name, is_active FROM workstations WHERE id = ?", [Number(workstation_id)]);
    if (!workstation) throw ApiError.notFound('工位不存在');
    if (!workstation.is_active) throw ApiError.validation('工位已停用，不能改派');
    if (Number(wo.workstation_id) === Number(workstation.id)) {
      return res.json({ ok: true, changed: 0, workstation_id: workstation.id, workstation_name: workstation.name, message: '工位未变化' });
    }
    run("UPDATE work_orders SET workstation_id = ?, updated_at = datetime('now') WHERE id = ?", [workstation.id, req.params.id]);
    res.json({
      ok: true, changed: 1,
      workstation_id: workstation.id, workstation_name: workstation.name,
      previous_workstation_id: wo.workstation_id,
    });
  }));

  // 10. 取消工单（2026-11-05：stateMachine 有 cancel 事件但没有入口）
  app.post('/api/work_orders/:id/cancel', canDispatch, wrap((req, res) => {
    const wo = get("SELECT * FROM work_orders WHERE id = ?", [req.params.id]);
    if (!wo) throw ApiError.notFound('工单不存在');
    const comment = (req.body && req.body.comment) || null;
    const newStatus = woStateMachine.apply(wo, 'cancel', {}, run);
    woAudit.recordTransition(db, wo, 'cancel', wo.status, newStatus, req.user && req.user.sub, comment);
    emit(Events.WORKORDER_STATUS_CHANGED, { wo_id: Number(req.params.id), status: newStatus, actor_id: req.user && req.user.sub });
    res.json({ work_order: { id: Number(req.params.id), status: newStatus } });
  }));

  // 11. 报工
  app.post('/api/work_orders/:id/report', auth.foremanOrWorker, wrap((req, res) => {
    const { user_id, hours_worked, quantity_completed, defect_quantity, notes } = req.body || {};
    if (!user_id) throw ApiError.validation('报工人员必填');
    const hours = Number(hours_worked || 0);
    const quantity = Number(quantity_completed || 0);
    const defect = Number(defect_quantity || 0);
    if (hours < 0) throw ApiError.validation('工时不能为负');
    if (quantity < 0) throw ApiError.validation('完成数量不能为负');
    if (defect < 0) throw ApiError.validation('缺陷数量不能为负');

    const wo = get("SELECT * FROM work_orders WHERE id = ?", [req.params.id]);
    if (!wo) throw ApiError.notFound('工单不存在');

    let newStatus;
    try {
      newStatus = woStateMachine.apply(wo, 'report', { quantity_completed: quantity, hours_worked: hours }, run);
    } catch (error) {
      if (error && error.code === 'VALIDATION_ERROR') {
        throw ApiError.validation(`工单当前状态为「${wo.status}」，只有已派工/进行中可以报工`);
      }
      throw error;
    }
    woAudit.recordTransition(db, wo, 'report', wo.status, newStatus, (req.user && req.user.sub) || user_id, notes || null,
      { quantity_completed: quantity, hours_worked: hours, defect_quantity: defect });

    const result = run(
      "INSERT INTO work_order_operations (work_order_id, operator_id, action, hours_worked, quantity_completed, defect_quantity, notes) VALUES (?, ?, 'report', ?, ?, ?, ?)",
      [req.params.id, user_id, hours || null, quantity, defect, notes || null],
    );

    const fresh = get('SELECT quantity_completed, quantity_planned FROM work_orders WHERE id = ?', [req.params.id]);
    const planned = Number(fresh.quantity_planned || 1);
    res.json({
      id: result.lastInsertRowid,
      quantity_completed: Number(fresh.quantity_completed || 0),
      over_reported: Number(fresh.quantity_completed || 0) > planned,
      message: newStatus === 'completed' ? '已报工，累计数量达到计划，工单自动完成' : '报工成功',
    });
  }));

  // 12. 计划日期补齐（2026-11-05 数据治理：生产 4 张工单 planned_start 全空、2 张只有 planned_end）
  app.post('/api/work_orders/backfill-dates', canDispatch, wrap((req, res) => {
    const dryRun = req.query.dryRun === '1' || req.body?.dry_run === true;
    const rows = all("SELECT id, wo_code, status, planned_start, planned_end, estimated_hours FROM work_orders WHERE planned_start IS NULL OR planned_end IS NULL");
    const changes = [];
    for (const row of rows) {
      const hours = Number(row.estimated_hours || 0) || HOURS_PER_DAY;
      let nextStart = row.planned_start;
      let nextEnd = row.planned_end;
      if (!nextStart && nextEnd) nextStart = addHoursToText(nextEnd, -hours);
      if (nextStart && !nextEnd) nextEnd = addHoursToText(nextStart, hours);
      if (!nextStart && !nextEnd) continue; // 完全没计划的留给计划员手工排
      if (nextStart === row.planned_start && nextEnd === row.planned_end) continue;
      changes.push({ id: row.id, wo_code: row.wo_code, old_planned_start: row.planned_start, old_planned_end: row.planned_end, new_planned_start: nextStart, new_planned_end: nextEnd, hours });
    }
    let updated = 0;
    if (!dryRun && changes.length) {
      const tx = db.transaction(() => {
        for (const change of changes) {
          run("UPDATE work_orders SET planned_start = ?, planned_end = ?, updated_at = datetime('now') WHERE id = ?", [change.new_planned_start, change.new_planned_end, change.id]);
          updated += 1;
        }
      });
      tx();
    }
    res.json({ dry_run: dryRun, total: rows.length, changed_count: changes.length, updated, changes });
  }));
}

module.exports = { register };
