// frontend/tests/domain/scheduleBoard.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildEquipmentBoard,
  filterNodes,
  formatBatchScope,
  formatPlanRange,
  formatWeekLabel,
  overlapsWeek,
  isAbnormal,
  isOverdue,
  isUnscheduled,
  nodePhase,
  nodeStatusLabel,
  nodeStatusTone,
  overdueDays,
  primaryAction,
  summarizeNodes,
} from '../../src/domain/scheduleBoard.ts'

const NOW = new Date('2026-11-04T10:00:00')

function node(overrides: Record<string, any> = {}) {
  return { id: 1, operation_name: '焊接', status: 'pending', planned_start: '2026-11-10', planned_end: '2026-11-10 08:00:00', ...overrides }
}

test('SB.1 状态文案与色调（含 ready/paused 兜底）', () => {
  assert.equal(nodeStatusLabel('in_progress'), '进行中')
  assert.equal(nodeStatusLabel('ready'), '已就绪')
  assert.equal(nodeStatusLabel('paused'), '已暂停')
  assert.equal(nodeStatusLabel('unknown_status'), 'unknown_status')
  assert.equal(nodeStatusLabel(null), '未开始')
  assert.equal(nodeStatusTone('completed'), 'success')
  assert.equal(nodeStatusTone('blocked'), 'danger')
  assert.equal(nodeStatusTone(undefined), 'info')
})

test('SB.2 超期判定：只看未完成节点，边界按时间比较', () => {
  assert.equal(isOverdue(node({ planned_end: '2026-11-03 08:00:00' }), NOW), true)
  assert.equal(isOverdue(node({ planned_end: '2026-11-05 08:00:00' }), NOW), false)
  assert.equal(isOverdue(node({ planned_end: '2026-11-03 08:00:00', status: 'completed' }), NOW), false)
  assert.equal(isOverdue(node({ planned_end: '2026-11-03 08:00:00', status: 'cancelled' }), NOW), false)
  assert.equal(isOverdue(node({ planned_end: null }), NOW), false)
  assert.equal(overdueDays(node({ planned_end: '2026-11-01 08:00:00' }), NOW), 3)
  assert.equal(overdueDays(node({ planned_end: '2026-11-05 08:00:00' }), NOW), 0)
})

test('SB.3 未排程判定与计划时间展示', () => {
  assert.equal(isUnscheduled(node({ planned_start: null, planned_end: null })), true)
  assert.equal(isUnscheduled(node({ planned_start: '2026-11-10', planned_end: null })), false, '只要有一个时间就不算未排程')
  assert.equal(formatPlanRange(node({ planned_start: null, planned_end: null })), '未排程')
  assert.equal(formatPlanRange(node({ planned_start: '2026-11-10', planned_end: '2026-11-11 08:00:00' })), '11-10 ~ 11-11 08:00')
})

test('SB.4 阶段：完成/受阻/超期/执行中/未排程/待开始', () => {
  assert.equal(nodePhase(node({ status: 'completed' }), NOW), 'done')
  assert.equal(nodePhase(node({ status: 'blocked' }), NOW), 'blocked')
  assert.equal(nodePhase(node({ status: 'pending', planned_end: '2026-11-01 08:00:00' }), NOW), 'overdue')
  assert.equal(nodePhase(node({ status: 'in_progress', planned_end: '2026-11-20 08:00:00' }), NOW), 'running')
  assert.equal(nodePhase(node({ planned_start: null, planned_end: null }), NOW), 'unscheduled')
  assert.equal(nodePhase(node(), NOW), 'upcoming')
})

test('SB.5 汇总：完成率与各类计数', () => {
  const nodes = [
    node({ id: 1, status: 'completed', planned_end: '2026-11-01 08:00:00' }),
    node({ id: 2, status: 'completed', planned_end: '2026-11-02 08:00:00' }),
    node({ id: 3, status: 'pending', planned_end: '2026-11-01 08:00:00' }),
    node({ id: 4, status: 'blocked' }),
    node({ id: 5, planned_start: null, planned_end: null }),
    node({ id: 6, status: 'in_progress', planned_end: '2026-11-20 08:00:00' }),
  ]
  const summary = summarizeNodes(nodes, NOW)
  assert.equal(summary.total, 6)
  assert.equal(summary.completed, 2)
  assert.equal(summary.overdue, 1)
  assert.equal(summary.blocked, 1)
  assert.equal(summary.unscheduled, 1)
  assert.equal(summary.running, 1)
  assert.equal(summary.completionRate, 33)
  assert.equal(summarizeNodes([], NOW).completionRate, 0)
})

test('SB.6 筛选：关键词 / 状态 / 只看异常', () => {
  const nodes = [
    node({ id: 1, operation_name: '焊接', assigned_name: '张三' }),
    node({ id: 2, operation_name: '组对', status: 'blocked' }),
    node({ id: 3, operation_name: '涂装', planned_start: null, planned_end: null }),
    node({ id: 4, operation_name: '下料', planned_end: '2026-11-01 08:00:00' }),
  ]
  assert.equal(filterNodes(nodes, { keyword: '焊' }, NOW).length, 1)
  assert.equal(filterNodes(nodes, { keyword: '张三' }, NOW).length, 1, '负责人也能搜')
  assert.equal(filterNodes(nodes, { status: 'blocked' }, NOW).length, 1)
  assert.equal(filterNodes(nodes, { onlyAbnormal: true }, NOW).length, 3, '受阻 + 未排程 + 超期')
  assert.equal(filterNodes(nodes, {}, NOW).length, 4)

  assert.equal(isAbnormal(node({ status: 'completed' }), NOW), false)
  assert.equal(isAbnormal(node({ planned_start: null, planned_end: null }), NOW), true)
})

test('SB.7 按实例分组：过滤后空实例被丢弃，组内带统计', () => {
  const equipment = [
    { id: 1, instance_code: 'TBM-1', instance_name: '一号机', nodes: [node({ id: 1 }), node({ id: 2, status: 'blocked' })] },
    { id: 2, instance_code: 'TBM-2', instance_name: '二号机', nodes: [node({ id: 3, planned_start: null, planned_end: null })] },
    { id: 3, instance_code: 'TBM-3', instance_name: '三号机', nodes: [] },
  ]
  const all = buildEquipmentBoard(equipment, {}, NOW)
  assert.equal(all.length, 2, '空实例被丢弃')
  assert.equal(all[0].stats.total, 2)
  assert.equal(all[0].instance_code, 'TBM-1')
  const onlyAbnormal = buildEquipmentBoard(equipment, { onlyAbnormal: true }, NOW)
  assert.equal(onlyAbnormal.length, 2)
  assert.equal(onlyAbnormal[1].stats.unscheduled, 1)
  const keywordMiss = buildEquipmentBoard(equipment, { keyword: '不存在' }, NOW)
  assert.deepEqual(keywordMiss, [])
})

test('SB.8 主操作：待开始→开始；进行中/受阻→完成；终态无操作', () => {
  assert.deepEqual(primaryAction(node({ status: 'pending' })), { key: 'start', label: '开始' })
  assert.deepEqual(primaryAction(node({ status: 'in_progress' })), { key: 'complete', label: '完成' })
  assert.deepEqual(primaryAction(node({ status: 'blocked' })), { key: 'complete', label: '完成' })
  assert.equal(primaryAction(node({ status: 'completed' })), null)
  assert.equal(primaryAction(node({ status: 'cancelled' })), null)
})

test('SB.9 周区间与批次范围文案', () => {
  assert.equal(formatWeekLabel('2026-11-02', '2026-11-08'), '11-02 ~ 11-08')
  assert.equal(formatWeekLabel('2026-11-02', null), '11-02')
  assert.equal(formatWeekLabel(null, null), '')
  assert.equal(formatBatchScope({ anchor_date: '2026-11-10', shift_days: 132 }), '对齐 2026-11-10')
  assert.equal(formatBatchScope({ shift_days: 30 }), '顺延 30 天')
  assert.equal(formatBatchScope({ shift_days: 30, instance_id: 1 }), '顺延 30 天 · 项目 #1')
})

test('SB.10 本周计划判定：只算与周区间重叠的节点，未排程不算', () => {
  const weekStart = '2026-11-02'
  const weekEnd = '2026-11-08'
  assert.equal(overlapsWeek(node({ planned_start: '2026-11-03', planned_end: '2026-11-04' }), weekStart, weekEnd), true)
  assert.equal(overlapsWeek(node({ planned_start: '2026-10-28', planned_end: '2026-11-03' }), weekStart, weekEnd), true, '跨周开始')
  assert.equal(overlapsWeek(node({ planned_start: '2026-11-06', planned_end: '2026-11-12' }), weekStart, weekEnd), true, '跨周结束')
  assert.equal(overlapsWeek(node({ planned_start: '2026-11-10', planned_end: '2026-11-12' }), weekStart, weekEnd), false, '下周不算')
  assert.equal(overlapsWeek(node({ planned_start: '2026-10-01', planned_end: '2026-10-05' }), weekStart, weekEnd), false, '上周不算')
  assert.equal(overlapsWeek(node({ planned_start: null, planned_end: null }), weekStart, weekEnd), false, '未排程不算')
})