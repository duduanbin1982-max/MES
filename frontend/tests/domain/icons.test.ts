import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { appIcons } from '../../src/icons.ts'
import * as ICONS from '@element-plus/icons-vue'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(__dirname, '../../src')
const iconNames = new Set(Object.keys(ICONS).filter((name) => /^[A-Z]/.test(name)))

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
}

test('ICON.1 模板/路由使用的 Element 图标均已注册（避免局部引入后图标缺失）', () => {
  const used = new Set<string>()
  for (const file of walk(SRC)) {
    if (!/\.(vue|ts|js)$/.test(file)) continue
    const source = fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(/<([A-Z][A-Za-z0-9]+)[\s/>]/g)) {
      if (iconNames.has(match[1])) used.add(match[1])
    }
    for (const match of source.matchAll(/icon\s*:\s*['"]([A-Z][A-Za-z0-9]+)['"]/g)) {
      if (iconNames.has(match[1])) used.add(match[1])
    }
  }
  const missing = [...used].filter((name) => !(name in appIcons))
  assert.deepEqual(missing, [], '缺少图标注册: ' + missing.join(','))
  assert.ok(Object.keys(appIcons).length > 0)
  assert.ok(Object.keys(appIcons).length < iconNames.size, '应比全量图标少（按需注册）')
})

test('ICON.2 注册表规模合理（不超过全量 60%）', () => {
  const count = Object.keys(appIcons).length
  assert.ok(count / iconNames.size <= 0.6, `注册 ${count}/${iconNames.size} 超过 60%`)
})
