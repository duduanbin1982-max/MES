// frontend/tests/domain/costVariance.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  confidenceTag,
  contributorText,
  notComputedSummary,
  signedMoney,
  varianceKind,
  varianceLabel,
  varianceTone,
} from '../../src/domain/costVariance.ts'

test('CVD.1 差异语义：超支/节约/持平（含小数容差）', () => {
  assert.equal(varianceKind(380), 'over')
  assert.equal(varianceKind(-380), 'under')
  assert.equal(varianceKind(0), 'flat')
  assert.equal(varianceKind(0.003), 'flat')
  assert.equal(varianceKind(undefined), 'flat')
  assert.equal(varianceLabel(-1200), '节约')
  assert.equal(varianceTone(380), 'text-danger')
  assert.equal(varianceTone(-1), 'text-success')
})

test('CVD.2 带符号金额格式', () => {
  assert.equal(signedMoney(1234.5), '+1,234.50')
  assert.equal(signedMoney(-987.6), '-987.60')
  assert.equal(signedMoney(0), '0.00')
  assert.equal(signedMoney(null), '0.00')
})

test('CVD.3 可信度徽标', () => {
  assert.equal(confidenceTag('full').type, 'success')
  assert.equal(confidenceTag('partial').type, 'warning')
  assert.equal(confidenceTag(undefined).label, '部分数据缺失')
})

test('CVD.4 未计入摘要：未领料 + 人工', () => {
  const lines = notComputedSummary({
    quantity: [{ standard_cost: 5000 }, { standard_cost: 1500 }],
    labor: [{ reason: 'no_actual_hours' }],
  })
  assert.equal(lines.length, 2)
  assert.match(lines[0], /2 种物料未领料/)
  assert.match(lines[0], /6,500/)
  assert.match(lines[1], /人工效率差未计入/)
  assert.deepEqual(notComputedSummary(null), [])
})

test('CVD.5 Top 贡献项文案', () => {
  assert.equal(contributorText({ name: '主轴承', total_variance: 380 }), '主轴承（+380.00 元）')
  assert.equal(contributorText(null), '-')
  assert.equal(contributorText({ name: '', total_variance: -50 }), '未命名（-50.00 元）')
})
