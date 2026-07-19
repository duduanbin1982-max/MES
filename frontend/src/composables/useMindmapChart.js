// composables/useMindmapChart.js
// ECharts 思维导图图表逻辑 — 从 ProcessTreeMindmap.vue 拆分 (brooks-debt R1)
import * as echarts from 'echarts'

export function useMindmapChart(chartEl, tree) {
  let chartInstance = null

  function cssToken(name, fallback) {
    if (!chartEl.value || typeof window === 'undefined') return fallback
    return getComputedStyle(chartEl.value).getPropertyValue(name).trim() || fallback
  }

  function kindTone(kind) {
    const tones = {
      root: { fill: '#eef2ff', border: '#64748b' },
      subsystem: { fill: '#eff6ff', border: '#60a5fa' },
      part: { fill: '#f0fdf4', border: '#86efac' },
      operation: { fill: '#fffbeb', border: '#fbbf24' },
      edge: { fill: '#f8fafc', border: '#cbd5e1' },
    }
    return tones[kind] || tones.edge
  }

  function kindColor(kind) {
    return kindTone(kind).border
  }

  function kindSize(kind) {
    if (kind === 'root') return [320, 88]
    if (kind === 'subsystem') return [300, 76]
    if (kind === 'part') return [300, 72]
    if (kind === 'operation') return [300, 70]
    return [260, 64]
  }

  function kindLabel(kind) {
    return { root: '总装', subsystem: '子系统', part: '部件/零件', operation: '工序', edge: '依赖' }[kind] || kind || '节点'
  }

  function statusLabel(s) {
    const map = { pending: '待开始', ready: '就绪', in_progress: '进行中', completed: '已完成', blocked: '已阻塞', skipped: '已跳过' }
    return map[s] || s || '未知'
  }

  function truncate(value, max = 18) {
    const text = String(value || '')
    if (text.length <= max) return text
    return `${text.slice(0, max - 1)}…`
  }

  function richSafe(value) {
    return String(value || '').replace(/[{}\\]/g, '')
  }

  function progressText(item) {
    if (item.progress_pct === undefined || item.progress_pct === null) return '进度未录入'
    return `进度 ${item.progress_pct}%`
  }

  function detailText(item) {
    const details = []
    if (item.child_count !== undefined) details.push(`${item.child_count} 子项`)
    if (item.op_count !== undefined) details.push(`${item.op_count} 工序`)
    if (item.estimated_hours !== undefined && item.estimated_hours !== null) details.push(`${item.estimated_hours}h`)
    return details.join(' · ') || '点击进入下层'
  }

  function formatNodeLabel(params) {
    const item = params.data.raw || params.data
    const name = richSafe(truncate(item.name || params.name, item.kind === 'root' ? 20 : 18))
    const meta = richSafe(`${kindLabel(item.kind)} · L${item.level ?? '-'} · ${statusLabel(item.status)}`)
    const detail = richSafe(`${progressText(item)} · ${detailText(item)}`)
    return `{name|${name}}\n{meta|${meta}}\n{detail|${detail}}`
  }

  function buildTreeNode(item, isRoot = false) {
    const tone = kindTone(item.kind)
    return {
      id: item.part_id,
      name: item.name,
      raw: item,
      symbol: 'roundRect',
      symbolSize: kindSize(item.kind),
      itemStyle: {
        color: tone.fill,
        borderColor: isRoot ? cssToken('--color-primary', tone.border) : tone.border,
        borderWidth: isRoot ? 2 : 1.5,
        shadowColor: 'rgba(15, 23, 42, 0.08)',
        shadowBlur: isRoot ? 14 : 8,
        shadowOffsetY: 3,
      },
      label: {
        show: true,
        position: 'inside',
        align: 'center',
        verticalAlign: 'middle',
        formatter: formatNodeLabel,
        lineHeight: 18,
        rich: {
          name: {
            color: cssToken('--color-text', '#334155'),
            fontSize: isRoot ? 14 : 13,
            fontWeight: 700,
            lineHeight: 20,
          },
          meta: {
            color: cssToken('--color-text-secondary', '#64748b'),
            fontSize: 11,
            fontWeight: 500,
            lineHeight: 17,
          },
          detail: {
            color: cssToken('--color-text-secondary', '#64748b'),
            fontSize: 11,
            lineHeight: 17,
          },
        },
      },
      children: [],
      collapsed: false,
    }
  }

  function resolveNodeItem(params) {
    const rawData = params?.data?.raw || params?.data
    if (rawData?.part_id) return rawData
    if (Array.isArray(params?.treePathInfo)) {
      const rawPathItem = [...params.treePathInfo].reverse().find((item) => item?.data?.raw?.part_id || item?.data?.part_id)
      return rawPathItem?.data?.raw || rawPathItem?.data || null
    }
    return null
  }

  function buildChartOption() {
    if (!tree.value) return {}

    const current = tree.value.current
    const childNodes = (tree.value.children || []).filter((child) => child.kind !== 'edge')
    const rootNode = buildTreeNode(current, true)
    rootNode.children = childNodes.map((child) => buildTreeNode(child, false))

    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 900
    const minHeight = Math.max(560, Math.min(820, viewportHeight - 340))
    const chartHeight = Math.max(minHeight, childNodes.length * 92 + 160)
    if (chartEl.value) chartEl.value.style.height = `${chartHeight}px`

    const textColor = cssToken('--color-text', '#334155')
    const mutedColor = cssToken('--color-text-secondary', '#64748b')
    const borderColor = cssToken('--color-border', '#d8dee8')
    const chartWidth = chartEl.value?.clientWidth || 1280
    const compactTreeWidth = Math.max(420, Math.round((chartWidth - 76) / 2))
    const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    return {
      backgroundColor: 'transparent',
      aria: {
        enabled: true,
        label: {
          description: `工艺树思维导图，当前层级 ${current.name}，包含 ${childNodes.length} 个下层节点。`,
        },
      },
      tooltip: {
        borderWidth: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.92)',
        textStyle: { color: '#fff', fontSize: 12 },
        extraCssText: 'border-radius:10px;box-shadow:0 12px 30px rgba(15,23,42,0.18);',
        formatter: (params) => {
          const item = resolveNodeItem(params)
          if (!item) return params.name || ''
          const rows = [
            `<b>${item.name || params.name}</b>`,
            `类型: ${kindLabel(item.kind)} · L${item.level ?? '-'}`,
            `状态: ${statusLabel(item.status)}`,
            item.progress_pct !== undefined ? `进度: ${item.progress_pct}%` : '',
            item.child_count !== undefined ? `下层: ${item.child_count} 子项` : '',
            item.op_count !== undefined ? `工序: ${item.op_count} 道` : '',
            item.estimated_hours !== undefined && item.estimated_hours !== null ? `工时: ${item.estimated_hours} h` : '',
            '<span style="color:#cbd5e1">点击节点进入下层</span>',
          ].filter(Boolean)
          return rows.join('<br/>')
        },
      },
      series: [{
        type: 'tree',
        data: [rootNode],
        left: 34,
        width: compactTreeWidth,
        top: 44,
        bottom: 44,
        orient: 'LR',
        layout: 'orthogonal',
        edgeShape: 'polyline',
        edgeForkPosition: '50%',
        expandAndCollapse: false,
        initialTreeDepth: -1,
        roam: true,
        animationDuration: prefersReducedMotion ? 0 : 260,
        animationDurationUpdate: prefersReducedMotion ? 0 : 260,
        lineStyle: {
          color: borderColor,
          width: 1.6,
          curveness: 0,
        },
        emphasis: {
          focus: 'descendant',
          lineStyle: {
            color: cssToken('--color-primary', '#64748b'),
            width: 2.2,
          },
          itemStyle: {
            shadowBlur: 18,
            shadowColor: 'rgba(100, 116, 139, 0.18)',
          },
        },
        blur: {
          itemStyle: { opacity: 0.72 },
          lineStyle: { opacity: 0.45 },
          label: { opacity: 0.72 },
        },
        label: {
          color: textColor,
          overflow: 'truncate',
        },
        leaves: {
          label: {
            position: 'inside',
            align: 'center',
            verticalAlign: 'middle',
            color: textColor,
          },
        },
      }],
      graphic: [
        {
          type: 'text',
          right: 14,
          top: 12,
          silent: true,
          style: {
            text: '拖动画布 / 滚轮缩放 / 点击节点下钻 / 可一键适配',
            fill: mutedColor,
            font: '12px sans-serif',
          },
        },
      ],
    }
  }

  function renderChart(onChildClick) {
    if (!chartEl.value) return
    if (!chartInstance) {
      try {
        chartInstance = echarts.init(chartEl.value, null, { renderer: 'canvas' })
      } catch (e) {
        console.error('[mindmap] echarts.init failed:', e)
        return
      }
      chartInstance.on('click', (params) => {
        const item = resolveNodeItem(params)
        if (!item?.part_id || String(item.part_id) === String(tree.value?.current?.part_id)) return
        const child = (tree.value?.children || []).find((candidate) => String(candidate.part_id) === String(item.part_id))
        if (child && onChildClick) onChildClick(child)
      })
    }
    const opt = buildChartOption()
    if (opt && opt.series) {
      chartInstance.setOption(opt, true)
      chartInstance.resize()
    }
  }

  function fitChartView() {
    if (!chartInstance) return
    const opt = buildChartOption()
    if (opt && opt.series) {
      chartInstance.setOption(opt, true)
      chartInstance.resize()
    }
  }

  function disposeChart() {
    if (chartInstance) {
      chartInstance.dispose()
      chartInstance = null
    }
  }

  function onResize() {
    if (chartInstance) chartInstance.resize()
  }

  return { buildChartOption, renderChart, disposeChart, fitChartView, kindColor, kindSize, onResize }
}
