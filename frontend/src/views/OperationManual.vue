<template>
  <div class="manual-page">
    <section class="manual-hero">
      <div>
        <div class="eyebrow">HELP CENTER</div>
        <h1>操作手册</h1>
        <p>把 TBM-MES 的业务主线、角色操作、异常闭环和最短跑通路径集中到一个现场可查页面。</p>
      </div>
      <div class="hero-actions">
        <el-button :icon="Refresh" :loading="loading" @click="loadManual">刷新</el-button>
        <el-button type="primary" :icon="Download" @click="downloadMarkdown">下载 Markdown</el-button>
      </div>
    </section>

    <el-alert
      v-if="error"
      :title="error"
      type="error"
      show-icon
      class="manual-alert"
    />

    <div v-loading="loading" class="manual-layout">
      <aside class="manual-toc">
        <div class="toc-title">目录</div>
        <button
          v-for="item in toc"
          :key="item.id"
          class="toc-item"
          :class="`toc-level-${item.level}`"
          @click="jumpTo(item.id)"
        >
          {{ item.text }}
        </button>
      </aside>

      <main class="manual-card">
        <div class="manual-meta">
          <span>{{ title }}</span>
          <span>更新：{{ updatedAt || '-' }}</span>
        </div>
        <article class="manual-content" v-html="html"></article>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Download, Refresh } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { Api } from '../api'

type TocItem = { id: string; text: string; level: number }

const loading = ref(false)
const error = ref('')
const title = ref('TBM-MES 操作手册')
const updatedAt = ref('')
const markdown = ref('')

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

const slugify = (text: string) => encodeURIComponent(text.trim().replace(/\s+/g, '-'))
const inline = (value: string) => escapeHtml(value)
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/`([^`]+)`/g, '<code>$1</code>')

const isTableSeparator = (line: string) => /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(line)
const splitTableRow = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())

const renderTable = (rows: string[]) => {
  const header = splitTableRow(rows[0])
  const bodyRows = rows.slice(2).map(splitTableRow)
  const headHtml = header.map((cell) => `<th>${inline(cell)}</th>`).join('')
  const bodyHtml = bodyRows
    .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`)
    .join('')
  return `<div class="table-wrap"><table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`
}

const renderMarkdown = (source: string) => {
  const lines = source.split(/\r?\n/)
  const out: string[] = []
  let index = 0
  let inUl = false
  let inOl = false
  let inCode = false
  let codeLines: string[] = []

  const closeLists = () => {
    if (inUl) out.push('</ul>')
    if (inOl) out.push('</ol>')
    inUl = false
    inOl = false
  }

  while (index < lines.length) {
    const line = lines[index]

    if (line.trim().startsWith('```')) {
      if (!inCode) {
        closeLists()
        inCode = true
        codeLines = []
      } else {
        out.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
        inCode = false
      }
      index += 1
      continue
    }

    if (inCode) {
      codeLines.push(line)
      index += 1
      continue
    }

    if (!line.trim()) {
      closeLists()
      index += 1
      continue
    }

    if (line.includes('|') && lines[index + 1] && isTableSeparator(lines[index + 1])) {
      closeLists()
      const tableRows = [line, lines[index + 1]]
      index += 2
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        tableRows.push(lines[index])
        index += 1
      }
      out.push(renderTable(tableRows))
      continue
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      closeLists()
      const level = heading[1].length
      const text = heading[2].trim()
      const id = slugify(text)
      out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`)
      index += 1
      continue
    }

    const ul = line.match(/^\s*[-*]\s+(.+)$/)
    if (ul) {
      if (!inUl) {
        closeLists()
        out.push('<ul>')
        inUl = true
      }
      out.push(`<li>${inline(ul[1])}</li>`)
      index += 1
      continue
    }

    const ol = line.match(/^\s*\d+\.\s+(.+)$/)
    if (ol) {
      if (!inOl) {
        closeLists()
        out.push('<ol>')
        inOl = true
      }
      out.push(`<li>${inline(ol[1])}</li>`)
      index += 1
      continue
    }

    closeLists()
    if (line.trim().startsWith('>')) out.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`)
    else out.push(`<p>${inline(line)}</p>`)
    index += 1
  }

  closeLists()
  return out.join('\n')
}

const toc = computed<TocItem[]>(() => markdown.value
  .split(/\r?\n/)
  .map((line) => line.match(/^(#{1,3})\s+(.+)$/))
  .filter(Boolean)
  .map((match: any) => ({
    level: match[1].length,
    text: match[2].trim(),
    id: slugify(match[2].trim()),
  }))
  .filter((item) => item.level <= 3))

const html = computed(() => renderMarkdown(markdown.value))

const loadManual = async () => {
  loading.value = true
  error.value = ''
  try {
    const data = await Api.get('/help/manual')
    title.value = data.title || 'TBM-MES 操作手册'
    updatedAt.value = data.updated_at ? new Date(data.updated_at).toLocaleString('zh-CN') : ''
    markdown.value = data.markdown || ''
  } catch (err: any) {
    error.value = err?.message || '操作手册加载失败'
  } finally {
    loading.value = false
  }
}

const jumpTo = (id: string) => {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const downloadMarkdown = () => {
  const blob = new Blob([markdown.value], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'TBM-MES-业务操作手册.md'
  link.click()
  URL.revokeObjectURL(url)
  ElMessage.success('已下载操作手册')
}

onMounted(loadManual)
</script>

<style scoped>
.manual-page {
  min-height: 100%;
  padding: 20px;
  background:
    radial-gradient(circle at top left, rgba(37, 99, 235, 0.12), transparent 32%),
    linear-gradient(135deg, var(--color-background) 0%, #eff6ff 52%, var(--color-background) 100%);
}

.manual-hero {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  align-items: center;
  margin-bottom: 16px;
  padding: 24px;
  border-radius: 22px;
  color: white;
  background: linear-gradient(120deg, var(--color-bg-darker), #1e40af);
  box-shadow: 0 18px 45px rgba(30, 64, 175, 0.16);
}

.eyebrow {
  color: #bfdbfe;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.manual-hero h1 {
  margin: 8px 0;
  font-size: 34px;
  line-height: 1;
  letter-spacing: -0.04em;
}

.manual-hero p {
  max-width: 760px;
  margin: 0;
  color: var(--color-info-bg);
  line-height: 1.7;
}

.hero-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.manual-alert {
  margin-bottom: 16px;
}

.manual-layout {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.manual-toc {
  position: sticky;
  top: 16px;
  max-height: calc(100vh - 96px);
  overflow: auto;
  padding: 14px;
  border: 1px solid var(--color-info-bg);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 10px 26px rgba(15, 23, 42, 0.06);
}

.toc-title {
  margin-bottom: 10px;
  color: var(--color-bg-darker);
  font-weight: 900;
}

.toc-item {
  display: block;
  width: 100%;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  padding: 7px 8px;
  text-align: left;
  line-height: 1.45;
  transition: background 160ms ease, color 160ms ease;
}

.toc-item:hover,
.toc-item:focus {
  outline: none;
  background: #eff6ff;
  color: #1d4ed8;
}

.toc-level-1 {
  font-weight: 900;
}

.toc-level-2 {
  padding-left: 16px;
  font-size: 13px;
}

.toc-level-3 {
  padding-left: 28px;
  color: var(--color-primary);
  font-size: 12px;
}

.manual-card {
  border: 1px solid var(--color-info-bg);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 10px 26px rgba(15, 23, 42, 0.06);
}

.manual-meta {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  font-size: 13px;
}

.manual-content {
  padding: 12px 24px 32px;
  color: var(--color-bg-darker);
  line-height: 1.78;
}

.manual-content :deep(h1),
.manual-content :deep(h2),
.manual-content :deep(h3),
.manual-content :deep(h4) {
  scroll-margin-top: 18px;
  color: var(--color-bg-darker);
  letter-spacing: -0.02em;
}

.manual-content :deep(h1) {
  font-size: 30px;
  border-bottom: 1px solid var(--color-info-bg);
  padding-bottom: 12px;
}

.manual-content :deep(h2) {
  margin-top: 28px;
  font-size: 22px;
}

.manual-content :deep(h3) {
  margin-top: 22px;
  font-size: 18px;
}

.manual-content :deep(p),
.manual-content :deep(li) {
  color: var(--color-text);
}

.manual-content :deep(code) {
  border-radius: 6px;
  background: #eff6ff;
  color: #1d4ed8;
  padding: 2px 6px;
  font-family: Consolas, Monaco, monospace;
}

.manual-content :deep(pre) {
  overflow: auto;
  border-radius: 14px;
  background: var(--color-bg-darker);
  color: var(--color-border);
  padding: 14px;
}

.manual-content :deep(pre code) {
  background: transparent;
  color: inherit;
  padding: 0;
}

.manual-content :deep(blockquote) {
  margin: 12px 0;
  border-left: 4px solid var(--color-cta);
  background: var(--el-color-white)7ed;
  color: #9a3412;
  padding: 10px 12px;
}

.manual-content :deep(.table-wrap) {
  overflow-x: auto;
  margin: 14px 0;
  border: 1px solid var(--color-border);
  border-radius: 14px;
}

.manual-content :deep(table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.manual-content :deep(th) {
  background: #eff6ff;
  color: #1e40af;
  font-weight: 900;
}

.manual-content :deep(th),
.manual-content :deep(td) {
  border-bottom: 1px solid var(--color-border);
  padding: 9px 10px;
  text-align: left;
  vertical-align: top;
}

@media (max-width: 1024px) {
  .manual-layout {
    grid-template-columns: 1fr;
  }

  .manual-toc {
    position: static;
    max-height: 320px;
  }
}

@media (max-width: 720px) {
  .manual-page {
    padding: 12px;
  }

  .manual-hero {
    align-items: flex-start;
    flex-direction: column;
  }

  .manual-meta {
    flex-direction: column;
  }
}

@media (prefers-reduced-motion: reduce) {
  .toc-item {
    transition: none;
  }
}
</style>
