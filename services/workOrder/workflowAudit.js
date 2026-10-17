"use strict";
// services/workOrder/workflowAudit.js
// 工单流转 → 工作流审计流水（2026-10-13 决策② 选项 ii 的后半段）
//
// 分工（避免双写）：
//   - 业务状态：work_orders.status 仍由 services/workOrder/stateMachine.js 写（唯一写路径）
//   - 审计流水：本模块只写 workflow_instances / workflow_history
// 定义来源：app/workflow/workOrderDefinition.js（与 stateMachine 同源，防漂移由 P5-5b 守）
//
// 设计要点：
//   - 懒创建实例：工单第一次流转时才建实例，并把 current_state 对齐到工单当时的状态
//     （历史数据没有实例，不能假设从 pending 开始）
//   - report 是"动态目标状态"，引擎的 transit 无法表达，这里直接写 history（to 用真实新状态）
//   - 审计是次要路径：任何异常只记日志、不抛出，绝不阻断业务写入

const { createLogger } = require('../../app/logger');
const logger = createLogger('workOrderAudit');

const DEFINITION = 'work_order';
const ENTITY_TYPE = 'work_order';

function get(db, sql, params = []) { return db.prepare(sql).get(params); }
function run(db, sql, params = []) { return db.prepare(sql).run(params); }

function findInstance(db, woId) {
  return get(
    db,
    'SELECT * FROM workflow_instances WHERE definition_name = ? AND entity_type = ? AND entity_id = ? ORDER BY id DESC LIMIT 1',
    [DEFINITION, ENTITY_TYPE, woId]
  );
}

/**
 * 创建工单时启动审计实例（状态 = pending）
 * @returns {number|null} instance id
 */
function startInstance(db, wo, actorId) {
  try {
    const existing = findInstance(db, wo.id);
    if (existing) return existing.id;
    const r = run(
      db,
      'INSERT INTO workflow_instances (definition_name, entity_type, entity_id, current_state, priority, data, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [DEFINITION, ENTITY_TYPE, wo.id, wo.status || 'pending', 0,
       JSON.stringify({ wo_code: wo.wo_code || null, title: wo.title || null }), actorId || null]
    );
    run(
      db,
      "INSERT INTO workflow_history (instance_id, from_state, to_state, action, actor_id, comment) VALUES (?, NULL, ?, 'start', ?, ?)",
      [r.lastInsertRowid, wo.status || 'pending', actorId || null, '工单创建']
    );
    return Number(r.lastInsertRowid);
  } catch (error) {
    logger.warn('startInstance failed wo=' + wo.id + ': ' + error.message);
    return null;
  }
}

/**
 * 记录一次流转（fromStatus 是流转前的 work_orders.status，toStatus 是流转后的）
 */
function recordTransition(db, wo, event, fromStatus, toStatus, actorId, comment, payload) {
  try {
    let inst = findInstance(db, wo.id);
    if (!inst) {
      const id = startInstance(db, { ...wo, status: fromStatus }, actorId);
      if (!id) return null;
      inst = findInstance(db, wo.id);
    }
    // 历史数据/并发场景下实例状态可能与工单不一致，先对齐再追加（保证流水连贯）
    if (inst.current_state !== fromStatus) {
      run(db, "UPDATE workflow_instances SET current_state = ?, updated_at = datetime('now') WHERE id = ?", [fromStatus, inst.id]);
    }
    const terminal = toStatus === 'completed' || toStatus === 'cancelled';
    run(
      db,
      'INSERT INTO workflow_history (instance_id, from_state, to_state, action, actor_id, comment, data) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [inst.id, fromStatus, toStatus, event, actorId || null, comment || null, payload ? JSON.stringify(payload) : null]
    );
    run(
      db,
      "UPDATE workflow_instances SET current_state = ?, completed_at = CASE WHEN ? THEN COALESCE(completed_at, datetime('now')) ELSE completed_at END, updated_at = datetime('now') WHERE id = ?",
      [toStatus, terminal ? 1 : 0, inst.id]
    );
    return Number(inst.id);
  } catch (error) {
    logger.warn('recordTransition failed wo=' + wo.id + ' event=' + event + ': ' + error.message);
    return null;
  }
}

/** 某状态下的可用动作（来自同源定义，供前端"可用动作"按钮） */
function availableActions(state) {
  try {
    const { WORK_ORDER_ENGINE_TRANSITIONS } = require('../../app/workflow/workOrderDefinition');
    return WORK_ORDER_ENGINE_TRANSITIONS
      .filter((t) => t.from === state)
      .map((t) => ({ action: t.action, label: t.label, to: t.to || '(按报工量自动判定)' }));
  } catch (error) {
    logger.warn('availableActions failed: ' + error.message);
    return [];
  }
}

/** 工单流转时间线：委托给统一读取口径（services/workflow/timeline.js） */
function getTimeline(db, woId) {
  const { getTimeline: unified } = require("../workflow/timeline");
  const t = unified(db, ENTITY_TYPE, woId);
  return { ...t, work_order: t.entity };
}

module.exports = { startInstance, recordTransition, getTimeline, availableActions, DEFINITION, ENTITY_TYPE };
