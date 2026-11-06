import { ref, reactive, computed, onMounted } from 'vue'
import { useAuthStore } from '../stores/auth'
import { Api } from '../api'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { ApiRecord } from '../types/api'

export function useProcessHoursPage() {
  const auth = useAuthStore()
  const localToday = () => {
    const now = new Date()
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  }

  const activeTab = ref('hours')

  // 公共数据
  const instances = ref<ApiRecord[]>([])
  const workOrders = ref<ApiRecord[]>([])
  const processNodes = ref<ApiRecord[]>([])
  const selectedInstance = ref<number | null>(null)

  // Tab 1: 工时定额
  const hoursSummary = reactive<{ total_man_hours: number; details: ApiRecord[] }>({ total_man_hours: 0, details: [] })
  const hoursLoading = ref(false)
  const showHoursEdit = ref(false)
  const hoursSaving = ref(false)
  const hoursForm = reactive({ node_id: 0, operation_name: '', work_type: 'assembly', standard_hours: 8, worker_count: 2, description: '' })

  // Tab 2: 工序报工
  const reports = ref<ApiRecord[]>([])
  const reportsLoading = ref(false)
  const reportFilter = reactive<{ work_order_id: number | null; dateRange: [string, string] | null }>({ work_order_id: null, dateRange: null })
  const showReportDialog = ref(false)
  const reportSaving = ref(false)
  const reportForm = reactive<{ work_order_id: number | null; process_node_id: number | null; hours_spent: number; quantity_completed: number; quality_result: string; notes: string }>({ work_order_id: null, process_node_id: null, hours_spent: 0, quantity_completed: 0, quality_result: 'pass', notes: '' })

  const canVoid = computed(() => Boolean(auth.hasPerm && auth.hasPerm('work_report:write')))
  const voidReport = async (row: any) => {
    try {
      await ElMessageBox.confirm(`撤销报工 #${row.id}（${row.wo_code || ''} / ${row.hours_spent}h）? 撤销后工单实际工时会重算。`, '撤销报工', { type: 'warning' })
      const result: any = await Api.del('/work-reports/' + row.id)
      ElMessage.success('已撤销，工单实际工时 ' + (result?.actual_hours ?? 0) + 'h')
      await loadReports()
      await loadDailySummary()
    } catch (error: any) {
      if (error === 'cancel' || error === 'close') return
      ElMessage.error(error?.response?.data?.message || error?.message || '撤销失败')
    }
  }

  // Tab 3: 日汇总
  const dailySummary = reactive<{ workers: number; details: ApiRecord[] }>({ workers: 0, details: [] })
  const dailyLoading = ref(false)
  const dailyDate = ref(localToday())
  const dailyTotalHours = computed(() => (dailySummary.details || []).reduce((sum: number, row: ApiRecord) => sum + (row.total_hours || 0), 0))

  // Tab 4: 完工进度
  const selectedNodeId = ref<number | null>(null)
  const nodeProgress = reactive<{ process_node_id: number; total_hours_reported: number; standard_man_hours: number; completion_pct: number; report_count: number; recent_reports: ApiRecord[] }>({ process_node_id: 0, total_hours_reported: 0, standard_man_hours: 0, completion_pct: 0, report_count: 0, recent_reports: [] })

  // 工种映射
  const workTypeTags: Record<string, string> = { assembly: '', welding: 'warning', machining: 'danger', testing: 'info', qc: 'success' }
  const workTypeLabels: Record<string, string> = { assembly: '装配', welding: '焊接', machining: '机加', testing: '测试', qc: '质检' }
  const workTypeTag = (type: string) => workTypeTags[type] || ''
  const workTypeLabel = (type: string) => workTypeLabels[type] || type

  // 加载公共数据
  const loadCommonData = async () => {
    try {
      const [instRes, woRes] = await Promise.all([
        Api.instances().catch(() => ({ data: [] })),
        Api.workOrders().catch(() => ({ data: [] }))
      ])
      instances.value = Array.isArray(instRes) ? instRes : (instRes.data || [])
      workOrders.value = Array.isArray(woRes) ? woRes : (woRes.data || [])
    } catch (_) { ElMessage.error('加载实例/工单失败') }
  }

  const loadProcessNodes = async (instanceId: number | null) => {
    if (!instanceId) { processNodes.value = []; return }
    try {
      const r = await Api.get('/equipment_instances/' + instanceId + '/process_tree')
      processNodes.value = (r.flat || []).map((node: ApiRecord) => ({ id: node.id, operation_name: node.operation_name || node.material_name }))
    } catch (_) { processNodes.value = [] }
  }

  // Tab 1: 加载工时汇总
  const loadHoursSummary = async () => {
    if (!selectedInstance.value) return
    hoursLoading.value = true
    try {
      const r = await Api.get('/process/hours-summary?instance_id=' + selectedInstance.value)
      Object.assign(hoursSummary, r)
      await loadProcessNodes(selectedInstance.value)
    } catch (e) { ElMessage.error('加载工时定额失败') }
    finally { hoursLoading.value = false }
  }

  const openHoursDialog = (row: ApiRecord) => {
    hoursForm.node_id = row.node_id
    hoursForm.operation_name = row.operation_name
    hoursForm.work_type = row.work_type || 'assembly'
    hoursForm.standard_hours = row.standard_hours || 0
    hoursForm.worker_count = row.worker_count || 1
    hoursForm.description = row.description || ''
    showHoursEdit.value = true
  }

  const saveHours = async () => {
    hoursSaving.value = true
    try {
      await Api.post('/process/nodes/' + hoursForm.node_id + '/hours', {
        work_type: hoursForm.work_type,
        standard_hours: hoursForm.standard_hours,
        worker_count: hoursForm.worker_count,
        description: hoursForm.description
      })
      ElMessage.success('保存成功')
      showHoursEdit.value = false
      loadHoursSummary()
    } catch (e) { ElMessage.error('保存失败') }
    finally { hoursSaving.value = false }
  }

  const deleteHours = async (row: ApiRecord) => {
    try {
      await ElMessageBox.confirm('确认删除 #' + row.node_id + ' ' + row.work_type + ' 的工时定额?', '确认删除', { type: 'warning' })
      await Api.del('/process/nodes/' + row.node_id + '/hours/' + row.work_type)
      ElMessage.success('已删除')
      loadHoursSummary()
    } catch (_) { if (_ !== 'cancel' && _ !== 'close') ElMessage.error('删除失败') }
  }

  // Tab 2: 报工
  const loadReports = async () => {
    reportsLoading.value = true
    try {
      const params: ApiRecord = {}
      if (reportFilter.work_order_id) params.work_order_id = reportFilter.work_order_id
      if (reportFilter.dateRange) { params.start_date = reportFilter.dateRange[0]; params.end_date = reportFilter.dateRange[1] }
      reports.value = await Api.get('/work-reports', { params })
    } catch (_) { reports.value = [] }
    finally { reportsLoading.value = false }
  }

  const submitReport = async () => {
    if (!reportForm.work_order_id || reportForm.hours_spent <= 0) return ElMessage.warning('工单和工时必填')
    reportSaving.value = true
    try {
      await Api.post('/work-reports', { ...reportForm })
      ElMessage.success('报工成功')
      showReportDialog.value = false
      Object.assign(reportForm, { work_order_id: null, process_node_id: null, hours_spent: 0, quantity_completed: 0, quality_result: 'pass', notes: '' })
      loadReports()
      loadDailySummary()
    } catch (e) { ElMessage.error('报工失败') }
    finally { reportSaving.value = false }
  }

  // Tab 3: 日汇总
  const loadDailySummary = async () => {
    dailyLoading.value = true
    try {
      const r = await Api.get('/work-reports/daily-summary', { date: dailyDate.value })
      Object.assign(dailySummary, r)
    } catch (_) { Object.assign(dailySummary, { workers: 0, details: [] }) }
    finally { dailyLoading.value = false }
  }

  // Tab 4: 进度
  const onNodeSelect = async (nodeId: number | null) => {
    if (!nodeId) return
    try {
      const r = await Api.get('/process/nodes/' + nodeId + '/progress')
      Object.assign(nodeProgress, r)
    } catch (_) { Object.assign(nodeProgress, { process_node_id: 0 }) }
  }


  // Tab 5: 工人绩效
  const perfFilter = reactive<{ dateRange: [string, string] | null }>({ dateRange: null })
  const workerPerfData = ref<any[]>([])
  const perfLoading = ref(false)
  const perfSummary = reactive({ avg_efficiency: null as number | null, total_hours_sum: 0, total_tasks: 0 })

  const loadWorkerPerformance = async () => {
    if (!perfFilter.dateRange) { workerPerfData.value = []; return }
    perfLoading.value = true
    try {
      const params: any = {}
      if (perfFilter.dateRange) { params.from = perfFilter.dateRange[0]; params.to = perfFilter.dateRange[1] }
      const r = await Api.get('/process-hours/worker-performance', { params })
      workerPerfData.value = r?.workers || r || []
      const summary = r?.summary || {}
      const withStandard = workerPerfData.value.filter((row:any) => row.efficiency_pct != null)
      perfSummary.avg_efficiency = summary.avg_efficiency ?? (withStandard.length ? Math.round(withStandard.reduce((s:number,x:any)=>s+x.efficiency_pct,0)/withStandard.length) : null)
      perfSummary.total_hours_sum = summary.total_hours_sum ?? workerPerfData.value.reduce((s:number,x:any)=>s+(x.total_hours||0),0)
      perfSummary.total_tasks = summary.total_tasks ?? workerPerfData.value.reduce((s:number,x:any)=>s+(x.tasks_completed||0),0)
    } catch (_) { workerPerfData.value = [] }
    finally { perfLoading.value = false }
  }

  // Tab 6: 加班统计
  const otFilter = reactive<{ dateRange: [string, string] | null }>({ dateRange: null })
  const overtimeData = ref<any[]>([])
  const otLoading = ref(false)
  const otSummary = reactive({ total_overtime: 0, worker_count: 0 })

  const loadOvertime = async () => {
    if (!otFilter.dateRange) { overtimeData.value = []; return }
    otLoading.value = true
    try {
      const params: any = {}
      if (otFilter.dateRange) { params.from = otFilter.dateRange[0]; params.to = otFilter.dateRange[1] }
      const r = await Api.get('/process-hours/overtime', { params })
      overtimeData.value = r?.records || r || []
      otSummary.total_overtime = r?.total_overtime || overtimeData.value.reduce((s:number,x:any)=>s+(x.overtime_hours||0),0)
      otSummary.worker_count = r?.worker_count || new Set(overtimeData.value.map((x:any)=>x.user_name)).size
    } catch (_) { overtimeData.value = [] }
    finally { otLoading.value = false }
  }

  const onTabChange = (tab: string) => {
    if (tab === 'reports' && reports.value.length === 0) loadReports()
    if (tab === 'daily') loadDailySummary()
    if (tab === 'worker-perf' && workerPerfData.value.length === 0) loadWorkerPerformance()
    if (tab === 'overtime' && overtimeData.value.length === 0) loadOvertime()
  }

  onMounted(() => {
    loadCommonData()
    loadDailySummary()
  })

  return {
    activeTab,
    instances,
    workOrders,
    processNodes,
    selectedInstance,
    hoursSummary,
    hoursLoading,
    showHoursEdit,
    hoursSaving,
    hoursForm,
    reports,
    reportsLoading,
    reportFilter,
    canVoid,
    voidReport,
    showReportDialog,
    reportSaving,
    reportForm,
    dailySummary,
    dailyLoading,
    dailyDate,
    dailyTotalHours,
    selectedNodeId,
    nodeProgress,
    workTypeTag,
    workTypeLabel,
    loadCommonData,
    loadProcessNodes,
    loadHoursSummary,
    openHoursDialog,
    saveHours,
    deleteHours,
    loadReports,
    submitReport,
    loadDailySummary,
    onNodeSelect,
    perfFilter,
    workerPerfData,
    perfLoading,
    perfSummary,
    loadWorkerPerformance,
    otFilter,
    overtimeData,
    otLoading,
    otSummary,
    loadOvertime,
    onTabChange,
  }
}
