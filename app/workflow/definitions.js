"use strict";
// app/workflow/definitions.js
// P0-5 三套工作流定义: BOM 审批 / ECO 变更 / 工单流转
// Author: 三狗子 | Date: 2026-06-25
//
// ⚠️  @deprecated 2026-07-11 (brooks-audit R4 决策 ADR-003)
//   仅 tests/workflow.test.js 引用, 实际运行链不引
//   实际工作流业务跑在 services/workflowService.js
//   保留: 历史快照 + 测试 fixture
//   未来: Phase 2 cleanup 时评估删除

/**
 * 状态定义: { id, label, is_terminal?, is_initial? }
 * 迁移定义: { from, to, action, label?, guard? }
 * guard(instance, actorId, extraData) => boolean
 *   - instance: workflow_instances 行 (含 data)
 *   - extraData: transit 传入的额外数据
 */

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

  // ===================== 工单流转 =====================
  "work_order": {
    display_name: "工单流转",
    entity_type: "work_order",
    description: "工单从创建到完工的标准流程",
    states: [
      { id: "created",       label: "新建" },
      { id: "released",      label: "已下达" },
      { id: "in_progress",   label: "进行中" },
      { id: "paused",        label: "暂停" },
      { id: "completed",     label: "已完工" },
      { id: "closed",        label: "已关闭", is_terminal: true },
      { id: "cancelled",     label: "已取消", is_terminal: true },
    ],
    transitions: [
      { from: "created",     to: "released",    action: "release",    label: "下达" },
      { from: "released",    to: "in_progress", action: "start",      label: "开工" },
      { from: "in_progress", to: "paused",      action: "pause",      label: "暂停" },
      { from: "paused",      to: "in_progress", action: "resume",     label: "恢复" },
      { from: "in_progress", to: "completed",   action: "complete",   label: "完工" },
      { from: "completed",   to: "closed",      action: "close",      label: "关闭" },
      { from: "created",     to: "cancelled",   action: "cancel",     label: "取消" },
      { from: "released",    to: "cancelled",   action: "cancel",     label: "取消" },
      { from: "paused",      to: "cancelled",   action: "cancel",     label: "取消" },
    ],
  },
};

module.exports = { definitions };
