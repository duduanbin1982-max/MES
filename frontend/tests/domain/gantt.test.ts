// frontend/tests/domain/gantt.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  barGeometry,
  buildScale,
  monthRange,
  monthSegments,
  parseDay,
  arrowEndpoints,
  dependencyPath,
  arrowGeometry,
  arrowHop,
  lagOffsetPx,
  dependencyRelation,
  expandChain,
  nodeHop,
  dependencyTone,
  neighborIds,
  nodeRelation,
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

test('GT.9 dependencyPath：正向走贝塞尔，反向走回绕', () => {
  const forward = dependencyPath({ x: 100, y: 20 }, { x: 240, y: 80 })
  assert.match(forward, /^M 100 20 C /)
  assert.match(forward, /240 80$/)
  // 反向（后继在前驱左侧）：控制点仍然在两端外侧，形成 S 形
  const backward = dependencyPath({ x: 300, y: 20 }, { x: 120, y: 80 })
  assert.match(backward, /^M 300 20 C /)
  assert.match(backward, /120 80$/)
  // 控制点偏移有上下限
  assert.match(dependencyPath({ x: 0, y: 0 }, { x: 4, y: 10 }), /C 12 0, -8 10, 4 10/)
  assert.match(dependencyPath({ x: 0, y: 0 }, { x: 400, y: 10 }), /C 60 0, 340 10, 400 10/)
})

test('GT.10 dependencyTone：超期/受阻链条标红，其余常规', () => {
  assert.equal(dependencyTone('upcoming', 'upcoming'), 'normal')
  assert.equal(dependencyTone('done', 'running'), 'normal')
  assert.equal(dependencyTone('overdue', 'upcoming'), 'danger')
  assert.equal(dependencyTone('done', 'blocked'), 'danger')
})

test('GT.11 arrowEndpoints：前驱右端到后继左端，纵向取中点', () => {
  const result = arrowEndpoints({ left: 10, right: 110, top: 20, height: 20 }, { left: 200, right: 320, top: 60, height: 20 })
  assert.deepEqual(result.from, { x: 110, y: 30 })
  assert.deepEqual(result.to, { x: 200, y: 70 })
})
test('GT.12 dependencyRelation：上游/下游/无关', () => {
  const dep = { id: 1, predecessor_id: 10, successor_id: 20 }
  assert.equal(dependencyRelation(dep, null), 'none')
  assert.equal(dependencyRelation(dep, 20), 'upstream', '选中后继 → 前驱是上游')
  assert.equal(dependencyRelation(dep, 10), 'downstream', '选中前驱 → 后继是下游')
  assert.equal(dependencyRelation(dep, 99), 'none')
})

test('GT.13 neighborIds：只取一跳上下游并去重排序', () => {
  const deps = [
    { id: 1, predecessor_id: 1, successor_id: 2 },
    { id: 2, predecessor_id: 2, successor_id: 3 },
    { id: 3, predecessor_id: 2, successor_id: 4 },
    { id: 4, predecessor_id: 5, successor_id: 2 },
    { id: 5, predecessor_id: 1, successor_id: 2 },
  ]
  assert.deepEqual(neighborIds(deps, 2), { upstream: [1, 5], downstream: [3, 4] }, '1 重复出现只算一次；上游 5 也指向 2')
  assert.deepEqual(neighborIds(deps, 1), { upstream: [], downstream: [2] }, '只取一跳，不含 3/4')
  assert.deepEqual(neighborIds(deps, 3), { upstream: [2], downstream: [] })
  assert.deepEqual(neighborIds(deps, null), { upstream: [], downstream: [] })
})

test('GT.14 nodeRelation：自身/上游/下游/无关', () => {
  const neighbors = { upstream: [1, 5], downstream: [3, 4] }
  assert.equal(nodeRelation(2, 2, neighbors), 'self')
  assert.equal(nodeRelation(5, 2, neighbors), 'upstream')
  assert.equal(nodeRelation(4, 2, neighbors), 'downstream')
  assert.equal(nodeRelation(9, 2, neighbors), 'none')
  assert.equal(nodeRelation(2, null, { upstream: [], downstream: [] }), 'none', '未选中时一律 none')
})
test('GT.15 expandChain：1 跳 / 2 跳 / 全部 / 防环 / 截断', () => {
  // 链：1→2→3→4，另 5→2（汇入），9→1（更长上游）
  const deps = [
    { id: 1, predecessor_id: 1, successor_id: 2 },
    { id: 2, predecessor_id: 2, successor_id: 3 },
    { id: 3, predecessor_id: 3, successor_id: 4 },
    { id: 4, predecessor_id: 5, successor_id: 2 },
    { id: 5, predecessor_id: 9, successor_id: 1 },
  ]
  const one = expandChain(deps, 2, 1)
  assert.deepEqual(one.upstreamIds, [1, 5], '直接前驱 1、5')
  assert.deepEqual(one.downstreamIds, [3], '直接后继 3')
  assert.equal(one.upstream.get(9), undefined, '1 跳不含 9')

  const two = expandChain(deps, 2, 2)
  assert.deepEqual(two.upstreamIds, [1, 5, 9], '2 跳把 9 带进来')
  assert.equal(two.upstream.get(9), 2)
  assert.deepEqual(two.downstreamIds, [3, 4], '2 跳下游到 4，深度 2')
  assert.equal(two.downstream.get(4), 2)

  const all = expandChain(deps, 2, Number.POSITIVE_INFINITY)
  assert.deepEqual(all.downstreamIds, [3, 4], '到边界为止')
  assert.equal(all.truncated, false)

  // 防环：2↔3 成环
  const cyclic = expandChain([
    { id: 1, predecessor_id: 2, successor_id: 3 },
    { id: 2, predecessor_id: 3, successor_id: 2 },
  ], 2, 5)
  assert.deepEqual(cyclic.upstreamIds, [3])
  assert.deepEqual(cyclic.downstreamIds, [3], '环不会无限展开（3 已访问）')

  // 截断
  const many = Array.from({ length: 6 }, (_, index) => ({ id: index + 1, predecessor_id: 100 + index, successor_id: 2 }))
  assert.equal(expandChain(many, 2, 1, 3).truncated, true)
  assert.equal(expandChain(many, 2, 1, 100).truncated, false)
})

test('GT.16 nodeHop / arrowHop：按跳数分类，环取更近一侧', () => {
  const deps = [
    { id: 1, predecessor_id: 1, successor_id: 2 },
    { id: 2, predecessor_id: 2, successor_id: 3 },
    { id: 3, predecessor_id: 3, successor_id: 4 },
  ]
  const chain = expandChain(deps, 2, 3)
  assert.deepEqual(nodeHop(2, 2, chain), { relation: 'none', depth: 0 }, '选中自己')
  assert.deepEqual(nodeHop(1, 2, chain), { relation: 'upstream', depth: 1 })
  assert.deepEqual(nodeHop(3, 2, chain), { relation: 'downstream', depth: 1 })
  assert.deepEqual(nodeHop(4, 2, chain), { relation: 'downstream', depth: 2 })
  assert.deepEqual(nodeHop(99, 2, chain), { relation: 'none', depth: 0 })

  assert.deepEqual(arrowHop(deps[0], 2, chain), { relation: 'upstream', depth: 1 }, '1→2：前驱线')
  assert.deepEqual(arrowHop(deps[1], 2, chain), { relation: 'downstream', depth: 1 }, '2→3：后继线')
  assert.deepEqual(arrowHop(deps[2], 2, chain), { relation: 'downstream', depth: 2 }, '3→4：2 跳下游')
  assert.deepEqual(arrowHop(deps[0], null, chain), { relation: 'none', depth: 0 })
})

test('GT.17 lagOffsetPx：小时换算成时间轴像素', () => {
  assert.equal(lagOffsetPx(0, 30), 0)
  assert.equal(lagOffsetPx(null, 30), 0)
  assert.equal(lagOffsetPx(undefined, 30), 0)
  assert.equal(lagOffsetPx(-8, 30), 0, '负 lag 不偏移')
  assert.equal(lagOffsetPx(8, 30), 10, '8 小时 = 1/3 天 = 10px')
  assert.equal(lagOffsetPx(24, 30), 30)
  assert.equal(lagOffsetPx(8, 0), 0, 'dayWidth 为 0 时不偏移')
})

test('GT.18 arrowGeometry：FS 带 lag 时起点右移并留出空隙', () => {
  const pred = { left: 0, right: 100, top: 10, height: 20 }
  const succ = { left: 300, right: 360, top: 60, height: 20 }
  const plain = arrowGeometry(pred, succ, { dayWidth: 30, lagHours: 0, depType: 'FS' })
  assert.deepEqual(plain.from, { x: 100, y: 20 })
  assert.deepEqual(plain.to, { x: 300, y: 70 })
  assert.equal(plain.lagged, false)

  const lagged = arrowGeometry(pred, succ, { dayWidth: 30, lagHours: 8, depType: 'FS' })
  assert.equal(lagged.from.x, 110, '起点右移 10px')
  assert.deepEqual(lagged.to, { x: 300, y: 70 }, '终点不变')
  assert.equal(lagged.lagged, true)
  assert.equal(lagged.lag_px, 10)

  // lag 太大时夹到"后继起点前 6px"，避免箭头反向
  const clamped = arrowGeometry(pred, succ, { dayWidth: 30, lagHours: 24 * 30, depType: 'FS' })
  assert.equal(clamped.from.x, 294)

  // 非 FS 类型不偏移（当前数据只有 FS，保留扩展位）
  const ss = arrowGeometry(pred, succ, { dayWidth: 30, lagHours: 8, depType: 'SS' })
  assert.equal(ss.from.x, 100)
  assert.equal(ss.lagged, false)
})

test('GT.19 expandChain：单向展开（只看上游 / 只看下游）', () => {
  const deps = [
    { id: 1, predecessor_id: 1, successor_id: 2 },
    { id: 2, predecessor_id: 2, successor_id: 3 },
    { id: 3, predecessor_id: 5, successor_id: 2 },
  ]
  const upstreamOnly = expandChain(deps, 2, 3, 300, 'upstream')
  assert.deepEqual(upstreamOnly.upstreamIds, [1, 5])
  assert.deepEqual(upstreamOnly.downstreamIds, [], '只看上游时下游为空')
  assert.equal(upstreamOnly.truncated, false)

  const downstreamOnly = expandChain(deps, 2, 3, 300, 'downstream')
  assert.deepEqual(downstreamOnly.upstreamIds, [])
  assert.deepEqual(downstreamOnly.downstreamIds, [3])

  const both = expandChain(deps, 2, 1)
  assert.deepEqual(both.upstreamIds, [1, 5])
  assert.deepEqual(both.downstreamIds, [3])
})
