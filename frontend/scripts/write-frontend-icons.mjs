// frontend/scripts/write-frontend-icons.mjs
// 2026-11-07 UI/UX P3：按实际使用裁剪 Element Plus 图标注册（减少 vendor 体积）
// 用法：node scripts/write-frontend-icons.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ICONS from '@element-plus/icons-vue'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src')

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules') return []
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
}

const used = new Set()
const iconNames = new Set(Object.keys(ICONS).filter((name) => /^[A-Z]/.test(name)))
for (const file of walk(SRC)) {
  if (!/\.(vue|ts|js)$/.test(file)) continue
  const source = fs.readFileSync(file, 'utf8')
  for (const match of source.matchAll(/<([A-Z][A-Za-z0-9]+)[\s/>]/g)) {
    if (iconNames.has(match[1])) used.add(match[1])
  }
  for (const match of source.matchAll(/icon\s*:\s*['"]([A-Z][A-Za-z0-9]+)['"]/g)) {
    if (iconNames.has(match[1])) used.add(match[1])
  }
  for (const match of source.matchAll(/(?:is|icon)\s*:\s*['"]([A-Z][A-Za-z0-9]+)['"]/g)) {
    if (iconNames.has(match[1])) used.add(match[1])
  }
}

const sorted = [...used].sort()
const lines = [
  '// 此文件由 frontend/scripts/write-frontend-icons.mjs 自动生成，请勿手改',
  'import {',
  ...sorted.map((name) => `  ${name},`),
  "} from '@element-plus/icons-vue'",
  '',
  'export const appIcons = {',
  ...sorted.map((name) => `  ${name},`),
  '}',
  '',
]
fs.writeFileSync(path.join(SRC, 'icons.ts'), lines.join('\n'))
console.log(`[frontend-icons] 已生成 src/icons.ts，注册 ${sorted.length}/${iconNames.size} 个图标`)
