// frontend/tests/domain/workOrderTimeline.test.ts
// 覆盖工单流转抽屉的纯逻辑（组件本体只留渲染与交互）。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  actionLabel,
  flattenHistory,
  lastAction,
  stateTagType,
} from '../../src/domain/workOrderTimeline.ts'

test('WOT.1 actionLabel：已知动作翻译为中文，未知动作原样返回，空值返回 -', () => {
  assert.equal(actionLabel('dispatch'), '派工')
  assert.equal(actionLabel('report'), '报工')
  assert.equal(actionLabel('complete'), '完工')
  assert.equal(actionLabel('custom_event'), 'custom_event')
  assert.equal(actionLabel(null), '-')
  assert.equal(actionLabel(undefined), '-')
})

test('WOT.2 stateTagType：终态/异常/进行中/其他 四类映射', () => {
  assert.equal(stateTagType('completed'), 'success')
  assert.equal(stateTagType('archived'), 'success')
  assert.equal(stateTagType('cancelled'), 'danger')
  assert.equal(stateTagType('revoked'), 'danger')
  assert.equal(stateTagType('in_progress'), 'warning')
  assert.equal(stateTagType('pending'), 'info')
  assert.equal(stateTagType(null), 'info')
})

test('WOT.3 flattenHistory：多实例拍平并按时间倒序（最新在前）', () => {
  const instances = [
    { id: 1, history: [
      { id: 1, action: 'start', created_at: '2026-10-17 10:00:00' },
      { id: 2, action: 'dispatch', created_at: '2026-10-17 11:00:00' },
    ] },
    { id: 2, history: [
      { id: 3, action: 'report', created_at: '2026-10-17 12:00:00' },
    ] },
  ]
  const rows = flattenHistory(instances)
  assert.deepEqual(rows.map((r) => r.action), ['report', 'dispatch', 'start'])
})

test('WOT.4 flattenHistory：同一时间戳按 id 倒序，空值安全', () => {
  const rows = flattenHistory([
    { id: 1, history: [
      { id: 5, action: 'a', created_at: '2026-10-17 10:00:00' },
      { id: 7, action: 'b', created_at: '2026-10-17 10:00:00' },
    ] },
  ])
  assert.deepEqual(rows.map((r) => r.id), [7, 5])
  assert.deepEqual(flattenHistory(null), [])
  assert.deepEqual(flattenHistory([{ id: 1, history: null }]), [])
})

test('WOT.5 lastAction：返回最近一条，无记录返回 null', () => {
  const last = lastAction([{ id: 1, history: [
    { id: 1, action: 'start', created_at: '2026-10-17 09:00:00' },
    { id: 2, action: 'complete', created_at: '2026-10-17 18:00:00' },
  ] }])
  assert.equal(last?.action, 'complete')
  assert.equal(lastAction([]), null)
  assert.equal(lastAction(undefined), null)
})

test('WOT.6 交互动作清单与后端动作名一致（防前端硬编码漂移）', () => {
  // 与 app/workflow/workOrderDefinition.js 的 6 个事件同名
  const backendEvents = ['dispatch', 'start', 'pause', 'complete', 'report', 'cancel']
  for (const e of backendEvents) {
    assert.ok(actionLabel(e) !== e, `${e} 应有中文标签`)
  }
  // 不应把未知动作误翻成中文
  assert.equal(actionLabel('nosuch'), 'nosuch')
})
