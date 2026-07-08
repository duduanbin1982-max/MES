import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useMindmapChart } from './useMindmapChart'

function authHeader() {
  return { Authorization: 'Bearer ' + (localStorage.getItem('tbm_access_token') || localStorage.getItem('tbm_token') || '') }
}

export function useProcessTreeMindmap(props, emit) {
  const expanded = ref(true)
  const tree = ref(null)
  const breadcrumb = ref([])
  const loading = ref(false)
  const error = ref(null)
  const chartEl = ref(null)
  const currentPartId = ref(props.initialPartId || 'root')
  const { renderChart, disposeChart, onResize } = useMindmapChart(chartEl, tree)

  const hint = computed(() => {
    if (!tree.value) return '点击展开工艺树思维导图'
    const current = tree.value.current
    return `${current.name} · L${current.level} · ${current.child_count} 子项 · ${current.progress_pct}%`
  })

  const levelIcon = (level) => {
    if (level === 1) return '🏭'
    if (level === 2) return '⚙️'
    if (level === 3) return '🔧'
    if (level === 4) return '📋'
    return '•'
  }

  const kindIcon = (kind) => {
    if (kind === 'root') return '🏭'
    if (kind === 'subsystem') return '⚙️'
    if (kind === 'part') return '🔧'
    if (kind === 'operation') return '📋'
    return '•'
  }

  const kindLabel = (kind) => ({ root: '总装', subsystem: '子系统', part: '零件', operation: '工序', edge: '依赖' }[kind] || kind)

  const levelTitle = (level) => {
    if (level === 1) return '总装层'
    if (level === 2) return '子系统层'
    if (level === 3) return '零件层'
    if (level === 4) return '工序层'
    return '其他'
  }

  const statusLabel = (status) => ({ pending: '待开始', ready: '就绪', in_progress: '进行中', completed: '已完成', blocked: '阻塞' }[status] || status)

  const progressClass = (item) => {
    if (item.progress_pct >= 100) return 'mindmap-child-tag-done'
    if (item.progress_pct > 0) return 'mindmap-child-tag-doing'
    return 'mindmap-child-tag-pending'
  }

  async function loadCurrent(scrollToChart = false) {
    loading.value = true
    error.value = null
    try {
      const [treeRes, crumbRes] = await Promise.all([
        fetch(`/api/equipment_instances/${props.instanceId}/parts_tree?part_id=${currentPartId.value}`, { headers: authHeader() }),
        fetch(`/api/equipment_instances/${props.instanceId}/parts_tree/path?part_id=${currentPartId.value}`, { headers: authHeader() }),
      ])
      if (!treeRes.ok) {
        const errBody = await treeRes.json().catch(() => ({}))
        throw new Error(errBody.error || `HTTP ${treeRes.status}`)
      }
      if (!crumbRes.ok) {
        const errBody = await crumbRes.json().catch(() => ({}))
        throw new Error(errBody.error || `HTTP ${crumbRes.status}`)
      }
      tree.value = await treeRes.json()
      breadcrumb.value = (await crumbRes.json()).breadcrumb || []

      await nextTick()
      try {
        renderChart(onChildClick)
      } catch (chartError) {
        console.error('[mindmap] renderChart failed:', chartError)
      }
      if (scrollToChart && chartEl.value) {
        chartEl.value.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    } catch (loadError) {
      error.value = loadError.message || String(loadError)
      tree.value = null
      console.error('mindmap load error', loadError)
    } finally {
      loading.value = false
    }
  }

  function onChildClick(child) {
    if (String(child.part_id).startsWith('edge_')) return
    disposeChart()
    currentPartId.value = child.part_id
    loadCurrent()
    emit('navigate', { part_id: child.part_id, name: child.name })
  }

  function onCrumbClick(partId) {
    currentPartId.value = partId
    loadCurrent()
  }

  function onCenterClick() {
    if (currentPartId.value !== 'root') {
      currentPartId.value = 'root'
      loadCurrent()
    }
  }

  watch(
    () => props.instanceId,
    () => {
      disposeChart()
      tree.value = null
      breadcrumb.value = []
      currentPartId.value = 'root'
      if (expanded.value) loadCurrent()
    },
  )

  watch(expanded, (value) => {
    if (value && !tree.value && !loading.value) loadCurrent()
    else if (value && tree.value) nextTick(() => renderChart(onChildClick))
  })

  onMounted(() => {
    window.addEventListener('resize', onResize)
    if (expanded.value) loadCurrent()
  })

  onBeforeUnmount(() => {
    window.removeEventListener('resize', onResize)
    disposeChart()
  })

  return {
    expanded,
    tree,
    breadcrumb,
    loading,
    error,
    chartEl,
    hint,
    levelIcon,
    kindIcon,
    kindLabel,
    levelTitle,
    statusLabel,
    progressClass,
    loadCurrent,
    onChildClick,
    onCrumbClick,
    onCenterClick,
  }
}
