// frontend/tests/domain/workload.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyPresetTarget,
  canReassign,
  cellText,
  dropHint,
  sameWorkstation,
  formatHours,
  heatLevelClass,
  heatLevelTag,
  limitDays,
  loadToneClass,
  peakDayText,
  pickCellItems,
} from '../../src/domain/workload.ts'

test('WLD.1 热力等级 → 标签与配色', () => {
  assert.equal(heatLevelTag('overload').type, 'danger')
  assert.equal(heatLevelTag('busy').type, 'warning')
  assert.equal(heatLevelTag('normal').type, 'success')
  assert.equal(heatLevelTag('idle').type, 'info')
  assert.equal(heatLevelTag(undefined).label, '空闲')
  assert.equal(heatLevelClass('overload'), 'heat-overload')
  assert.equal(heatLevelClass('normal'), 'heat-normal')
})

test('WLD.2 利用率语义色：>=100 红 / >=80 黄 / 其余绿', () => {
  assert.equal(loadToneClass(120), 'text-danger')
  assert.equal(loadToneClass(100), 'text-danger')
  assert.equal(loadToneClass(85), 'text-warning')
  assert.equal(loadToneClass(30), 'text-success')
  assert.equal(loadToneClass(undefined), 'text-success')
})

test('WLD.3 小时/单元格文案', () => {
  assert.equal(formatHours(9.24), '9.2h')
  assert.equal(formatHours(0), '0h')
  assert.equal(formatHours(null), '0h')
  assert.equal(cellText({ day: '2026-06-18', busy_hours: 9.2, capacity_hours: 8, utilization_pct: 115, level: 'overload' }), '9.2h / 115%')
  assert.equal(cellText(null), '-')
})

test('WLD.4 峰值日兼容对象/字符串', () => {
  assert.equal(peakDayText({ day: '2026-06-19', busy_hours: 24, utilization_pct: 300 }), '2026-06-19')
  assert.equal(peakDayText('2026-06-19'), '2026-06-19')
  assert.equal(peakDayText(undefined), '-')
})

test('WLD.5 长窗口截断（>31 天只显示前 31 天）', () => {
  const days = Array.from({ length: 30 }, (_, i) => `2026-06-${String(i + 1).padStart(2, '0')}`)
  assert.deepEqual(limitDays(days, 31), { shown: days, hidden: 0 })
  const long = Array.from({ length: 60 }, (_, i) => `d${i}`)
  const result = limitDays(long, 31)
  assert.equal(result.shown.length, 31)
  assert.equal(result.hidden, 29)
  assert.deepEqual(limitDays(null), { shown: [], hidden: 0 })
})

test('WLD.6 pickCellItems：按工位 + 日期重叠筛任务', () => {
  const items = [
    { ws_id: 3, name: '焊缝 A', start_date: '2026-06-18', end_date: '2026-06-21' },
    { ws_id: 3, name: '焊缝 B', start_date: '2026-06-25', end_date: '2026-06-26' },
    { ws_id: 5, name: '镗孔', start_date: '2026-06-18', end_date: '2026-06-18' },
  ]
  const day = pickCellItems(items, 3, '2026-06-19')
  assert.deepEqual(day.map((i) => i.name), ['焊缝 A'])
  assert.deepEqual(pickCellItems(items, 3, '2026-06-18').map((i) => i.name), ['焊缝 A'])
  assert.deepEqual(pickCellItems(items, 5, '2026-06-18').map((i) => i.name), ['镗孔'])
  assert.deepEqual(pickCellItems(null, 3, '2026-06-18'), [])
})

test('WLD.7 拖拽改派：只有工序可改派，工单不可', () => {
  assert.equal(canReassign({ type: 'process_node' }), true)
  assert.equal(canReassign({ type: 'work_order' }), false)
  assert.equal(canReassign(null), false)
})

test('WLD.8 applyPresetTarget：只给工序预置目标，工单保持不动', () => {
  const items = [
    { type: 'process_node', source_id: 11, _target: null },
    { type: 'work_order', source_id: 2, _target: null },
  ]
  const next = applyPresetTarget(items, 5)
  assert.equal(next[0]._target, 5)
  assert.equal(next[1]._target, null)
  assert.equal(items[0]._target, null, '不修改原数组')
})

test('WLD.9 同工位判定 + 拖拽提示', () => {
  assert.equal(sameWorkstation(3, 3), true)
  assert.equal(sameWorkstation(3, '3'), true)
  assert.equal(sameWorkstation(3, 5), false)
  assert.equal(sameWorkstation(null, 5), false)
  assert.equal(dropHint(3, 3).ok, false)
  assert.match(dropHint(3, 5, '镗孔工位').text, /镗孔工位/)
})
