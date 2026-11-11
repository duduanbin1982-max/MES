"use strict";
// services/scanner.js
// 扫码报工：/api/scan/lookup + /api/scan/execute
//
// 2026-11-06 车间工作台审计整改：
//   SH-1 操作人必须来自登录用户（原实现直接信任 body.operator_id，可冒充他人）
//   SH-2 动作白名单 + 状态机校验（禁止对已完成工单重新 start/complete）
//   SH-3 工时/数量校验（负工时、负数数量、超计划完成）
//   SH-4 QC 结果校验（pass/fail），失败不置完成
const { ApiError } = require('../app/errors');
require('../middleware/asyncHandler');
const { feishuNotify } = require('./feishuNotify');
const { autoUnlockSuccessors } = require('./process/node/_helpers');
const { recalcWorkOrderTimer, ensureTimerColumns } = require('./workOrderTimer');

const get = (db, sql, params) => db.prepare(sql).get(params);
const run = (db, sql, params) => db.prepare(sql).run(params);

const TARGET_ACTIONS = {
  work_order: ["start", "pause", "complete", "block"],
  process_node: ["start", "pause", "complete", "qc", "block"],
};
const WO_TRANSITIONS = {
  start: ["pending", "dispatched", "paused", "blocked"],
  pause: ["in_progress"],
  complete: ["in_progress"],
  block: ["in_progress", "paused"],
};
const NODE_TRANSITIONS = {
  start: ["ready", "pending", "paused", "blocked"],
  pause: ["in_progress"],
  complete: ["in_progress"],
  qc: ["in_progress"],
  block: ["in_progress", "ready"],
};
const TERMINAL_WO = ["completed", "closed", "cancelled"];
const TERMINAL_NODE = ["completed", "cancelled"];

// Part B: add quantity columns to process_executions (idempotent)
function ensureQuantityColumns(db) {
  const addCol = (table, colDef) => {
    try { db.prepare("ALTER TABLE " + table + " ADD COLUMN " + colDef).run(); }
    catch (e) { /* already exists */ }
  };
  addCol("process_executions", "quantity_completed INTEGER DEFAULT 0");
  addCol("process_executions", "defect_quantity INTEGER DEFAULT 0");
}

function register(_app, db) {
  ensureQuantityColumns(db);
  ensureTimerColumns(db);
}

function scanLookup(req, res, db) {
  const { code } = req.query;
  if (!code) throw ApiError.validation('code 必填');

  const wo = db.prepare("SELECT wo.*, ei.instance_code, es.name_zh as subsystem_name FROM work_orders wo LEFT JOIN equipment_instances ei ON wo.equipment_instance_id = ei.id LEFT JOIN equipment_subsystems es ON wo.subsystem_id = es.id WHERE wo.wo_code = ?").get(code);
  if (wo) {
    try { Object.assign(wo, recalcWorkOrderTimer(db, wo.id)); } catch (_error) { /* 老库无计时列 */ }
    return res.json({ type: 'work_order', data: wo });
  }

  let pnId = null;
  if (/^PN-?(\d+)/i.test(code)) pnId = parseInt(code.replace(/^PN-?/i, ''), 10);
  else if (/^\d+$/.test(code)) pnId = parseInt(code, 10);
  if (pnId) {
    const pn = db.prepare("SELECT pn.*, ei.instance_code, m.material_name FROM process_nodes pn JOIN equipment_instances ei ON pn.equipment_instance_id = ei.id LEFT JOIN instance_bom ib ON pn.bom_node_id = ib.id LEFT JOIN materials m ON ib.material_id = m.id WHERE pn.id = ?").get(pnId);
    if (pn) return res.json({ type: 'process_node', data: pn });
  }
  throw ApiError.notFound('未找到该码: ' + code);
}

function validateScanAction(targetType, action) {
  const allowed = TARGET_ACTIONS[targetType] || [];
  if (!allowed.includes(action)) {
    throw ApiError.validation(`不支持的动作「${action}」；${targetType === 'work_order' ? '工单' : '工序'}允许: ${allowed.join("/")}`);
  }
  return true;
}

function assertStatusTransition(targetType, currentStatus, action) {
  const status = String(currentStatus || "pending");
  const map = targetType === 'work_order' ? WO_TRANSITIONS : NODE_TRANSITIONS;
  const terminal = targetType === 'work_order' ? TERMINAL_WO : TERMINAL_NODE;
  if (terminal.includes(status)) throw ApiError.validation(`当前状态「${status}」为终态，不能执行「${action}」`);
  const allowed = map[action] || [];
  if (!allowed.includes(status)) {
    throw ApiError.validation(`当前状态「${status}」不能执行「${action}」（允许: ${allowed.join("/") || "无"}）`);
  }
  return true;
}

function resolveScanOperator(req, body) {
  const user = (req && req.user) || {};
  const uid = user.uid || user.sub || user.id || null;
  const requested = body.operator_id == null || body.operator_id === "" ? null : Number(body.operator_id);
  if (requested !== null) {
    if (!Number.isInteger(requested) || requested <= 0) throw ApiError.validation("operator_id 必须是正整数");
    if (uid && requested !== Number(uid)) {
      const permissions = Array.isArray(user.permissions) ? user.permissions : [];
      const canOverride = permissions.includes("*") || permissions.includes("work_order:write") || permissions.includes("equipment:write");
      if (!canOverride) throw ApiError.forbidden("不能代替他人扫码操作");
    }
    return requested;
  }
  return uid;
}

function validateScanQuantities(body) {
  const rawHours = body.hours_worked;
  const hours = rawHours == null || rawHours === "" || Number(rawHours) === 0 ? null : Number(rawHours);
  if (hours !== null && (!Number.isFinite(hours) || hours < 0 || hours > 24)) throw ApiError.validation("hours_worked 必须 >= 0 且 <= 24");
  for (const field of ["quantity_completed", "defect_quantity"]) {
    const raw = body[field];
    if (raw == null || raw === "") continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) throw ApiError.validation(field + " 必须 >= 0");
    if (!Number.isInteger(value)) throw ApiError.validation(field + " 必须是整数");
  }
  if (body.action === "qc" && body.result != null && !["pass", "fail"].includes(String(body.result))) {
    throw ApiError.validation("质检结果 result 必须是 pass/fail");
  }
  return {
    hours: hours,
    quantityCompleted: Number(body.quantity_completed || 0),
    defectQuantity: Number(body.defect_quantity || 0),
  };
}

function scanExecute(req, res, db) {
  const body = req.body || {};
  const { code, action, notes } = body;
  if (!code || !action) throw ApiError.validation('code/action 必填');

  let target = null;
  let targetType = null;
  const wo = get(db, "SELECT * FROM work_orders WHERE wo_code = ?", code);
  if (wo) { target = wo; targetType = 'work_order'; }
  else {
    let pnId = null;
    if (/^PN-?(\d+)/i.test(code)) pnId = parseInt(code.replace(/^PN-?/i, ''), 10);
    else if (/^\d+$/.test(code)) pnId = parseInt(code, 10);
    if (pnId) {
      const pn = get(db, 'SELECT * FROM process_nodes WHERE id = ?', pnId);
      if (pn) { target = pn; targetType = 'process_node'; }
    }
  }
  if (!target) throw ApiError.notFound('未找到该码: ' + code);

  validateScanAction(targetType, action);
  const operatorId = resolveScanOperator(req, body);
  const quantities = validateScanQuantities(body);

  // 状态机在事务内用最新数据校验，避免并发/脏读
  const t = db.transaction(() => {
    if (targetType === 'work_order') {
      const current = get(db, 'SELECT * FROM work_orders WHERE id = ?', target.id);
      assertStatusTransition('work_order', current.status, action);
      if (action === 'complete' && Number(current.quantity_planned) > 0) {
        if (quantities.quantityCompleted <= 0) throw ApiError.validation("完成工单必须填写 quantity_completed");
        const qtyDone = (current.quantity_completed || 0) + quantities.quantityCompleted;
        if (qtyDone > Number(current.quantity_planned)) {
          throw ApiError.validation(`完成数量超过计划: 计划 ${current.quantity_planned}, 累计 ${qtyDone}`);
        }
      }
      const r = run(db,
        "INSERT INTO work_order_operations (work_order_id, operator_id, action, hours_worked, quantity_completed, defect_quantity, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [current.id, operatorId, action, quantities.hours, quantities.quantityCompleted, quantities.defectQuantity, notes || null]
      );
      let statusAfter = current.status;
      if (action === 'start') {
        run(db, "UPDATE work_orders SET status = 'in_progress', actual_start = COALESCE(actual_start, datetime('now')) WHERE id = ?", [current.id]);
        statusAfter = 'in_progress';
      } else if (action === 'complete') {
        const qtyDone = (current.quantity_completed || 0) + quantities.quantityCompleted;
        if (qtyDone >= (current.quantity_planned || 1)) {
          run(db, "UPDATE work_orders SET status = 'completed', actual_end = datetime('now'), quantity_completed = ? WHERE id = ?", [qtyDone, current.id]);
          statusAfter = 'completed';
        } else {
          run(db, "UPDATE work_orders SET quantity_completed = ? WHERE id = ?", [qtyDone, current.id]);
          statusAfter = 'in_progress';
        }
      } else if (action === 'pause') {
        run(db, "UPDATE work_orders SET status = 'paused' WHERE id = ?", [current.id]);
        statusAfter = 'paused';
      } else if (action === 'block') {
        run(db, "UPDATE work_orders SET status = 'blocked' WHERE id = ?", [current.id]);
        statusAfter = 'blocked';
      }
      return { id: r.lastInsertRowid, statusAfter };
    }

    const current = get(db, 'SELECT * FROM process_nodes WHERE id = ?', target.id);
    assertStatusTransition('process_node', current.status, action);
    const qcResult = action === 'qc' ? String(body.result || '') : null;
    if (action === 'qc' && !["pass", "fail"].includes(qcResult)) throw ApiError.validation("质检动作必须提供 result=pass/fail");
    const r = run(db,
      "INSERT INTO process_executions (process_node_id, operator_id, action, hours_worked, quantity_completed, defect_quantity, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [current.id, operatorId, action, quantities.hours, quantities.quantityCompleted, quantities.defectQuantity, notes || null]
    );
    const inst = get(db, 'SELECT equipment_instance_id FROM process_nodes WHERE id = ?', current.id);
    let statusAfter = current.status;
    if (action === 'start') {
      run(db, "UPDATE process_nodes SET status = 'in_progress', actual_start = COALESCE(actual_start, datetime('now')), updated_at = datetime('now') WHERE id = ?", [current.id]);
      statusAfter = 'in_progress';
    } else if (action === 'complete' || (action === 'qc' && qcResult === 'pass')) {
      run(db, "UPDATE process_nodes SET status = 'completed', actual_end = COALESCE(actual_end, datetime('now')), updated_at = datetime('now') WHERE id = ?", [current.id]);
      statusAfter = 'completed';
      if (inst) autoUnlockSuccessors(db, current.id, inst.equipment_instance_id);
      if (current.work_order_id && quantities.quantityCompleted) {
        const workOrder = get(db, 'SELECT quantity_completed, quantity_planned FROM work_orders WHERE id = ?', [current.work_order_id]);
        if (workOrder) {
          const qtyDone = (workOrder.quantity_completed || 0) + quantities.quantityCompleted;
          if (!(Number(workOrder.quantity_planned) > 0) || qtyDone <= Number(workOrder.quantity_planned)) {
            run(db, 'UPDATE work_orders SET quantity_completed = ? WHERE id = ?', [qtyDone, current.work_order_id]);
          }
        }
      }
      if (inst) {
        const equipment = get(db, 'SELECT instance_code, customer_name FROM equipment_instances WHERE id = ?', [inst.equipment_instance_id]);
        if (equipment) feishuNotify('工序完成', equipment.instance_code + ' · ' + current.operation_name + ' (PDA扫码完成)', 'foreman');
      }
    } else if (action === 'qc' && qcResult === 'fail') {
      statusAfter = String(current.status); // 质检不合格：保持 in_progress，等待返工
    } else if (action === 'block') {
      run(db, "UPDATE process_nodes SET status = 'blocked', updated_at = datetime('now') WHERE id = ?", [current.id]);
      statusAfter = 'blocked';
      if (inst) {
        const equipment = get(db, 'SELECT instance_code FROM equipment_instances WHERE id = ?', [inst.equipment_instance_id]);
        if (equipment) feishuNotify('工艺节点卡住', equipment.instance_code + ' · ' + current.operation_name + ' 已标记 blocked', 'foreman');
      }
    } else if (action === 'pause') {
      run(db, "UPDATE process_nodes SET status = 'paused', updated_at = datetime('now') WHERE id = ?", [current.id]);
      statusAfter = 'paused';
    }
    return { id: r.lastInsertRowid, statusAfter };
  });

  const result = t();
  let timer = null;
  if (targetType === 'work_order') {
    try { timer = recalcWorkOrderTimer(db, target.id, { discardStaleOpen: ['pause', 'block', 'complete'].includes(action) }); } catch (_error) { timer = null; }
  }
  res.json({
    id: result.id,
    target_type: targetType,
    target_id: target.id,
    action,
    operator_id: operatorId,
    status_after: result.statusAfter,
    actual_duration_seconds: timer?.actual_duration_seconds,
    actual_duration_hours: timer?.actual_duration_hours,
    timer_status: timer?.timer_status,
    timer_started_at: timer?.timer_started_at,
    message: '执行已记录',
  });
}

module.exports = {
  register,
  ensureQuantityColumns,
  scanLookup,
  scanExecute,
  validateScanAction,
  assertStatusTransition,
  resolveScanOperator,
  validateScanQuantities,
  TARGET_ACTIONS,
  WO_TRANSITIONS,
  NODE_TRANSITIONS,
};
