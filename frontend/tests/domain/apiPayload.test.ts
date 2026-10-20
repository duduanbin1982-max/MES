// frontend/tests/domain/apiPayload.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { asArray } from '../../src/domain/apiPayload.ts'

test('API.1 直接返回数组', () => {
  assert.deepEqual(asArray([{ id: 1 }]), [{ id: 1 }])
})

test('API.2 { items } / { data } / { rows } 都能取到', () => {
  assert.deepEqual(asArray({ items: [1, 2] }), [1, 2])
  assert.deepEqual(asArray({ data: [3] }), [3])
  assert.deepEqual(asArray({ rows: [4] }), [4])
})

test('API.3 非数组/空值返回空数组，不抛错', () => {
  assert.deepEqual(asArray(null), [])
  assert.deepEqual(asArray(undefined), [])
  assert.deepEqual(asArray('x'), [])
  assert.deepEqual(asArray({}), [])
  assert.deepEqual(asArray({ items: null }), [])
})
