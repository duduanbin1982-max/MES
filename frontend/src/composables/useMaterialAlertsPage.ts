import { ref, reactive, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { Api } from '../api'
import * as echarts from 'echarts'
import { useRouter } from 'vue-router'

export function useMaterialAlertsPage() {

  const router = useRouter()
  const tab = ref('alerts')

  // ============ Shared ============
  const instances = ref<any[]>([])
  const selectedInstance = ref<any>(undefined)
  const loading = ref(false)
  const loadError = ref('')
  const autoRefresh = ref(true)
  let refreshTimer: ReturnType<typeof setInterval> | null = null

  // ============ Tab 1: Alerts + Kit Check ============
  const alerts = ref<any>({})
  const kit = ref<any>({})
  const alertTagType = (s: string) => ({ overdue: 'danger', urgent: 'danger', warning: 'warning', planned: 'info', ready: 'success', ok: 'success' }[s] || 'info')
  const alertLabel = (s: string) => ({ overdue: '已逾期', urgent: '紧急', warning: '预警', planned: '计划', ready: '已备齐', ok: 'OK' }[s] || s)
  const kitTagType = (s: string) => ({ ready: 'success', partial: 'warning', blocked: 'danger' }[s] || 'info')
  const deadlineToneClass = (days: number) => days < 0 ? 'text-danger' : days < 14 ? 'text-warning' : 'text-success'
  const positiveDangerClass = (value: number) => Number(value || 0) > 0 ? 'text-danger' : 'text-success'
  const balanceToneClass = (value: number) => Number(value || 0) < 0 ? 'text-danger' : Number(value || 0) < 10 ? 'text-warning' : 'text-success'

  const loadAlerts = async () => {
    if (!selectedInstance.value) return
    loading.value = true
    loadError.value = ''
    try {
      const [a, k] = await Promise.all([
        Api.get('/equipment_instances/' + selectedInstance.value + '/material_alerts'),
        Api.get('/equipment_instances/' + selectedInstance.value + '/kit_check')
      ])
      alerts.value = a
      kit.value = k
    } catch (e) {
      console.error('[MaterialAlerts] load failed:', e)
      loadError.value = (e as any)?.message || '物料预警接口暂时不可用，请稍后重试。'
    } finally { loading.value = false }
  }

  // ============ Tab 2: MRP ============
  const mrp = reactive({ instance_id: null as any, demand_date: '' })
  const mrpLoading = ref(false)
  const mrpResult = ref<any[]>([])

  const runMrp = async () => {
    if (!mrp.instance_id || !mrp.demand_date) return
    mrpLoading.value = true
    try {
      mrpResult.value = await Api.post('/material-planner/mrp', {
        equipment_instance_id: mrp.instance_id,
        demand_date: mrp.demand_date
      })
    } catch (e: any) {
      console.error('[MRP] failed:', e)
    } finally { mrpLoading.value = false }
  }

  const openPurchaseFromMrp = () => {
    router.push('/purchase')
  }

  // ============ Tab 3: Forecast ============
  const forecast = reactive({ weeks: 4, data: [] as any[], chartData: null as any })
  const forecastChartRef = ref<HTMLElement | null>(null)
  let forecastChart: any = null

  const loadForecast = async () => {
    try {
      forecast.data = await Api.get('/material-planner/shortage-forecast', { params: { weeks: forecast.weeks } })
      if (forecast.data.length) buildForecastChart()
    } catch (e: any) {
      console.error('[Forecast] failed:', e)
      forecast.data = []
    }
  }

  const buildForecastChart = () => {
    nextTick(() => {
      const el = forecastChartRef.value
      if (!el) return
      if (forecastChart) forecastChart.dispose()
      forecastChart = echarts.init(el)

      const weeks = [...new Set(forecast.data.map((r: any) => r.week_label))]
      const materials = [...new Set(forecast.data.map((r: any) => r.material_name))]

      const series = materials.map(m => {
        const d = forecast.data.filter((r: any) => r.material_name === m)
        return {
          name: m, type: 'line', data: weeks.map(w => {
            const f = d.find((r: any) => r.week_label === w)
            return f ? f.projected_balance : null
          }), smooth: true
        }
      })

      forecastChart.setOption({
        tooltip: { trigger: 'axis' },
        legend: { type: 'scroll', bottom: 0 },
        grid: { left: 50, right: 20, top: 20, bottom: 40 },
        xAxis: { type: 'category', data: weeks },
        yAxis: { type: 'value', name: '库存' },
        series
      })
    })
  }

  // ============ Tab 4: Lead Times ============
  const leadTimes = ref<any[]>([])
  const ltLoading = ref(false)

  const loadLeadTimes = async () => {
    ltLoading.value = true
    try {
      leadTimes.value = (await Api.get('/material-planner/lead-times')).map((r: any) => ({
        ...r, _editing: false, _lead_time_days: r.lead_time_days
      }))
    } catch { leadTimes.value = [] }
    finally { ltLoading.value = false }
  }

  const startEditLT = (row: any) => {
    row._editing = true
    row._lead_time_days = row.lead_time_days
  }

  const cancelEditLT = (row: any) => {
    row._editing = false
    row._lead_time_days = row.lead_time_days
  }

  const saveLeadTime = async (row: any) => {
    try {
      await Api.put('/material-planner/lead-times/' + row.id, {
        lead_time_days: row._lead_time_days
      })
      row.lead_time_days = row._lead_time_days
      row._editing = false
    } catch (e: any) {
      console.error('[LeadTimes] save failed:', e)
    }
  }

  // ============ Lifecycle ============
  const startAutoRefresh = () => {
    if (refreshTimer) return
    refreshTimer = setInterval(() => {
      if (selectedInstance.value && autoRefresh.value && tab.value === 'alerts') loadAlerts()
    }, 60000)
  }

  onMounted(async () => {
    instances.value = await Api.instances()
    if (instances.value.length > 0) {
      selectedInstance.value = instances.value[0].id
      await loadAlerts()
    }
    startAutoRefresh()
    loadLeadTimes()
  })

  onUnmounted(() => {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null }
    if (forecastChart) forecastChart.dispose()
  })

  return {
    router,
    tab,
    instances,
    selectedInstance,
    loading,
    loadError,
    autoRefresh,
    alerts,
    kit,
    alertTagType,
    alertLabel,
    kitTagType,
    deadlineToneClass,
    positiveDangerClass,
    balanceToneClass,
    loadAlerts,
    mrp,
    mrpLoading,
    mrpResult,
    runMrp,
    openPurchaseFromMrp,
    forecast,
    forecastChartRef,
    loadForecast,
    buildForecastChart,
    leadTimes,
    ltLoading,
    loadLeadTimes,
    startEditLT,
    cancelEditLT,
    saveLeadTime,
    startAutoRefresh,
  }
}
