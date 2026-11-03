// frontend/tests/domain/gantt.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  barGeometry,
  buildScale,
  monthRange,
  monthSegments,
  parseDay,
  shiftDates,
  tickLabel,
  toDayString,
  todayOffset,
  ZOOM_DAY_WIDTH,
} from '../../src/domain/gantt.ts'

test('GT.1 buildScale：天数、周末标记、宽度', () => {
  const scale = buildScale('2026-11-01', '2026-11-30', 'day')
  assert.equal(scale.days.length, 30)
  assert.equal(scale.dayWidth, ZOOM_DAY_WIDTH.day)
  assert.equal(scale.totalWidth, 30 * ZOOM_DAY_WIDTH.day)
  // 2026-11-01 是周日
  assert.equal(scale.days[0].is_weekend, true)
  assert.equal(scale.days[1].date, '2026-11-02')
  assert.equal(scale.days[1].is_month_start, false)
  assert.equal(scale.days[0].is_month_start, true)
  // 缩放
  assert.equal(buildScale('2026-11-01', '2026-11-30', 'week').dayWidth, ZOOM_DAY_WIDTH.week)
  assert.equal(buildScale('2026-11-01', '2026-11-30', 'month').dayWidth, ZOOM_DAY_WIDTH.month)
})

test('GT.2 barGeometry：单天/多天/区间外/无计划时间', () => {
  const scale = buildScale('2026-11-01', '2026-11-30', 'day')
  const single = barGeometry({ id: 1, planned_start: '2026-11-10', planned_end: '2026-11-10' }, scale)
  assert.equal(single?.left, 9 * ZOOM_DAY_WIDTH.day)
  assert.ok((single?.width || 0) > 0)
  const multi = barGeometry({ id: 2, planned_start: '2026-11-10', planned_end: '2026-11-12' }, scale)
  assert.equal(multi?.left, 9 * ZOOM_DAY_WIDTH.day)
  assert.equal(multi?.width, 3 * ZOOM_DAY_WIDTH.day - 2)
  assert.equal(barGeometry({ id: 3, planned_start: '2026-12-10', planned_end: '2026-12-12' }, scale), null, '区间后')
  assert.equal(barGeometry({ id: 4, planned_start: '2026-10-01', planned_end: '2026-10-02' }, scale), null, '区间前')
  assert.equal(barGeometry({ id: 5, planned_start: null, planned_end: null }, scale), null)
})

test('GT.3 barGeometry：跨区间边界被裁剪', () => {
  const scale = buildScale('2026-11-01', '2026-11-30', 'day')
  const clippedLeft = barGeometry({ id: 1, planned_start: '2026-10-20', planned_end: '2026-11-02' }, scale)
  assert.equal(clippedLeft?.left, 0)
  const clippedRight = barGeometry({ id: 2, planned_start: '2026-11-29', planned_end: '2026-12-15' }, scale)
  assert.ok((clippedRight?.left || 0) > 0)
  assert.ok((clippedRight?.left || 0) + (clippedRight?.width || 0) <= scale.totalWidth)
})

test('GT.4 shiftDates：保留原时间格式（日期 / 带时分秒）', () => {
  const dateOnly = shiftDates({ id: 1, planned_start: '2026-11-10', planned_end: '2026-11-12' }, 3)
  assert.deepEqual(dateOnly, { planned_start: '2026-11-13', planned_end: '2026-11-15' })
  const withTime = shiftDates({ id: 2, planned_start: '2026-11-10 04:00:00', planned_end: '2026-11-11 08:00:00' }, -2)
  assert.deepEqual(withTime, { planned_start: '2026-11-08 04:00:00', planned_end: '2026-11-09 08:00:00' })
  assert.deepEqual(shiftDates({ id: 3, planned_start: null, planned_end: null }, 5), { planned_start: null, planned_end: null })
  // 跨月
  assert.deepEqual(shiftDates({ id: 4, planned_start: '2026-11-30', planned_end: '2026-12-02' }, 2), { planned_start: '2026-12-02', planned_end: '2026-12-04' })
})

test('GT.5 monthRange：普通月 / 2 月 / 闰年', () => {
  assert.deepEqual(monthRange(new Date(2026, 10, 15)), { from: '2026-11-01', to: '2026-11-30' })
  assert.deepEqual(monthRange(new Date(2026, 1, 5)), { from: '2026-02-01', to: '2026-02-28' })
  assert.deepEqual(monthRange(new Date(2028, 1, 5)), { from: '2028-02-01', to: '2028-02-29' })
})

test('GT.6 todayOffset：区间内给像素，区间外返回 null', () => {
  const scale = buildScale('2026-11-01', '2026-11-30', 'day')
  assert.equal(todayOffset(scale, new Date(2026, 10, 10)), 9 * ZOOM_DAY_WIDTH.day + ZOOM_DAY_WIDTH.day / 2)
  assert.equal(todayOffset(scale, new Date(2026, 11, 10)), null)
  assert.equal(todayOffset(scale, new Date(2026, 9, 10)), null)
})

test('GT.7 monthSegments + tickLabel：表头跨列与刻度', () => {
  const scale = buildScale('2026-11-01', '2026-12-31', 'day')
  const segments = monthSegments(scale)
  assert.equal(segments.length, 2)
  assert.equal(segments[0].label, '2026-11')
  assert.equal(segments[0].days, 30)
  assert.equal(segments[1].label, '2026-12')
  assert.equal(segments[1].days, 31)

  const dayScale = buildScale('2026-11-01', '2026-11-30', 'day')
  assert.equal(tickLabel(dayScale.days[9], 'day', 9), '10')
  assert.equal(tickLabel(dayScale.days[8], 'week', 8), '', '周视图只在每 7 天出刻度')
  assert.equal(tickLabel(dayScale.days[7], 'week', 7), '8')
  assert.equal(tickLabel(dayScale.days[0], 'month', 0), '1')
  assert.equal(tickLabel(dayScale.days[1], 'month', 1), '')
})

test('GT.8 日期工具：parseDay / toDayString / 跨月加法', () => {
  assert.equal(toDayString(parseDay('2026-11-04 10:00:00')!), '2026-11-04')
  assert.equal(parseDay('乱写'), null)
  assert.equal(parseDay(null), null)
  const scale = buildScale('2026-12-30', '2027-01-02', 'day')
  assert.deepEqual(scale.days.map((day) => day.date), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'])
})
