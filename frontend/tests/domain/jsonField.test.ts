// frontend/tests/domain/jsonField.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { formatJsonForInput, parseJsonInput } from '../../src/domain/jsonField.ts'

test('JSONF.1 formatJsonForInput：对象 → 缩进 JSON；空值 → 空串', () => {
  assert.equal(formatJsonForInput({ subsystem_ids: [1] }), '{\n  "subsystem_ids": [\n    1\n  ]\n}')
  assert.equal(formatJsonForInput(null), '')
  assert.equal(formatJsonForInput(undefined), '')
  assert.equal(formatJsonForInput(''), '')
  assert.equal(formatJsonForInput({}), '{}')
})

test('JSONF.2 formatJsonForInput：JSON 字符串 → 规范化缩进；非法字符串原样返回', () => {
  assert.equal(formatJsonForInput('{"a":1}'), '{\n  "a": 1\n}')
  assert.equal(formatJsonForInput('  '), '')
  assert.equal(formatJsonForInput('{bad'), '{bad')
})

test('JSONF.3 parseJsonInput：空文本 → undefined（不修改字段）', () => {
  assert.equal(parseJsonInput(''), undefined)
  assert.equal(parseJsonInput(null), undefined)
  assert.equal(parseJsonInput('   '), undefined)
})

test('JSONF.4 parseJsonInput：合法 JSON 解析；非法抛错并带 cause', () => {
  assert.deepEqual(parseJsonInput('{"subsystem_ids":[1]}', '范围配置'), { subsystem_ids: [1] })
  assert.throws(() => parseJsonInput('{bad', '范围配置'), /范围配置 不是合法 JSON/)
  try {
    parseJsonInput('{bad', '范围配置')
  } catch (error: any) {
    assert.ok(error.cause, '应带 cause 便于排查')
  }
})
