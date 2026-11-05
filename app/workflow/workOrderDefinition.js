"use strict";
// app/workflow/workOrderDefinition.js
// 工单生命周期的**唯一来源**（2026-10-13 决策② 选选项 ii：以工作流定义为准）。
//
// 本文件的 STATES / TRANSITIONS 是从 services/workOrder/stateMachine.js 平移到
// app/workflow/ 的（逐字保留，含 report 的动态目标状态与 SQL setters），
// stateMachine.js 现在只是本文件的适配器 —— 公开 API（WO_STATUS/ALL_STATUSES/
// TRANSITIONS/plan/apply）保持不变，行为不变。
//
// 与引擎的关系：engine.transit() 用 (from, action) 精确匹配且 from 是字符串，
// 所以这里额外导出 WORK_ORDER_ENGINE_TRANSITIONS（把 from 数组展开成多条），
// 供 app/workflow/definitions.js 注册到引擎；PLAN 逻辑仍走 plan()。

const { ApiError } = require('../errors');

const WO_STATUS = Object.freeze({
  PENDING: 'pending',
  DISPATCHED: 'dispatched',
  IN_PROGRESS: 'in_progress',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
});

const ALL_STATUSES = Object.freeze(Object.values(WO_STATUS));

const LABELS = Object.freeze({
  dispatch: '派工',
  start: '开工',
  pause: '暂停',
  complete: '完工',
  report: '报工',
  cancel: '取消',
});

// 事件 -> { from[], to|null, setters[], compute? }
const TRANSITIONS = {
  dispatch: {
    from: [WO_STATUS.PENDING],
    to: WO_STATUS.DISPATCHED,
    setters: ["dispatched_at = COALESCE(dispatched_at, datetime('now'))", "updated_at = datetime('now')"],
  },
  start: {
    from: [WO_STATUS.PENDING, WO_STATUS.DISPATCHED],
    to: WO_STATUS.IN_PROGRESS,
    setters: ["actual_start = COALESCE(actual_start, datetime('now'))", "updated_at = datetime('now')"],
  },
  pause: {
    from: [WO_STATUS.IN_PROGRESS],
    to: WO_STATUS.PAUSED,
    setters: ["updated_at = datetime('now')"],
  },
  complete: {
    from: [WO_STATUS.DISPATCHED, WO_STATUS.IN_PROGRESS, WO_STATUS.PAUSED],
    to: WO_STATUS.COMPLETED,
    setters: ["actual_end = COALESCE(actual_end, datetime('now'))", "updated_at = datetime('now')"],
  },
  report: {
    from: [WO_STATUS.DISPATCHED, WO_STATUS.IN_PROGRESS],
    to: null, // computed：取决于累计数量的
    compute(payload, wo) {
      const qtyDone = (wo.quantity_completed || 0) + (payload.quantity_completed || 0);
      const hrsDone = (wo.actual_hours || 0) + (payload.hours_worked || 0);
      const reached = qtyDone >= (wo.quantity_planned || 1);
      return {
        to: reached ? WO_STATUS.COMPLETED : wo.status,
        setters: [
          `actual_hours = ${hrsDone}`,
          `quantity_completed = ${qtyDone}`,
          ...(reached ? ["actual_end = COALESCE(actual_end, datetime('now'))"] : []),
          "updated_at = datetime('now')",
        ],
      };
    },
  },
  cancel: {
    from: [WO_STATUS.PENDING, WO_STATUS.DISPATCHED, WO_STATUS.IN_PROGRESS, WO_STATUS.PAUSED],
    to: WO_STATUS.CANCELLED,
    setters: ["updated_at = datetime('now')"],
  },
};

/** 计划一次工单流转；不合法时抛 VALIDATION_ERROR（与旧实现逐字一致） */
function plan(wo, event, payload = {}) {
  const t = TRANSITIONS[event];
  if (!t) throw ApiError.validation(`未知的工单动作：${event}`);
  if (!t.from.includes(wo.status)) throw ApiError.validation(`工单当前状态为「${wo.status}」，不能执行「${LABELS[event] || event}」`);
  if (typeof t.compute === 'function') {
    const computed = t.compute(payload, wo);
    return { to: computed.to, setters: computed.setters };
  }
  return { to: t.to, setters: t.setters };
}

/** 引擎用：把 from 数组展开成 (from, action) 的逐条定义 */
const WORK_ORDER_ENGINE_STATES = ALL_STATUSES.map((s) => ({ id: s, label: s,
  is_initial: s === WO_STATUS.PENDING, is_terminal: s === WO_STATUS.COMPLETED || s === WO_STATUS.CANCELLED }));

const WORK_ORDER_ENGINE_TRANSITIONS = Object.entries(TRANSITIONS).flatMap(([action, t]) =>
  (t.from || []).map((from) => ({
    from, to: t.to || null, action, label: LABELS[action],
    compute: t.compute, effects: t.setters,
  })));

module.exports = {
  WO_STATUS, ALL_STATUSES, TRANSITIONS, LABELS, plan,
  WORK_ORDER_ENGINE_STATES, WORK_ORDER_ENGINE_TRANSITIONS,
};
