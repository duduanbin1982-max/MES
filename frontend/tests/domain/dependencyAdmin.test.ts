// frontend/tests/domain/dependencyAdmin.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEP_TYPES,
  depTypeHint,
  depTypeLabel,
  formatLagHours,
  nodeOptionLabel,
  validateDependencyDraft,
} from '../../src/domain/dependencyAdmin.ts'

test('DA.1 依赖类型文案与说明', () => {
  assert.deepEqual([...DEP_TYPES], ['FS', 'SS', 'FF', 'SF'])
  assert.equal(depTypeLabel('FS'), '完成-开始')
  assert.equal(depTypeLabel('ss'), '开始-开始', '大小写不敏感')
  assert.equal(depTypeLabel('FF'), '完成-完成')
  assert.equal(depTypeLabel('SF'), '开始-完成')
  assert.equal(depTypeLabel(null), '完成-开始', '默认 FS')
  assert.match(depTypeHint('FS'), /前驱完成后/)
  assert.equal(depTypeHint('XX'), '')
})

test('DA.2 lag 展示：0 / 小时 / 整天 / 跨天', () => {
  assert.equal(formatLagHours(0), '无间隔')
  assert.equal(formatLagHours(null), '无间隔')
  assert.equal(formatLagHours(undefined), '无间隔')
  assert.equal(formatLagHours(8), '8 小时')
  assert.equal(formatLagHours(23), '23 小时')
  assert.equal(formatLagHours(24), '1 天')
  assert.equal(formatLagHours(48), '2 天')
  assert.equal(formatLagHours(36), '1.5 天（36h）')
})

test('DA.3 草稿校验：必填与自依赖', () => {
  const empty = validateDependencyDraft({})
  assert.equal(empty.ok, false)
  assert.deepEqual(empty.errors, ['请选择前驱工序', '请选择后继工序'])

  const same = validateDependencyDraft({ predecessor_id: 5, successor_id: 5 })
  assert.equal(same.ok, false)
  assert.ok(same.errors.some((item) => /同一道工序/.test(item)))
})

test('DA.4 草稿校验：类型与间隔范围', () => {
  const badType = validateDependencyDraft({ predecessor_id: 1, successor_id: 2, dep_type: 'XX' })
  assert.equal(badType.ok, false)
  assert.ok(badType.errors.some((item) => /类型必须是/.test(item)))

  const negative = validateDependencyDraft({ predecessor_id: 1, successor_id: 2, lag_hours: -1 })
  assert.equal(negative.ok, false)
  assert.ok(negative.errors.some((item) => /不小于 0/.test(item)))

  const tooBig = validateDependencyDraft({ predecessor_id: 1, successor_id: 2, lag_hours: 8761 })
  assert.equal(tooBig.ok, false)
  assert.ok(tooBig.errors.some((item) => /不能超过 8760/.test(item)))

  const good = validateDependencyDraft({ predecessor_id: 1, successor_id: 2, dep_type: 'SS', lag_hours: 8 })
  assert.deepEqual(good, { ok: true, errors: [] })
})

test('DA.5 工序下拉文案：带 id / 名称 / 状态中文', () => {
  assert.equal(nodeOptionLabel({ id: 135, operation_name: '下料', status: 'ready' }), '#135 下料（已就绪）')
  assert.equal(nodeOptionLabel({ id: 7, operation_name: null, status: 'in_progress' }), '#7 （未命名工序）（进行中）')
  assert.equal(nodeOptionLabel({ id: 8 }), '#8 （未命名工序）')
  assert.equal(nodeOptionLabel({ id: 9, operation_name: '总装', status: 'weird' }), '#9 总装（weird）')
})
