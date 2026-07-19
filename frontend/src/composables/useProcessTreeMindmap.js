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
  const { renderChart, disposeChart, fitChartView, onResize } = useMindmapChart(chartEl, tree)

  const isRoot = computed(() => currentPartId.value === 'root' || tree.value?.current?.kind === 'root')
  const canGoParent = computed(() => breadcrumb.value.length > 1)

  const hint = computed(() => {
    if (!tree.value) return '点击展开工艺树思维导图'
    const current = tree.value.current
    return `${current.name} · L${current.level} · ${current.child_count} 子项 · ${current.progress_pct}%`
  })

  const levelIcon = (level) => {
    if (level === 1) return 'L1'
    if (level === 2) return 'L2'
    if (level === 3) return 'L3'
    if (level === 4) return 'L4'
    return 'L-'
  }

  const kindIcon = (kind) => {
    if (kind === 'root') return '总'
    if (kind === 'subsystem') return '系'
    if (kind === 'part') return '件'
    if (kind === 'operation') return '序'
    return '项'
  }

  const kindLabel = (kind) => ({ root: '总装', subsystem: '子系统', part: '部件/零件', operation: '工序', edge: '依赖' }[kind] || kind)

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

  function navigateTo(partId, payload = {}) {
    disposeChart()
    currentPartId.value = partId || 'root'
    loadCurrent(true)
    emit('navigate', payload)
  }

  function onChildClick(child) {
    if (String(child.part_id).startsWith('edge_')) return
    navigateTo(child.part_id, { part_id: child.part_id, name: child.name })
  }

  function onCrumbClick(partId) {
    if (!partId || partId === currentPartId.value) return
    const crumb = breadcrumb.value.find((item) => item.part_id === partId)
    navigateTo(partId, { part_id: partId, name: crumb?.name })
  }

  function goParent() {
    if (!canGoParent.value) return
    const parent = breadcrumb.value[breadcrumb.value.length - 2]
    if (!parent?.part_id) return
    navigateTo(parent.part_id, { part_id: parent.part_id, name: parent.name })
  }

  function goRoot() {
    if (isRoot.value) return
    navigateTo('root', { part_id: 'root', name: '总装' })
  }

  function resetChartView() {
    fitChartView()
  }

  function onCenterClick() {
    goRoot()
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
    isRoot,
    canGoParent,
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
    goParent,
    goRoot,
    resetChartView,
  }
}
