// frontend/tests/domain/download.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { parseContentDispositionFilename } from '../../src/domain/download.ts'

test('DLD.1 解析文件名：百分号编码的引号形式（后端当前写法）', () => {
  const header = 'attachment; filename="%E5%89%8D%E7%9B%BE%E9%92%A2%E6%9D%BF.png"'
  assert.equal(parseContentDispositionFilename(header), '前盾钢板.png')
})

test('DLD.2 解析文件名：RFC 5987 的 filename* 形式', () => {
  const header = "attachment; filename*=UTF-8''%E6%9C%BA%E6%9E%B6.pdf"
  assert.equal(parseContentDispositionFilename(header), '机架.pdf')
})

test('DLD.3 无 header / 非法编码 → 回退 fallback，不抛错', () => {
  assert.equal(parseContentDispositionFilename(null, 'doc-1'), 'doc-1')
  assert.equal(parseContentDispositionFilename('', 'doc-2'), 'doc-2')
  assert.equal(parseContentDispositionFilename('attachment; filename="%E4%B8"', 'doc-3'), '%E4%B8')
  assert.equal(parseContentDispositionFilename('attachment', 'doc-4'), 'doc-4')
})
