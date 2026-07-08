// composables/useMindmapChart.js
// ECharts 思维导图图表逻辑 — 从 ProcessTreeMindmap.vue 拆分 (brooks-debt R1)
import * as echarts from 'echarts'

export function useMindmapChart(chartEl, tree) {
  let chartInstance = null

  function kindColor(kind) {
    return {
      root: '#f56c6c',
      subsystem: '#409eff',
      part: '#67c23a',
      operation: '#e6a23c',
      edge: '#909399',
    }[kind] || '#909399'
  }

  function kindSize(kind) {
    return { root: 80, subsystem: 50, part: 38, operation: 30, edge: 12 }[kind] || 30
  }

  function statusLabel(s) {
    const map = { pending: '待开始', in_progress: '进行中', completed: '已完成', blocked: '已阻塞', skipped: '已跳过' }
    return map[s] || s || '未知'
  }

  function buildChartOption() {
    if (!tree.value) return {}

    const c = tree.value.current
    const centerColor = kindColor(c.kind)
    const centerNode = {
      id: c.part_id,
      name: c.name,
      symbolSize: kindSize(c.kind),
      itemStyle: { color: centerColor, borderColor: '#fff', borderWidth: 2 },
      label: { show: true, fontSize: 14, fontWeight: 600, color: '#fff', position: 'right' },
      category: 0,
    }

    const childNodes = (tree.value.children || []).filter((ch) => ch.kind !== 'edge')
    const chartH = 420
    const centerX = 100
    const childX = 360
    const n = childNodes.length
    const vGap = n > 0 ? Math.min(60, Math.max(36, (chartH - 60) / Math.max(n, 1))) : 60
    const totalH = n * vGap
    const startY = (chartH - totalH) / 2

    const children = childNodes.map((child, i) => ({
      id: child.part_id,
      name: child.name,
      symbolSize: kindSize(child.kind),
      x: childX,
      y: startY + vGap * (i + 0.5),
      fixed: true,
      itemStyle: { color: kindColor(child.kind), borderColor: '#fff', borderWidth: 1 },
      label: {
        show: true,
        fontSize: child.kind === 'subsystem' ? 12 : 11,
        color: '#303133',
        position: child.kind === 'subsystem' ? 'right' : 'left',
        backgroundColor: 'rgba(255,255,255,0.85)',
        padding: [2, 4],
        borderRadius: 2,
      },
      category: 1,
      progress_pct: child.progress_pct,
      status: child.status,
      value: child,
    }))

    const centerNodeWithPos = { ...centerNode, x: centerX, y: chartH / 2, fixed: true }

    const links = children.map((ch) => ({
      source: tree.value.current.part_id,
      target: ch.id,
      lineStyle: { color: '#b1b3b8', width: 1.5, curveness: 0 },
      symbol: ['none', 'arrow'],
      symbolSize: 8,
    }))

    return {
      tooltip: {
        formatter: (p) => {
          if (p.dataType === 'node') {
            const ch = p.data.value
            if (!ch) return `<b>${p.name}</b>`
            const extra = ch.progress_pct !== undefined ? `<br/>进度: ${ch.progress_pct}%` : ''
            const st = ch.status ? `<br/>状态: ${statusLabel(ch.status)}` : ''
            const op = ch.op_count !== undefined ? `<br/>工序: ${ch.op_count} 道` : ''
            const sub = ch.child_count !== undefined ? `<br/>下层: ${ch.child_count} 子项` : ''
            return `<b>${p.name}</b>${extra}${st}${op}${sub}<br/><span style="color:#909399">点击进入下层</span>`
          }
          return p.name
        },
      },
      legend: [{ data: ['当前层', '下层'], top: 0, textStyle: { fontSize: 11 } }],
      series: [{
        type: 'graph',
        layout: 'none',
        roam: false,
        draggable: false,
        categories: [
          { name: '当前层', itemStyle: { color: centerColor } },
          { name: '下层', itemStyle: { color: '#909399' } }
        ],
        data: [centerNodeWithPos, ...children],
        links,
        emphasis: { focus: 'adjacency', lineStyle: { width: 3 } },
        edgeSymbol: ['none', 'arrow'],
        edgeSymbolSize: 8,
      }],
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
        if (params.dataType !== 'node') return
        const id = params.data.id
        if (!id || id === tree.value?.current?.part_id) return
        const child = (tree.value?.children || []).find((c) => c.part_id === id)
        if (child && onChildClick) onChildClick(child)
      })
    }
    const opt = buildChartOption()
    if (opt && opt.series) {
      chartInstance.setOption(opt, true)
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

  return { buildChartOption, renderChart, disposeChart, kindColor, kindSize, onResize }
}
