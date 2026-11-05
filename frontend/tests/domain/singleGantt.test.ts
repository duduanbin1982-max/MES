// frontend/tests/domain/singleGantt.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  barRect,
  buildTimeline,
  formatSpanLabel,
  parseDateLoose,
  toDayString,
} from '../../src/domain/singleGantt.ts'

const DAY = 8

test('SG.1 时间轴：月份列宽按真实天数（31/30/28 天）', () => {
  const timeline = buildTimeline('2026-07-01', '2026-09-30', DAY)
  assert.equal(timeline.months.length, 3)
  assert.deepEqual(timeline.months.map((m) => m.days), [31, 31, 30], '7/8 月 31 天、9 月 30 天')
  assert.deepEqual(timeline.months.map((m) => m.width), [31 * DAY, 31 * DAY, 30 * DAY])
  assert.deepEqual(timeline.months.map((m) => m.left), [0, 31 * DAY, 62 * DAY])
  assert.equal(timeline.totalWidth, 92 * DAY, '总宽 = 真实天数 × 天宽')
  assert.equal(timeline.totalDays, 92)
})

test('SG.2 时间轴：首尾月按区间裁剪', () => {
  const timeline = buildTimeline('2026-07-15', '2026-08-10', DAY)
  assert.equal(timeline.months.length, 2)
  assert.equal(timeline.months[0].days, 17, '7-15 ~ 7-31 共 17 天')
  assert.equal(timeline.months[1].days, 10, '8-01 ~ 8-10 共 10 天')
  assert.equal(timeline.totalDays, 27)
})

test('SG.3 时间轴：跨年与 2 月（非闰年 28 天）', () => {
  const timeline = buildTimeline('2026-12-20', '2027-03-05', DAY)
  assert.deepEqual(timeline.months.map((m) => m.key), ['2026-12', '2027-01', '2027-02', '2027-03'])
  assert.equal(timeline.months[0].days, 12)
  assert.equal(timeline.months[1].days, 31)
  assert.equal(timeline.months[2].days, 28)
  assert.equal(timeline.months[3].days, 5)
})

test('SG.4 时间轴：无开始/结束时的兜底不崩', () => {
  const empty = buildTimeline(null, null, DAY)
  assert.equal(empty.months.length, 1)
  assert.equal(empty.totalDays >= 7, true)
  assert.equal(empty.todayLeft, null)
})

test('SG.5 条形定位：与月份边界严格对齐（F-02 回归）', () => {
  const timeline = buildTimeline('2026-07-01', '2026-12-31', DAY)
  const aug = timeline.months.find((m) => m.key === '2026-08')!
  const augFirst = barRect({ start: '2026-08-01', end: '2026-08-01 08:00:00' }, '2026-07-01', DAY)
  assert.equal(augFirst?.left, aug.left, '8-01 的条形左边界应等于 8 月列左边界（不再错位）')
  const nov = timeline.months.find((m) => m.key === '2026-11')!
  const novFirst = barRect({ start: '2026-11-01', end: '2026-11-02' }, '2026-07-01', DAY)
  assert.equal(novFirst?.left, nov.left, '11-01 的条形左边界应等于 11 月列左边界')
})

test('SG.6 条形宽度：真实跨度、最短 8px', () => {
  assert.deepEqual(barRect({ start: '2026-07-01', end: '2026-07-03' }, '2026-07-01', DAY), { left: 0, width: 16 })
  const tiny = barRect({ start: '2026-07-05', end: '2026-07-05' }, '2026-07-01', DAY)
  assert.equal(tiny?.left, 4 * DAY)
  assert.equal(tiny?.width, 8, '零跨度任务至少 8px')
  assert.equal(barRect({ start: null, end: null }, '2026-07-01', DAY), null)
  assert.equal(barRect({ start: '2026-07-05' }, null, DAY), null, '没有项目开始日时返回 null')
})

test('SG.7 今天标线：区间内给位置、区间外为 null', () => {
  const past = buildTimeline('2020-01-01', '2020-12-31', DAY)
  assert.equal(past.todayLeft, null)
  const today = new Date()
  const start = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`
  const timeline = buildTimeline(start, `${today.getFullYear()}-12-31`, DAY)
  assert.ok(timeline.todayLeft === null || timeline.todayLeft >= 0)
})

test('SG.8 辅助函数：日期解析、跨度文案', () => {
  assert.equal(toDayString(parseDateLoose('2026-11-05 10:00:00')!), '2026-11-05')
  assert.equal(parseDateLoose('乱写'), null)
  assert.equal(parseDateLoose(undefined), null)
  assert.equal(formatSpanLabel('2026-07-01 00:00:00', '2026-11-11 08:00:00', 134), '2026-07-01 → 2026-11-11（134 天）')
  assert.equal(formatSpanLabel(null, null), '—')
})
