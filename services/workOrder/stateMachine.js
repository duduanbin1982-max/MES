"use strict";
// services/workOrder/stateMachine.js
// 工单状态机的**适配器**。2026-10-13 决策②（选项 ii：以工作流定义为准）之后，
// 状态与转换表的唯一来源是 app/workflow/workOrderDefinition.js；
// 本文件只保留既有公开 API（WO_STATUS / ALL_STATUSES / TRANSITIONS / plan / apply），
// 调用方与测试零改动。
//
// 历史：F4 (brooks-audit) 曾把内联 4 份的状态逻辑收敛到本文件；
// 现在再收敛到 app/workflow/，使"工作流引擎 + 工单状态机"共用同一份定义。

const woDef = require('../../app/workflow/workOrderDefinition');

const WO_STATUS = woDef.WO_STATUS;
const ALL_STATUSES = woDef.ALL_STATUSES;
const TRANSITIONS = woDef.TRANSITIONS;

/** 计划一次流转（实现在 app/workflow/workOrderDefinition.js） */
const plan = woDef.plan;

/**
 * 执行一次流转：把 plan 的结果写回 work_orders。
 * @returns {string} 新状态
 */
function apply(wo, event, payload, run) {
  const { to, setters } = plan(wo, event, payload);
  const sql = `UPDATE work_orders SET status = '${to}', ${setters.join(', ')} WHERE id = ?`;
  run(sql, wo.id);
  return to;
}

module.exports = { WO_STATUS, ALL_STATUSES, TRANSITIONS, plan, apply };
