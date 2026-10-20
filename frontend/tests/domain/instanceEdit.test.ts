// frontend/tests/domain/instanceEdit.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { buildInstancePatch, normalizeProgressPct } from '../../src/domain/instanceEdit.ts'

test('IED.1 进度归一：夹在 0~100、四舍五入、非法值归 0', () => {
  assert.equal(normalizeProgressPct('5'), 5)
  assert.equal(normalizeProgressPct(5.6), 6)
  assert.equal(normalizeProgressPct(-10), 0)
  assert.equal(normalizeProgressPct(120), 100)
  assert.equal(normalizeProgressPct('abc'), 0)
  assert.equal(normalizeProgressPct(null), 0)
})

test('IED.2 只提交已知字段，未知字段被丢弃', () => {
  const patch = buildInstancePatch({ progress_pct: 5, hacker: 'x', created_at: 'y' })
  assert.deepEqual(patch, { progress_pct: 5 })
})

test('IED.3 空字符串转 null，纯空格也转 null', () => {
  const patch = buildInstancePatch({ customer_contact: '', site_location: '  ' })
  assert.deepEqual(patch, { customer_contact: null, site_location: null })
})

test('IED.4 合同金额：数字字符串转数字，非法转 null', () => {
  assert.deepEqual(buildInstancePatch({ contract_amount: '1000' }), { contract_amount: 1000 })
  assert.deepEqual(buildInstancePatch({ contract_amount: 'abc' }), { contract_amount: null })
})

test('IED.5 字符串字段去首尾空格', () => {
  assert.deepEqual(buildInstancePatch({ customer_name: '  郑州地铁  ' }), { customer_name: '郑州地铁' })
})
