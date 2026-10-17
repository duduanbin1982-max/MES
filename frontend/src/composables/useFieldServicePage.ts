import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Api } from '../api'
import { ElMessage } from 'element-plus'

export function useFieldServicePage() {

  // ==================== Shared State ====================
  const route = useRoute()
  const router = useRouter()
  const tabNames = new Set(['plans', 'logs', 'spares'])
  const routeTab = () => {
    const value = String(route.query.tab || '')
    return tabNames.has(value) ? value : 'plans'
  }
  const tab = ref(routeTab())
  const saving = ref(false)
  const overdueCount = ref(0)

  // ==================== Tab 1: 维保计划 ====================
  const plans = ref<any[]>([])
  const planLoading = ref(false)
  const planFilter = reactive({ status: '' })

  const maintTypeLabel = (t: string) =>
    ({ preventive: '预防性', corrective: '纠正性', predictive: '预测性' } as any)[t] || t
  const planStatusLabel = (s: string) =>
    ({ pending: '待执行', in_progress: '进行中', completed: '已完成' } as any)[s] || s
  const planStatusTag = (s: string) =>
    ({ pending: 'warning', in_progress: '', completed: 'success' } as any)[s] || 'info'

  const isOverdue = (nextDue: string) => {
    if (!nextDue) return false
    const today = new Date().toISOString().slice(0, 10)
    return nextDue < today
  }

  const planDlg = reactive({ visible: false, isEdit: false })
  const planForm = reactive({
    id: null as number | null,
    equipment_instance_id: '', component_name: '', maintenance_type: 'preventive',
    interval: 90, last_done: '', next_due: '', status: 'pending'
  })

  const execDlg = reactive({ visible: false })
  const execPlan = ref<any>(null)
  const execForm = reactive({
    performed_by: '', hours_spent: 0, findings: '', status: 'completed'
  })

  const loadPlans = async () => {
    planLoading.value = true
    try {
      const params: any = {}
      if (planFilter.status) params.status = planFilter.status
      plans.value = await Api.get('/field-service/maintenance-plans', { params })
    } catch (_) { plans.value = [] }
    finally { planLoading.value = false }
  }

  const openPlanDialog = (row?: any) => {
    planDlg.isEdit = !!row
    if (row) {
      Object.assign(planForm, {
        id: row.id, equipment_instance_id: row.equipment_instance_id || '',
        component_name: row.component_name || '', maintenance_type: row.maintenance_type || 'preventive',
        interval: row.interval || 90, last_done: row.last_done || '', next_due: row.next_due || '',
        status: row.status || 'pending'
      })
    } else {
      resetPlanForm()
    }
    planDlg.visible = true
  }

  const resetPlanForm = () => {
    Object.assign(planForm, {
      id: null, equipment_instance_id: '', component_name: '', maintenance_type: 'preventive',
      interval: 90, last_done: '', next_due: '', status: 'pending'
    })
  }

  const savePlan = async () => {
    if (!planForm.equipment_instance_id || !planForm.component_name) {
      ElMessage.warning('请填写装备实例ID和部件名称'); return
    }
    saving.value = true
    try {
      const body = { ...planForm }
      delete (body as any).id
      if (planDlg.isEdit && planForm.id) {
        await Api.put(`/field-service/maintenance-plans/${planForm.id}`, body)
      } else {
        await Api.post('/field-service/maintenance-plans', body)
      }
      ElMessage.success('已保存')
      planDlg.visible = false
      loadPlans()
    } catch (e: any) { ElMessage.error(e?.message || '保存失败') }
    finally { saving.value = false }
  }

  const openExecDialog = (plan: any) => {
    execPlan.value = plan
    resetExecForm()
    execDlg.visible = true
  }

  const resetExecForm = () => {
    Object.assign(execForm, { performed_by: '', hours_spent: 0, findings: '', status: 'completed' })
  }

  const submitExecution = async () => {
    if (!execForm.performed_by) { ElMessage.warning('请填写执行人'); return }
    saving.value = true
    try {
      await Api.post('/field-service/maintenance-logs', {
        maintenance_plan_id: execPlan.value.id,
        equipment: execPlan.value.equipment_instance_id,
        component: execPlan.value.component_name,
        performed_by: execForm.performed_by,
        hours_spent: execForm.hours_spent,
        findings: execForm.findings || undefined,
        status: execForm.status
      })
      // Also update the plan status
      await Api.put(`/field-service/maintenance-plans/${execPlan.value.id}`, {
        ...execPlan.value,
        status: 'completed',
        last_done: new Date().toISOString().slice(0, 10)
      })
      ElMessage.success('维保记录已提交')
      execDlg.visible = false
      loadPlans()
    } catch (e: any) { ElMessage.error(e?.message || '提交失败') }
    finally { saving.value = false }
  }

  // ==================== Tab 2: 维保记录 ====================
  const logs = ref<any[]>([])
  const logLoading = ref(false)
  const logFilter = reactive({
    dateRange: null as [string, string] | null,
    instance: '',
    status: ''
  })

  const logStatusLabel = (s: string) =>
    ({ completed: '正常完成', issues_found: '发现问题', needs_followup: '需跟进' } as any)[s] || s
  const logStatusTag = (s: string) =>
    ({ completed: 'success', issues_found: 'warning', needs_followup: 'danger' } as any)[s] || 'info'

  const loadLogs = async () => {
    logLoading.value = true
    try {
      const params: any = {}
      if (logFilter.dateRange && logFilter.dateRange.length === 2) {
        params.start_date = logFilter.dateRange[0]
        params.end_date = logFilter.dateRange[1]
      }
      if (logFilter.instance) params.equipment = logFilter.instance
      if (logFilter.status) params.status = logFilter.status
      logs.value = await Api.get('/field-service/maintenance-logs', { params })
    } catch (_) { logs.value = [] }
    finally { logLoading.value = false }
  }

  // ==================== Tab 3: 备件库 ====================
  const spares = ref<any[]>([])
  const spareLoading = ref(false)

  const spareDlg = reactive({ visible: false, type: 'in' as 'in' | 'out' })
  const spareForm = reactive({
    spare_part_id: null as number | null,
    quantity: 1,
    notes: ''
  })

  const lowStockCount = computed(() => spares.value.filter((s: any) => s.current_stock <= s.min_stock).length)

  const loadSpares = async () => {
    spareLoading.value = true
    try { spares.value = await Api.get('/field-service/spare-parts') } catch (_) { spares.value = [] }
    finally { spareLoading.value = false }
  }

  const openSpareAdjustDialog = (type: 'in' | 'out') => {
    spareDlg.type = type
    resetSpareForm()
    spareDlg.visible = true
  }

  const resetSpareForm = () => {
    Object.assign(spareForm, { spare_part_id: null, quantity: 1, notes: '' })
  }

  const submitSpareAdjust = async () => {
    if (!spareForm.spare_part_id) { ElMessage.warning('请选择备件'); return }
    if (spareForm.quantity < 1) { ElMessage.warning('数量必须大于0'); return }
    saving.value = true
    try {
      await Api.post('/field-service/spare-parts/adjust', {
        spare_part_id: spareForm.spare_part_id,
        quantity: spareForm.quantity,
        type: spareDlg.type,
        notes: spareForm.notes || undefined
      })
      ElMessage.success(spareDlg.type === 'in' ? '入库成功' : '出库成功')
      spareDlg.visible = false
      loadSpares()
    } catch (e: any) { ElMessage.error(e?.message || '操作失败') }
    finally { saving.value = false }
  }

  // ==================== Init ====================
  const loadOverdue = async () => {
    try {
      const res = await Api.get('/field-service/overdue')
      overdueCount.value = typeof res === 'object' ? (res.count || res.total || 0) : (res || 0)
    } catch (_) { overdueCount.value = 0 }
  }

  const onTabChange = (t: string) => {
    if (route.query.tab !== t) router.replace({ query: { ...route.query, tab: t } })
    if (t === 'logs' && logs.value.length === 0) loadLogs()
    if (t === 'spares' && spares.value.length === 0) loadSpares()
  }

  watch(() => route.query.tab, () => {
    const next = routeTab()
    if (next !== tab.value) {
      tab.value = next
      onTabChange(next)
    }
  })

  onMounted(async () => {
    await Promise.all([loadOverdue(), loadPlans()])
    onTabChange(tab.value)
  })

  return {
    route,
    router,
    tabNames,
    routeTab,
    tab,
    saving,
    overdueCount,
    plans,
    planLoading,
    planFilter,
    maintTypeLabel,
    planStatusLabel,
    planStatusTag,
    isOverdue,
    planDlg,
    planForm,
    execDlg,
    execPlan,
    execForm,
    loadPlans,
    openPlanDialog,
    resetPlanForm,
    savePlan,
    openExecDialog,
    resetExecForm,
    submitExecution,
    logs,
    logLoading,
    logFilter,
    logStatusLabel,
    logStatusTag,
    loadLogs,
    spares,
    spareLoading,
    spareDlg,
    spareForm,
    lowStockCount,
    loadSpares,
    openSpareAdjustDialog,
    resetSpareForm,
    submitSpareAdjust,
    loadOverdue,
    onTabChange,
  }
}
