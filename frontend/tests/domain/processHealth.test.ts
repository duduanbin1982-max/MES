// frontend/tests/domain/processHealth.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  blockerText,
  gradeLabel,
  gradeTone,
  metricText,
  nextActionLines,
  stageRows,
  statusLabel,
  statusTone,
} from '../../src/domain/processHealth.ts'

test('PHF.1 状态文案与色调', () => {
  assert.equal(statusLabel('ok'), '已通')
  assert.equal(statusLabel('partial'), '部分')
  assert.equal(statusLabel('empty'), '未开始')
  assert.equal(statusTone('ok'), 'success')
  assert.equal(statusTone('partial'), 'warning')
  assert.equal(statusTone('empty'), 'info')
  assert.equal(gradeLabel('healthy'), '流程健康')
  assert.equal(gradeLabel('partial'), '部分可跑')
  assert.equal(gradeLabel('blocked'), '流程阻塞')
  assert.equal(gradeTone('blocked'), 'danger')
})

test('PHF.2 metricText：拼指标，空数组给占位符', () => {
  assert.equal(metricText([{ key: 'a', label: '里程碑', value: 10 }, { key: 'b', label: '合同号', value: 1 }]), '里程碑 10 · 合同号 1')
  assert.equal(metricText([]), '—')
  assert.equal(metricText(undefined), '—')
})

test('PHF.3 blockerText：最多两条，无卡点给空串', () => {
  const stage: any = { blockers: ['A', 'B', 'C'] }
  assert.equal(blockerText(stage), 'A；B')
  assert.equal(blockerText({ blockers: [] } as any), '')
  assert.equal(blockerText({} as any), '')
})

test('PHF.4 stageRows：补齐缺省字段，status 非法值回落 empty', () => {
  const rows = stageRows([
    { key: 'project', label: '项目', page: '/instances', status: 'ok' as any, score: 100 },
    { key: 'documents', label: '文档', page: '/documents', status: 'weird' as any },
  ] as any)
  assert.equal(rows[0].status, 'ok')
  assert.deepEqual(rows[0].metrics, [])
  assert.equal(rows[1].status, 'empty')
  assert.equal(rows[1].score, 0)
  assert.equal(stageRows(undefined).length, 0)
})

test('PHF.5 nextActionLines：最多 3 条，格式「环节：动作」', () => {
  const lines = nextActionLines([
    { stage: '派工与报工', action: '每天报工' },
    { stage: '齐套与领料', action: '领料核对' },
    { stage: '检验与证据', action: '补 NDT' },
    { stage: '文档与图纸', action: '上传图纸' },
  ])
  assert.equal(lines.length, 3)
  assert.equal(lines[0], '派工与报工：每天报工')
  assert.deepEqual(nextActionLines(undefined), [])
})
