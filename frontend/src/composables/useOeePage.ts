import { ref, reactive, onMounted, onUnmounted, nextTick } from 'vue'
import * as echarts from 'echarts'
import { Api } from '../api'
import { ElMessage } from 'element-plus'

export function useOeePage() {

  const activeTab = ref('overview')

  const days = ref(30)
  const loading = ref(false)
  const summary = ref<any>({})
  const workstations = ref<any[]>([])
  const oeeNote = ref<string>('')
  const loadError = ref('')

  const utilColor = (p: number) => p >= 90 ? 'var(--el-color-danger)' : p >= 70 ? 'var(--el-color-warning)' : p >= 30 ? 'var(--el-color-success)' : 'var(--el-color-info)'
  const utilToneClass = (p: number) => p >= 90 ? 'text-danger' : p >= 70 ? 'text-warning' : p >= 30 ? 'text-success' : 'text-info'
  const binaryToneClass = (bad: boolean) => bad ? 'text-danger' : 'text-success'
  const shiftOeeToneClass = (value: number) => value >= 85 ? 'text-success' : value >= 60 ? 'text-warning' : 'text-danger'
  const utilStatus = (level: string) => ({ overload: 'exception', busy: 'warning', normal: 'success', idle: '' }[level] || '')
  const levelTag = (level: string) => ({ overload: 'danger', busy: 'warning', normal: 'success', idle: 'info' }[level] || 'info')
  const levelLabel = (level: string) => ({ overload: '过载', busy: '繁忙', normal: '正常', idle: '闲置' }[level] || level)

  const themeColor = (name: string, fallbackVar = '--color-primary') => {
    if (typeof window === 'undefined') return 'currentColor'
    const styles = getComputedStyle(document.documentElement)
    return styles.getPropertyValue(name).trim()
      || styles.getPropertyValue(fallbackVar).trim()
      || 'currentColor'
  }

  const chartTones = () => ({
    blue: themeColor('--chart-blue'),
    green: themeColor('--chart-green', '--color-success'),
    amber: themeColor('--chart-amber', '--color-warning'),
    red: themeColor('--chart-red', '--color-danger'),
  })

  const load = async () => {
    loading.value = true
    loadError.value = ''
    try {
      const data = await Api.oee({ days: days.value })
      summary.value = data.summary || {}
      workstations.value = data.workstations || []
      oeeNote.value = data.note || ''
    } catch (error: any) {
      summary.value = {}
      workstations.value = []
      loadError.value = error?.message || 'OEE 接口暂时不可用，请稍后重试。'
    } finally { loading.value = false }
  }

  const instances = ref<any[]>([])
  const loadInstances = async () => {
    try {
      instances.value = await Api.instances()
    } catch (error: any) {
      instances.value = []
      ElMessage.error(error?.message || '装备实例加载失败')
    }
  }

  const lossCategories = [
    { value: 'equipment_failure', label: '设备故障' },
    { value: 'setup_adjustment', label: '换型调整' },
    { value: 'idling_minor_stops', label: '空转短暂停机' },
    { value: 'reduced_speed', label: '速度降低' },
    { value: 'startup_defects', label: '启动次品' },
    { value: 'production_defects', label: '运行次品' }
  ]
  const lossCategoryLabel = (v: string) => lossCategories.find(c => c.value === v)?.label || v
  const lossCategoryTag = (v: string): any => {
    const m: any = { equipment_failure: 'danger', setup_adjustment: 'warning', idling_minor_stops: 'info', reduced_speed: '', startup_defects: 'danger', production_defects: 'warning' }
    return m[v] || 'info'
  }

  const lossFilter = reactive({ instance_id: null as number | null, dateRange: null as string[] | null })
  const lossRecords = ref<any[]>([])
  const lossLoading = ref(false)
  const showLossDialog = ref(false)
  const lossSaving = ref(false)
  const lossForm = reactive({ instance_id: null as number | null, loss_category: 'equipment_failure', start_time: '', end_time: '', duration_minutes: 0, description: '' })

  const lossPieRef = ref<HTMLDivElement>()
  const lossBarRef = ref<HTMLDivElement>()
  let lossPieChart: echarts.ECharts | null = null
  let lossBarChart: echarts.ECharts | null = null

  const calcLossDuration = () => {
    if (lossForm.start_time && lossForm.end_time) {
      const diff = (new Date(lossForm.end_time).getTime() - new Date(lossForm.start_time).getTime()) / 60000
      lossForm.duration_minutes = Math.max(0, Math.round(diff * 10) / 10)
    }
  }

  const resetLossForm = () => {
    Object.assign(lossForm, { instance_id: null, loss_category: 'equipment_failure', start_time: '', end_time: '', duration_minutes: 0, description: '' })
  }

  const saveLossRecord = async () => {
    if (!lossForm.instance_id || !lossForm.loss_category || !lossForm.start_time || !lossForm.end_time) {
      return ElMessage.warning('请完整填写损失记录')
    }
    lossSaving.value = true
    try {
      await Api.post('/oee/loss-events', { ...lossForm })
      ElMessage.success('损失记录已保存')
      showLossDialog.value = false
      loadLossAnalysis()
    } catch (_) { ElMessage.error('保存失败') }
    finally { lossSaving.value = false }
  }

  const loadLossAnalysis = async () => {
    if (!lossFilter.instance_id) { lossRecords.value = []; return }
    lossLoading.value = true
    try {
      const params: any = { instance_id: lossFilter.instance_id }
      if (lossFilter.dateRange) { params.start_date = lossFilter.dateRange[0]; params.end_date = lossFilter.dateRange[1] }
      lossRecords.value = await Api.get('/oee/loss-events', { params }) || []
      await nextTick()
      renderLossCharts()
    } catch (_) { lossRecords.value = [] }
    finally { lossLoading.value = false }
  }

  const renderLossCharts = async () => {
    await nextTick()
    if (lossPieRef.value) {
      if (!lossPieChart) lossPieChart = echarts.init(lossPieRef.value)
      const catMap: Record<string, number> = {}
      lossRecords.value.forEach(r => { catMap[r.loss_category] = (catMap[r.loss_category] || 0) + (r.duration_minutes || 0) })
      lossPieChart.setOption({
        title: { text: '损失分类分布', left: 'center', textStyle: { fontSize: 14 } },
        tooltip: { trigger: 'item', formatter: '{b}: {c} 分钟 ({d}%)' },
        series: [{
          type: 'pie', radius: ['40%', '70%'],
          data: Object.entries(catMap).map(([k, v]) => ({ name: lossCategoryLabel(k), value: v })),
          label: { formatter: '{b}\n{d}%' }
        }]
      }, true)
    }

    if (lossBarRef.value) {
      if (!lossBarChart) lossBarChart = echarts.init(lossBarRef.value)
      try {
        const pareto = await Api.get('/oee/loss-pareto', { params: { instance_id: lossFilter.instance_id, days: 30 } })
        const cats = (pareto?.categories || []).map((c: any) => lossCategoryLabel(c.name || c.category || c))
        const vals = (pareto?.categories || []).map((c: any) => c.total_minutes || c.value || 0)
        lossBarChart.setOption({
          title: { text: '损失柏拉图 (30天)', left: 'center', textStyle: { fontSize: 14 } },
          tooltip: { trigger: 'axis' },
          xAxis: { type: 'category', data: cats, axisLabel: { rotate: 20, fontSize: 10 } },
          yAxis: { type: 'value', name: '分钟' },
          series: [{ type: 'bar', data: vals, itemStyle: { color: 'var(--el-color-danger)' } }]
        }, true)
      } catch (error: any) {
        ElMessage.warning(error?.message || '损失柏拉图加载失败')
      }
    }
  }

  const shiftFilter = reactive({ instance_id: null as number | null, dateRange: null as string[] | null })
  const shiftData = ref<any[]>([])
  const shiftLoading = ref(false)
  const shiftGroupRef = ref<HTMLDivElement>()
  const shiftStackRef = ref<HTMLDivElement>()
  let shiftGroupChart: echarts.ECharts | null = null
  let shiftStackChart: echarts.ECharts | null = null

  const loadShiftComparison = async () => {
    if (!shiftFilter.instance_id) { shiftData.value = []; return }
    shiftLoading.value = true
    try {
      const params: any = { instance_id: shiftFilter.instance_id }
      if (shiftFilter.dateRange) { params.start_date = shiftFilter.dateRange[0]; params.end_date = shiftFilter.dateRange[1] }
      shiftData.value = await Api.get('/oee/shift-comparison', { params }) || []
      await nextTick()
      renderShiftCharts()
    } catch (_) { shiftData.value = [] }
    finally { shiftLoading.value = false }
  }

  const renderShiftCharts = async () => {
    await nextTick()
    if (shiftGroupRef.value && shiftData.value.length) {
      if (!shiftGroupChart) shiftGroupChart = echarts.init(shiftGroupRef.value)
      const names = shiftData.value.map((s: any) => s.shift_name)
      const tones = chartTones()
      shiftGroupChart.setOption({
        title: { text: '班组 OEE 对比', left: 'center', textStyle: { fontSize: 14 } },
        tooltip: { trigger: 'axis' },
        legend: { data: ['可用性', '性能', '质量'], bottom: 0 },
        xAxis: { type: 'category', data: names },
        yAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%' } },
        series: [
          { name: '可用性', type: 'bar', data: shiftData.value.map((s: any) => s.availability), itemStyle: { color: tones.blue } },
          { name: '性能', type: 'bar', data: shiftData.value.map((s: any) => s.performance), itemStyle: { color: tones.green } },
          { name: '质量', type: 'bar', data: shiftData.value.map((s: any) => s.quality), itemStyle: { color: tones.amber } }
        ]
      }, true)
    }
    if (shiftStackRef.value && shiftData.value.length) {
      if (!shiftStackChart) shiftStackChart = echarts.init(shiftStackRef.value)
      const names = shiftData.value.map((s: any) => s.shift_name)
      const breakdownKeys = shiftData.value[0]?.losses_breakdown ? Object.keys(shiftData.value[0].losses_breakdown) : []
      const series = breakdownKeys.map((k: string) => ({
        name: lossCategoryLabel(k), type: 'bar', stack: 'total',
        data: shiftData.value.map((s: any) => (s.losses_breakdown || {})[k] || 0)
      }))
      shiftStackChart.setOption({
        title: { text: '损失分解 (堆叠)', left: 'center', textStyle: { fontSize: 14 } },
        tooltip: { trigger: 'axis' },
        legend: { data: breakdownKeys.map((k: string) => lossCategoryLabel(k)), bottom: 0, type: 'scroll' },
        xAxis: { type: 'category', data: names },
        yAxis: { type: 'value', name: '分钟' },
        series
      }, true)
    }
  }

  const trendFilter = reactive({ instance_id: null as number | null, days: 90 })
  const trendLoading = ref(false)
  const trendRef = ref<HTMLDivElement>()
  let trendChart: echarts.ECharts | null = null

  const loadTrend = async () => {
    if (!trendFilter.instance_id) return
    trendLoading.value = true
    try {
      const data = await Api.get('/oee/trend', { params: { instance_id: trendFilter.instance_id, days: trendFilter.days } })
      await nextTick()
      if (trendRef.value) {
        if (!trendChart) trendChart = echarts.init(trendRef.value)
        const tones = chartTones()
        const rows = data?.dates || data?.rows || []
        const dates = rows.map((r: any) => r.date || r.day || r)
        const aData = rows.map((r: any) => r.availability || 0)
        const pData = rows.map((r: any) => r.performance || 0)
        const qData = rows.map((r: any) => r.quality || 0)
        const oeeData = rows.map((r: any) => r.oee || 0)
        trendChart.setOption({
          title: { text: 'OEE 趋势 (' + trendFilter.days + '天)', left: 'center', textStyle: { fontSize: 14 } },
          tooltip: { trigger: 'axis' },
          legend: { data: ['可用性', '性能', '质量', 'OEE'], bottom: 0 },
          xAxis: { type: 'category', data: dates, axisLabel: { rotate: 30, fontSize: 10 } },
          yAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%' } },
          series: [
            { name: '可用性', type: 'line', data: aData, smooth: true, lineStyle: { color: tones.blue } },
            { name: '性能', type: 'line', data: pData, smooth: true, lineStyle: { color: tones.green } },
            { name: '质量', type: 'line', data: qData, smooth: true, lineStyle: { color: tones.amber } },
            { name: 'OEE', type: 'line', data: oeeData, smooth: true, lineStyle: { color: tones.red, width: 3 }, symbol: 'circle', symbolSize: 6 }
          ]
        }, true)
      }
    } catch (error: any) {
      ElMessage.error(error?.message || 'OEE 趋势加载失败')
    }
    finally { trendLoading.value = false }
  }

  const onTabChange = (tab: string) => {
    if ((tab === 'loss' || tab === 'shift' || tab === 'trend') && instances.value.length === 0) loadInstances()
    if (tab === 'loss') { nextTick(() => { if (lossRecords.value.length) renderLossCharts() }) }
    if (tab === 'shift') { nextTick(() => { if (shiftData.value.length) renderShiftCharts() }) }
  }

  const handleResize = () => {
    lossPieChart?.resize()
    lossBarChart?.resize()
    shiftGroupChart?.resize()
    shiftStackChart?.resize()
    trendChart?.resize()
  }

  onMounted(() => {
    load()
    loadInstances()
    window.addEventListener('resize', handleResize)
  })

  onUnmounted(() => {
    window.removeEventListener('resize', handleResize)
    lossPieChart?.dispose()
    lossBarChart?.dispose()
    shiftGroupChart?.dispose()
    shiftStackChart?.dispose()
    trendChart?.dispose()
  })

  return {
    activeTab,
    days,
    loading,
    summary,
    workstations,
    oeeNote,
    loadError,
    utilColor,
    utilToneClass,
    binaryToneClass,
    shiftOeeToneClass,
    utilStatus,
    levelTag,
    levelLabel,
    themeColor,
    chartTones,
    load,
    instances,
    loadInstances,
    lossCategories,
    lossCategoryLabel,
    lossCategoryTag,
    lossFilter,
    lossRecords,
    lossLoading,
    showLossDialog,
    lossSaving,
    lossForm,
    lossPieRef,
    lossBarRef,
    calcLossDuration,
    resetLossForm,
    saveLossRecord,
    loadLossAnalysis,
    renderLossCharts,
    shiftFilter,
    shiftData,
    shiftLoading,
    shiftGroupRef,
    shiftStackRef,
    loadShiftComparison,
    renderShiftCharts,
    trendFilter,
    trendLoading,
    trendRef,
    loadTrend,
    onTabChange,
    handleResize,
  }
}
