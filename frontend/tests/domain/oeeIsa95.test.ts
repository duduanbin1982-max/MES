// frontend/tests/domain/oeeIsa95.test.ts
// P0-1 前端纯逻辑：分钟格式化 / 损失分桶 / 数据质量徽标 / 来源标签。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildBasisRows,
  buildLossBuckets,
  formatMinutes,
  pctText,
  qualityBadgeOf,
  sourceLabel,
} from '../../src/domain/oeeIsa95.ts'

test('OEEUI.1 formatMinutes：分钟/小时分档，空值安全', () => {
  assert.equal(formatMinutes(0), '0 分钟')
  assert.equal(formatMinutes(undefined), '0 分钟')
  assert.equal(formatMinutes(45), '45 分钟')
  assert.equal(formatMinutes(90), '1.5 小时')
  assert.equal(formatMinutes(540), '9 小时')
})

test('OEEUI.2 pctText：比率转百分比，非法值返回 -', () => {
  assert.equal(pctText(0.8), '80.0%')
  assert.equal(pctText(0.64444), '64.4%')
  assert.equal(pctText(undefined), '-')
})

test('OEEUI.3 buildLossBuckets：相对计划生产时间算百分比，超 100 截断', () => {
  const rows = buildLossBuckets({ availability: 90, performance: 45, quality: 0, planned_stop: 600 }, 450)
  assert.deepEqual(rows.map((r) => r.key), ['availability', 'performance', 'quality', 'planned_stop'])
  assert.equal(rows[0].pct, 20)
  assert.equal(rows[1].pct, 10)
  assert.equal(rows[2].status, '')
  assert.equal(rows[3].pct, 100, '计划停机 600/450 超过 100% 应截断')
  // 无计划生产时间时不崩
  assert.equal(buildLossBuckets(null, 0)[0].pct, 0)
})

test('OEEUI.4 qualityBadgeOf：ok / mismatch / legacy 三态', () => {
  const ok = qualityBadgeOf({ level: 'ok', tolerance_pct: 2, legacy_shifts: 0 })
  assert.equal(ok.type, 'success')
  assert.match(ok.description, /2%/)

  // ok 但仍有 legacy 班次 → 「部分可校验」（warning），不夸大成全量通过
  const partial = qualityBadgeOf({ level: 'ok', tolerance_pct: 2, legacy_shifts: 117, verifiable_shifts: 3 })
  assert.equal(partial.type, 'warning')
  assert.equal(partial.label, '部分可校验')
  assert.match(partial.description, /117/)
  assert.match(partial.description, /3 个班次全部通过/)

  const mismatch = qualityBadgeOf({ level: 'mismatch', tolerance_pct: 2 })
  assert.equal(mismatch.type, 'danger')
  assert.match(mismatch.description, /差异超过/)

  const legacy = qualityBadgeOf({ level: 'legacy', legacy_shifts: 117 })
  assert.equal(legacy.type, 'info')
  assert.match(legacy.description, /117/)

  assert.equal(qualityBadgeOf(null).type, 'info')
})

test('OEEUI.5 sourceLabel：三类来源 + 未知兜底', () => {
  assert.equal(sourceLabel('manual'), '手工录入')
  assert.equal(sourceLabel('iot'), 'IoT 采集')
  assert.equal(sourceLabel('system'), '系统推算')
  assert.equal(sourceLabel('other'), 'other')
  assert.equal(sourceLabel(null), '未知来源')
})

test('OEEUI.6 buildBasisRows：7 行三层基线且顺序正确', () => {
  const rows = buildBasisRows({
    shift_minutes: 480, planned_stop_minutes: 30, planned_production_minutes: 450,
    run_minutes: 360, net_run_minutes: 300, availability_loss_minutes: 90, performance_loss_minutes: 60,
  })
  assert.equal(rows.length, 7)
  assert.deepEqual(rows.map((r) => r.key), ['shift', 'planned_stop', 'planned_production', 'availability_loss', 'run', 'performance_loss', 'net_run'])
  assert.equal(rows[0].text, '8 小时')
  assert.equal(buildBasisRows(null).length, 7)
})
