import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Api } from '../api'
import { buildProjectFlowSteps, type FlowStep } from './projectLaunch/flowSteps'

export function useProjectLaunchWizardPage() {

  const route = useRoute()
  const router = useRouter()

  const loading = ref(false)
  const showCreate = ref(false)
  const actionLoading = ref('')
  const selectedInstanceId = ref<number | null>(null)
  const instances = ref<any[]>([])
  const types = ref<any[]>([])
  const dashboard = ref<any>({})
  const bomHealth = ref<any>({})
  const docsCount = ref(0)
  const kitStatus = ref<any>({})
  const qualityStatus = ref<any>({ inspection_count: 0, ncr_count: 0, open_ncr_count: 0 })
  const costStatus = ref<any>({})
  const acceptanceStatus = ref<any>({ total: 0, done: 0 })
  const loadErrors = ref<string[]>([])

  const selectedInstance = computed(() => instances.value.find((item) => Number(item.id) === Number(selectedInstanceId.value)) || null)
  const processTotal = computed(() => Number(dashboard.value.process_nodes?.total || 0))
  const workOrderTotal = computed(() => Number(dashboard.value.work_orders?.total || 0))
  const dispatchedTotal = computed(() => {
    const workOrders = dashboard.value.work_orders || {}
    return Number(workOrders.dispatched || 0) + Number(workOrders.in_progress || 0) + Number(workOrders.completed || 0)
  })

  const statusOf = (done: boolean, partial = false) => (done ? 'done' : partial ? 'partial' : 'todo')
  const statusText = (status: string) => ({ done: '已完成', partial: '待完善', todo: '待开始' } as any)[status] || status
  const statusTag = (status: string) => ({ done: 'success', partial: 'warning', todo: 'info' } as any)[status] || 'info'
  const progressColor = computed(() => readinessPct.value >= 80 ? 'var(--el-color-success)' : readinessPct.value >= 45 ? 'var(--el-color-warning)' : 'var(--el-color-primary)')

  const routeFor = (path: string) => selectedInstanceId.value ? `${path}${path.includes('?') ? '&' : '?'}instance_id=${selectedInstanceId.value}` : path
  const isDoneStatus = (value: any) => ['done', 'closed', 'accepted', 'passed', 'signed', 'completed'].includes(String(value || '').toLowerCase())
  const safeLoad = async (label: string, loader: () => Promise<any>, fallback: any) => {
    try {
      return await loader()
    } catch (error: any) {
      loadErrors.value.push(`${label}: ${error?.message || error || '加载失败'}`)
      return fallback
    }
  }

  const flowSteps = computed<FlowStep[]>(() => {
    const workOrders = dashboard.value.work_orders || {}
    const kitStats = kitStatus.value.stats || {}
    return buildProjectFlowSteps({
      selectedInstance: selectedInstance.value,
      selectedInstanceId: selectedInstanceId.value,
      bomCount: Number(dashboard.value.bom_count || 0),
      bomScore: Number(bomHealth.value.score || 0),
      docsCount: docsCount.value,
      processTotal: processTotal.value,
      kitTotal: Number(kitStats.total || 0),
      kitBlocked: Number(kitStats.blocked || 0),
      kitPartial: Number(kitStats.partial || 0),
      workOrderTotal: workOrderTotal.value,
      dispatchedTotal: dispatchedTotal.value,
      completedWorkOrders: Number(workOrders.completed || 0),
      inspectionCount: Number(qualityStatus.value.inspection_count || 0),
      ncrCount: Number(qualityStatus.value.ncr_count || 0),
      openNcrCount: Number(qualityStatus.value.open_ncr_count || 0),
      actualCost: Number(costStatus.value.totals?.actual_cost || 0),
      estimatedCost: Number(costStatus.value.totals?.estimated_cost || 0),
      pendingKeyComponents: Number(costStatus.value.key_components?.pending_count || 0),
      acceptanceTotal: Number(acceptanceStatus.value.total || 0),
      acceptanceDone: Number(acceptanceStatus.value.done || 0),
      statusOf,
      routeFor,
      onCreate: () => { showCreate.value = true },
      initMinimumBom,
      generateProcessRoutes,
    })
  })

  const readinessPct = computed(() => {
    if (!flowSteps.value.length) return 0
    const score = flowSteps.value.reduce((sum, step) => sum + (step.status === 'done' ? 1 : step.status === 'partial' ? 0.45 : 0), 0)
    return Math.round((score / flowSteps.value.length) * 100)
  })

  const normalizeList = (value: any) => Array.isArray(value) ? value : (value?.items || value?.rows || value?.data || [])
  const countList = (value: any) => normalizeList(value).length || Number(value?.total || value?.count || 0)

  const loadInstances = async () => {
    const [instanceRows, typeRows] = await Promise.all([
      safeLoad('项目装备', () => Api.instances(), []),
      safeLoad('装备类型', () => Api.equipmentTypes(), []),
    ])
    instances.value = normalizeList(instanceRows)
    types.value = normalizeList(typeRows)
    const routeInstanceId = Number(route.query.instance_id || route.query.equipment_instance_id || 0)
    if (routeInstanceId && instances.value.some((item) => Number(item.id) === routeInstanceId)) {
      selectedInstanceId.value = routeInstanceId
    } else if (!selectedInstanceId.value && instances.value.length) {
      selectedInstanceId.value = Number(instances.value[0].id)
    }
  }

  const loadProjectStatus = async () => {
    if (!selectedInstanceId.value) {
      dashboard.value = {}
      bomHealth.value = {}
      docsCount.value = 0
      kitStatus.value = {}
      qualityStatus.value = { inspection_count: 0, ncr_count: 0, open_ncr_count: 0 }
      costStatus.value = {}
      acceptanceStatus.value = { total: 0, done: 0 }
      return
    }
    const id = selectedInstanceId.value
    loading.value = true
    try {
      const [dash, health, docs, kit, inspections, ncrs, cost, acceptance] = await Promise.all([
        safeLoad('项目仪表盘', () => Api.instanceDashboard(id), {}),
        safeLoad('BOM健康度', () => Api.get(`/equipment_instances/${id}/bom/health`), {}),
        safeLoad('文档/图纸', () => Api.get('/documents', { params: { equipment_instance_id: id } }), []),
        safeLoad('齐套检查', () => Api.get(`/equipment_instances/${id}/kit_check`), {}),
        safeLoad('质检记录', () => Api.get('/qc_inspections', { params: { equipment_instance_id: id } }), []),
        safeLoad('NCR闭环', () => Api.get('/qc/ncr', { params: { equipment_instance_id: id } }), []),
        safeLoad('成本归集', () => Api.get(`/equipment_instances/${id}/cost_rollup`), {}),
        safeLoad('客户验收', () => Api.get('/acceptance-checklists', { params: { equipment_instance_id: id } }), []),
      ])
      const inspectionRows = normalizeList(inspections)
      const ncrRows = normalizeList(ncrs)
      const acceptanceRows = normalizeList(acceptance)
      dashboard.value = dash || {}
      bomHealth.value = health || {}
      docsCount.value = countList(docs)
      kitStatus.value = kit || {}
      qualityStatus.value = {
        inspection_count: inspectionRows.length,
        ncr_count: ncrRows.length,
        open_ncr_count: ncrRows.filter((item: any) => !isDoneStatus(item.status) && !item.closed_at).length,
      }
      costStatus.value = cost || {}
      acceptanceStatus.value = {
        total: acceptanceRows.length,
        done: acceptanceRows.filter((item: any) => isDoneStatus(item.status) || isDoneStatus(item.result)).length,
      }
    } catch (error: any) {
      ElMessage.error(error?.message || '项目启动状态加载失败')
    } finally {
      loading.value = false
    }
  }

  const refreshAll = async () => {
    loadErrors.value = []
    await loadInstances()
    await loadProjectStatus()
  }

  const handleInstanceChange = async () => {
    if (selectedInstanceId.value) router.replace({ query: { ...route.query, instance_id: selectedInstanceId.value } })
    await loadProjectStatus()
  }

  const handleCreated = async (id: number) => {
    showCreate.value = false
    selectedInstanceId.value = id
    await refreshAll()
    router.replace({ query: { ...route.query, instance_id: id } })
    ElMessage.success('项目装备已创建，请继续完善 BOM 树')
  }

  const runAction = async (action: any) => {
    if (action.handler) {
      await action.handler()
      return
    }
    if (action.route) go(action.route)
  }

  const go = (path: string) => router.push(path)

  async function initMinimumBom() {
    if (!selectedInstanceId.value) return
    actionLoading.value = 'bom'
    try {
      await Api.post(`/equipment_instances/${selectedInstanceId.value}/bom/init-minimum`)
      ElMessage.success('已生成最低三级 BOM 骨架')
      await loadProjectStatus()
    } catch (error: any) {
      ElMessage.error(error?.message || '生成 BOM 骨架失败')
    } finally {
      actionLoading.value = ''
    }
  }

  async function generateProcessRoutes() {
    if (!selectedInstanceId.value) return
    actionLoading.value = 'process'
    try {
      const result: any = await Api.post(`/process-route/instances/${selectedInstanceId.value}/generate-missing`)
      try {
        await Api.post(`/process-route/instances/${selectedInstanceId.value}/auto-bind`)
      } catch (error: any) {
        ElMessage.warning('工艺已生成，但自动绑定工位/技能失败: ' + (error?.message || error))
      }
      ElMessage.success(`已生成缺失工艺 ${result?.created || 0} 条`)
      await loadProjectStatus()
    } catch (error: any) {
      ElMessage.error(error?.message || '生成工艺路线失败')
    } finally {
      actionLoading.value = ''
    }
  }

  onMounted(refreshAll)

  return {
    route,
    router,
    loading,
    showCreate,
    actionLoading,
    selectedInstanceId,
    instances,
    types,
    dashboard,
    bomHealth,
    docsCount,
    kitStatus,
    qualityStatus,
    costStatus,
    acceptanceStatus,
    loadErrors,
    selectedInstance,
    processTotal,
    workOrderTotal,
    dispatchedTotal,
    statusOf,
    statusText,
    statusTag,
    progressColor,
    routeFor,
    isDoneStatus,
    safeLoad,
    flowSteps,
    readinessPct,
    normalizeList,
    countList,
    loadInstances,
    loadProjectStatus,
    refreshAll,
    handleInstanceChange,
    handleCreated,
    runAction,
    go,
    initMinimumBom,
    generateProcessRoutes,
  }
}
