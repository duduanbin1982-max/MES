// frontend/tests/domain/traceChain.test.ts
// P0-2 前端纯逻辑：链路状态徽标 / 覆盖率状态 / 断点摘要 / 锚点提示 / 证据摘要。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  anchorMeta,
  coverageStatus,
  evidenceSummary,
  gapSummary,
  levelStatusMeta,
} from '../../src/domain/traceChain.ts'

test('TRACEUI.1 levelStatusMeta：ok/partial/missing/未知', () => {
  assert.equal(levelStatusMeta('ok').type, 'success')
  assert.equal(levelStatusMeta('partial').type, 'warning')
  assert.equal(levelStatusMeta('missing').type, 'danger')
  assert.equal(levelStatusMeta(undefined).type, 'info')
  assert.equal(levelStatusMeta('ok').label, '有证据')
})

test('TRACEUI.2 coverageStatus：80/40 分档', () => {
  assert.equal(coverageStatus(100), 'success')
  assert.equal(coverageStatus(80), 'success')
  assert.equal(coverageStatus(79.9), 'warning')
  assert.equal(coverageStatus(40), 'warning')
  assert.equal(coverageStatus(39), 'exception')
  assert.equal(coverageStatus(undefined), 'exception')
})

test('TRACEUI.3 gapSummary：总数与前 N 条', () => {
  const gaps = [
    { level: 4, issue: 'a', action: 'x' },
    { level: 4, issue: 'b', action: 'y' },
    { level: 5, issue: 'c', action: 'z' },
    { level: 5, issue: 'd', action: 'w' },
  ]
  const s = gapSummary(gaps)
  assert.equal(s.total, 4)
  assert.equal(s.head.length, 3)
  assert.equal(s.head[0].issue, 'a')
  assert.deepEqual(gapSummary(null), { total: 0, head: [] })
})

test('TRACEUI.4 anchorMeta：四种锚点 + 兜底', () => {
  assert.equal(anchorMeta('serial_no').label, '序列号')
  assert.match(anchorMeta('lot_no').placeholder, /LOT/)
  assert.equal(anchorMeta('instance_code').label, '装备编码')
  assert.equal(anchorMeta('wo_code').label, '工单号')
  assert.equal(anchorMeta('other').label, '编号')
})

test('TRACEUI.5 evidenceSummary：拼接六类证据计数', () => {
  const text = evidenceSummary({ inspections: 3, work_order_qc: 0, welds: 1, ndt: 2, assemblies: 0, documents: 4 })
  assert.match(text, /检验 3/)
  assert.match(text, /焊缝 1/)
  assert.match(text, /NDT 2/)
  assert.match(text, /文档 4/)
  assert.equal(evidenceSummary(null), '检验 0 · 工单检验 0 · 焊缝 0 · NDT 0 · 装配 0 · 文档 0')
})
