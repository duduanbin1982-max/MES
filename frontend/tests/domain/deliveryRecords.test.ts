// frontend/tests/domain/deliveryRecords.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  acceptanceResultLabel,
  acceptanceResultTone,
  acceptanceTypeLabel,
  canTransitionDelivery,
  deliveryStatusLabel,
  deliveryStatusTone,
  deliveryTypeLabel,
  nextDeliveryStatuses,
  signSummary,
  transportModeLabel,
} from '../../src/domain/deliveryRecords.ts'

test('DLR.1 交付状态文案与色调', () => {
  assert.equal(deliveryStatusLabel('planned'), '已计划')
  assert.equal(deliveryStatusLabel('in_transit'), '运输中')
  assert.equal(deliveryStatusLabel('accepted'), '已验收')
  assert.equal(deliveryStatusLabel('unknown'), 'unknown')
  assert.equal(deliveryStatusTone('accepted'), 'success')
  assert.equal(deliveryStatusTone('cancelled'), 'danger')
  assert.equal(deliveryStatusTone(undefined), 'info')
})

test('DLR.2 状态机：只允许相邻推进，终态无下一步', () => {
  assert.deepEqual(nextDeliveryStatuses('planned'), ['shipped', 'cancelled'])
  assert.deepEqual(nextDeliveryStatuses('arrived'), ['accepted', 'cancelled'])
  assert.deepEqual(nextDeliveryStatuses('accepted'), [])
  assert.deepEqual(nextDeliveryStatuses('cancelled'), [])
  assert.deepEqual(nextDeliveryStatuses('bogus'), [])

  assert.equal(canTransitionDelivery('planned', 'shipped'), true)
  assert.equal(canTransitionDelivery('planned', 'arrived'), false, '不允许跳步')
  assert.equal(canTransitionDelivery('accepted', 'cancelled'), false, '终态不可再变')
})

test('DLR.3 类型/运输方式文案', () => {
  assert.equal(deliveryTypeLabel('machine'), '整机')
  assert.equal(deliveryTypeLabel('spare_parts'), '备件')
  assert.equal(transportModeLabel('road'), '公路')
  assert.equal(transportModeLabel('sea'), '海运')
  assert.equal(deliveryTypeLabel(undefined), '-')
})

test('DLR.4 验收类型与结论文案/色调', () => {
  assert.equal(acceptanceTypeLabel('fat'), '厂内验收 (FAT)')
  assert.equal(acceptanceTypeLabel('sat'), '现场验收 (SAT)')
  assert.equal(acceptanceTypeLabel('final'), '终验')
  assert.equal(acceptanceResultLabel('passed'), '通过')
  assert.equal(acceptanceResultLabel('conditional'), '让步接收')
  assert.equal(acceptanceResultLabel('rejected'), '不通过')
  assert.equal(acceptanceResultTone('passed'), 'success')
  assert.equal(acceptanceResultTone('conditional'), 'warning')
  assert.equal(acceptanceResultTone('pending'), 'info')
})

test('DLR.5 签署摘要：带职务/不带职务/未签署', () => {
  assert.equal(signSummary({ signer_name: '张工', signer_title: '客户代表', signed_at: '2026-12-06 10:30:00' }), '张工（客户代表） @ 2026-12-06 10:30')
  assert.equal(signSummary({ signer_name: '张工', signed_at: '2026-12-06 10:30:00' }), '张工 @ 2026-12-06 10:30')
  assert.equal(signSummary({}), '—')
  assert.equal(signSummary(undefined as any), '—')
})
