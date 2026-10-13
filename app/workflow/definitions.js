"use strict";
// app/workflow/definitions.js
// P0-5 三套工作流定义: BOM 审批 / ECO 变更 / 工单流转
// Author: 三狗子 | Date: 2026-06-25
//
// 2026-10-13 决策②（选项 ii）：本文件为**正式启用**的工作流定义来源，
//   工单流转定义已改为引用 ./workOrderDefinition（与 stateMachine 同源）。
//   历史：2026-07-11 曾被标为 deprecated（brooks-audit ADR-003），现予解除。
//   现状：services/workflowService.js 通过 require('./definitions') 读本文件，
//         engine.js 用它做 (from, action) 匹配；bom_approval / eco_change 保持不变。

/**
 * 状态定义: { id, label, is_terminal?, is_initial? }
 * 迁移定义: { from, to, action, label?, guard? }
 * guard(instance, actorId, extraData) => boolean
 *   - instance: workflow_instances 行 (含 data)
 *   - extraData: transit 传入的额外数据
 */

const { WORK_ORDER_ENGINE_STATES, WORK_ORDER_ENGINE_TRANSITIONS } = require("./workOrderDefinition");

const definitions = {

  // ===================== BOM 审批流程 =====================
  "bom_approval": {
    display_name: "BOM 审批",
    entity_type: "bom_node",
    description: "BOM 节点从草稿到发布需经审批",
    states: [
      { id: "draft",     label: "草稿" },
      { id: "review",    label: "审核中" },
      { id: "approved",  label: "已批准" },
      { id: "released",  label: "已发布" },
      { id: "rejected",  label: "已驳回" },
      { id: "obsoleted", label: "已废弃", is_terminal: true },
    ],
    transitions: [
      { from: "draft",    to: "review",   action: "submit",  label: "提交审核" },
      { from: "review",   to: "approved", action: "approve", label: "批准" },
      { from: "review",   to: "rejected", action: "reject",  label: "驳回" },
      { from: "rejected", to: "draft",    action: "revise",  label: "修改重提" },
      { from: "approved", to: "released", action: "release", label: "发布" },
      { from: "approved", to: "draft",    action: "recall",  label: "撤回" },
      { from: "released", to: "obsoleted", action: "obsolesce", label: "作废" },
      { from: "draft",    to: "obsoleted", action: "cancel", label: "取消" },
    ],
  },

  // ===================== ECO 变更流程 =====================
  "eco_change": {
    display_name: "设计变更 (ECO)",
    entity_type: "eco",
    description: "工程变更从提出到实施关闭的完整流程",
    states: [
      { id: "open",       label: "待审批" },
      { id: "review",     label: "评审中" },
      { id: "approved",   label: "已批准" },
      { id: "implemented",label: "已实施" },
      { id: "closed",     label: "已关闭", is_terminal: true },
      { id: "rejected",   label: "已驳回", is_terminal: true },
    ],
    transitions: [
      { from: "open",       to: "review",      action: "submit",   label: "提交评审" },
      { from: "review",     to: "approved",    action: "approve",  label: "批准",
        guard: (inst, actorId, extra) => !!extra.effective_date },
      { from: "review",     to: "rejected",    action: "reject",   label: "驳回" },
      { from: "approved",   to: "implemented", action: "implement",label: "实施完成" },
      { from: "implemented",to: "closed",      action: "close",    label: "关闭",
        guard: (inst, actorId, extra) => !!extra.closed_date },
      { from: "open",       to: "rejected",    action: "reject",   label: "直接驳回" },
      { from: "approved",   to: "rejected",    action: "reject",   label: "驳回" },
    ],
  },

  // ===================== 工单流转（2026-10-13 决策②：以工作流定义为准） =====================
  // 状态与转换的唯一来源是 app/workflow/workOrderDefinition.js（由 stateMachine 平移而来），
  // 这里只做注册：states 供前端下拉/查询，transitions 供 engine.transit() 精确匹配 (from, action)。
  "work_order": {
    display_name: "工单流转",
    entity_type: "work_order",
    description: "工单从待派工到完工/取消的标准流转（与 services/workOrder/stateMachine.js 同源）",
    states: WORK_ORDER_ENGINE_STATES,
    transitions: WORK_ORDER_ENGINE_TRANSITIONS,
  },
};

module.exports = { definitions };
