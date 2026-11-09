import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Api } from '../api'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '../stores/auth'

export function useFieldServicePage() {
  const route = useRoute()
  const router = useRouter()
  const auth = useAuthStore()
  const tabNames = new Set(['plans', 'logs', 'checklists', 'breakdowns', 'spares'])
  const routeTab = () => {
    const value = String(route.query.tab || '')
    return tabNames.has(value) ? value : 'plans'
  }
  const tab = ref(routeTab())
  const saving = ref(false)
  const overdueCount = ref(0)
  const instances = ref<any[]>([])
  const errText = (error: any) => error?.response?.data?.error || error?.response?.data?.message || error?.message || String(error)
  const today = () => new Date().toISOString().slice(0, 10)
  const userId = () => Number(auth.user?.id || auth.user?.uid || 0) || null

  // ==================== 装备实例 ====================
  const loadInstances = async () => {
    try { instances.value = await Api.get('/equipment_instances') } catch (_) { instances.value = [] }
  }

  // ==================== 维保计划 ====================
  const plans = ref<any[]>([])
  const planLoading = ref(false)
  const planFilter = reactive({ status: '' })
  const maintTypeLabel = (t: string) => ({ weekly: '周检', monthly: '月检', quarterly: '季检', routine: '例行', preventive: '预防性', corrective: '纠正性', predictive: '预测性', inspection: '点检' } as any)[t] || t
  const planStatusLabel = (s: string) => ({ active: '待执行', pending: '待执行', in_progress: '进行中', completed: '已完成', cancelled: '已取消' } as any)[s] || s
  const planStatusTag = (s: string) => ({ active: 'warning', pending: 'warning', in_progress: '', completed: 'success', cancelled: 'info' } as any)[s] || 'info'
  const isOverdue = (nextDue: string) => !!nextDue && nextDue < today()

  const planDlg = reactive({ visible: false, isEdit: false })
  const emptyPlan = () => ({ id: null, equipment_instance_id: '', plan_code: '', plan_name: '', maintenance_type: 'preventive', frequency_days: 90, last_done_date: '', next_due_date: '', status: 'pending', notes: '' })
  const planForm = reactive<any>(emptyPlan())
  const resetPlanForm = () => Object.assign(planForm, emptyPlan())

  const loadPlans = async () => {
    planLoading.value = true
    try { plans.value = await Api.get('/field-service/maintenance-plans', { params: planFilter.status ? { status: planFilter.status } : {} }) }
    catch (_) { plans.value = [] } finally { planLoading.value = false }
  }
  const openPlanDialog = (row?: any) => {
    planDlg.isEdit = !!row
    if (row) Object.assign(planForm, emptyPlan(), row)
    else resetPlanForm()
    planDlg.visible = true
  }
  const savePlan = async () => {
    if (!planForm.equipment_instance_id || !planForm.plan_name) { ElMessage.warning('请选择装备实例并填写计划名称'); return }
    saving.value = true
    try {
      const body: any = { ...planForm }
      delete body.id
      if (planDlg.isEdit && planForm.id) await Api.put(`/field-service/maintenance-plans/${planForm.id}`, body)
      else await Api.post('/field-service/maintenance-plans', body)
      ElMessage.success('已保存'); planDlg.visible = false; loadPlans(); loadOverdue()
    } catch (error: any) { ElMessage.error('保存失败：' + errText(error)) } finally { saving.value = false }
  }

  // ==================== 执行维保 ====================
  const execDlg = reactive({ visible: false })
  const execPlan = ref<any>(null)
  const execForm = reactive({ performed_by: '', hours_spent: 0, findings: '', status: 'completed' })
  const resetExecForm = () => Object.assign(execForm, { performed_by: String(auth.user?.id || auth.user?.uid || ''), hours_spent: 0, findings: '', status: 'completed' })
  const openExecDialog = (plan: any) => { execPlan.value = plan; resetExecForm(); execDlg.visible = true }
  const submitExecution = async () => {
    if (!execPlan.value) return
    if (!execForm.performed_by) { ElMessage.warning('请填写执行人'); return }
    saving.value = true
    try {
      await Api.post('/field-service/maintenance-logs', {
        plan_id: execPlan.value.id,
        equipment_instance_id: execPlan.value.equipment_instance_id,
        performed_by: Number(execForm.performed_by) || userId(),
        hours_spent: execForm.hours_spent,
        findings: execForm.findings || undefined,
        status: execForm.status,
      })
      await Api.post(`/field-service/maintenance-plans/${execPlan.value.id}/complete`)
      ElMessage.success('维保记录已提交，计划已完成并顺延'); execDlg.visible = false
      await Promise.all([loadPlans(), loadLogs(), loadOverdue()])
    } catch (error: any) { ElMessage.error('提交失败：' + errText(error)) } finally { saving.value = false }
  }

  // ==================== 维保记录 ====================
  const logs = ref<any[]>([])
  const logLoading = ref(false)
  const logFilter = reactive({ dateRange: null as any, instance: '', status: '' })
  const logStatusLabel = (s: string) => ({ completed: '正常完成', issues_found: '发现问题', needs_followup: '需跟进' } as any)[s] || s
  const logStatusTag = (s: string) => ({ completed: 'success', issues_found: 'warning', needs_followup: 'danger' } as any)[s] || 'info'
  const loadLogs = async () => {
    logLoading.value = true
    try {
      const params: any = {}
      if (logFilter.dateRange?.length === 2) { params.start_date = logFilter.dateRange[0]; params.end_date = logFilter.dateRange[1] }
      if (logFilter.instance) params.equipment_instance_id = logFilter.instance
      if (logFilter.status) params.status = logFilter.status
      logs.value = await Api.get('/field-service/maintenance-logs', { params })
    } catch (_) { logs.value = [] } finally { logLoading.value = false }
  }

  // ==================== 点检表 ====================
  const checklists = ref<any[]>([])
  const checklistLoading = ref(false)
  const checklistDlg = reactive({ visible: false })
  const checklistForm = reactive<any>({ equipment_instance_id: '', checklist_name: '', check_type: 'daily' })
  const execChecklistDlg = reactive({ visible: false, row: null as any, results: [] as any[], hours_spent: 0.5 })
  const loadChecklists = async () => {
    checklistLoading.value = true
    try { checklists.value = await Api.get('/field-service/checklists') } catch (_) { checklists.value = [] } finally { checklistLoading.value = false }
  }
  const openChecklistDialog = () => { Object.assign(checklistForm, { equipment_instance_id: '', checklist_name: '', check_type: 'daily' }); checklistDlg.visible = true }
  const parseItems = (row: any) => { try { return JSON.parse(row?.items_json || '[]') } catch (_) { return [] } }
  const saveChecklist = async () => {
    if (!checklistForm.checklist_name) { ElMessage.warning('点检表名称必填'); return }
    saving.value = true
    try { await Api.post('/field-service/checklists', checklistForm); ElMessage.success('点检表已创建'); checklistDlg.visible = false; loadChecklists() }
    catch (error: any) { ElMessage.error('保存失败：' + errText(error)) } finally { saving.value = false }
  }
  const openExecChecklist = (row: any) => {
    const results = parseItems(row).map((item: any) => ({ name: item.name, expected: item.expected, result: 'pass' }))
    Object.assign(execChecklistDlg, { visible: true, row, results, hours_spent: 0.5 })
  }
  const submitChecklist = async () => {
    if (!execChecklistDlg.row) return
    saving.value = true
    try {
      const allPass = execChecklistDlg.results.every((item: any) => item.result === 'pass')
      await Api.put(`/field-service/checklists/${execChecklistDlg.row.id}/execute`, {
        equipment_instance_id: execChecklistDlg.row.equipment_instance_id,
        checklist_name: execChecklistDlg.row.checklist_name,
        performed_by: userId(), hours_spent: execChecklistDlg.hours_spent,
        results: execChecklistDlg.results, all_pass: allPass,
      })
      ElMessage.success('点检已提交'); execChecklistDlg.visible = false; await Promise.all([loadChecklists(), loadLogs()])
    } catch (error: any) { ElMessage.error('提交失败：' + errText(error)) } finally { saving.value = false }
  }

  // ==================== 故障报修 ====================
  const breakdowns = ref<any[]>([])
  const breakdownLoading = ref(false)
  const breakdownDlg = reactive({ visible: false })
  const breakdownForm = reactive<any>({ equipment_instance_id: '', fault_type: 'mechanical', fault_desc: '', severity: 'medium' })
  const breakdownEditDlg = reactive({ visible: false, row: null as any, status: 'open', downtime_hours: null, root_cause: '', repair_actions: '' })
  const loadBreakdowns = async () => {
    breakdownLoading.value = true
    try { breakdowns.value = await Api.get('/field-service/breakdowns') } catch (_) { breakdowns.value = [] } finally { breakdownLoading.value = false }
  }
  const openBreakdownDialog = () => { Object.assign(breakdownForm, { equipment_instance_id: '', fault_type: 'mechanical', fault_desc: '', severity: 'medium' }); breakdownDlg.visible = true }
  const saveBreakdown = async () => {
    if (!breakdownForm.equipment_instance_id || !breakdownForm.fault_desc) { ElMessage.warning('装备和故障描述必填'); return }
    saving.value = true
    try { await Api.post('/field-service/breakdowns', { ...breakdownForm, reported_by: userId() }); ElMessage.success('故障已报修'); breakdownDlg.visible = false; loadBreakdowns() }
    catch (error: any) { ElMessage.error('报修失败：' + errText(error)) } finally { saving.value = false }
  }
  const openBreakdownEdit = (row: any) => { Object.assign(breakdownEditDlg, { visible: true, row, status: row.status, downtime_hours: row.downtime_hours, root_cause: row.root_cause || '', repair_actions: row.repair_actions || '' }) }
  const saveBreakdownEdit = async () => {
    if (!breakdownEditDlg.row) return
    saving.value = true
    try {
      await Api.put(`/field-service/breakdowns/${breakdownEditDlg.row.id}`, { status: breakdownEditDlg.status, downtime_hours: breakdownEditDlg.downtime_hours, root_cause: breakdownEditDlg.root_cause, repair_actions: breakdownEditDlg.repair_actions })
      ElMessage.success('故障单已更新'); breakdownEditDlg.visible = false; loadBreakdowns()
    } catch (error: any) { ElMessage.error('更新失败：' + errText(error)) } finally { saving.value = false }
  }

  // ==================== 备件库 ====================
  const spares = ref<any[]>([])
  const spareLoading = ref(false)
  const spareDlg = reactive({ visible: false, type: 'in' as 'in' | 'out' })
  const spareForm = reactive({ spare_part_id: null as any, quantity: 1, notes: '' })
  const lowStockCount = computed(() => spares.value.filter((s: any) => Number(s.current_stock) <= Number(s.min_stock)).length)
  const loadSpares = async () => { spareLoading.value = true; try { spares.value = await Api.get('/field-service/spare-parts') } catch (_) { spares.value = [] } finally { spareLoading.value = false } }
  const openSpareAdjustDialog = (type: 'in' | 'out') => { spareDlg.type = type; Object.assign(spareForm, { spare_part_id: null, quantity: 1, notes: '' }); spareDlg.visible = true }
  const submitSpareAdjust = async () => {
    if (!spareForm.spare_part_id) { ElMessage.warning('请选择备件'); return }
    if (spareForm.quantity < 1) { ElMessage.warning('数量必须大于0'); return }
    saving.value = true
    try { await Api.post('/field-service/spare-parts/adjust', { spare_part_id: spareForm.spare_part_id, quantity: spareForm.quantity, type: spareDlg.type, notes: spareForm.notes || undefined }); ElMessage.success(spareDlg.type === 'in' ? '入库成功' : '出库成功'); spareDlg.visible = false; loadSpares() }
    catch (error: any) { ElMessage.error('操作失败：' + errText(error)) } finally { saving.value = false }
  }

  const loadOverdue = async () => { try { const res: any = await Api.get('/field-service/overdue'); overdueCount.value = Array.isArray(res) ? res.length : (res?.count || res?.total || 0) } catch (_) { overdueCount.value = 0 } }
  const onTabChange = (t: string) => {
    if (route.query.tab !== t) router.replace({ query: { ...route.query, tab: t } })
    if (t === 'logs' && logs.value.length === 0) loadLogs()
    if (t === 'checklists' && checklists.value.length === 0) loadChecklists()
    if (t === 'breakdowns' && breakdowns.value.length === 0) loadBreakdowns()
    if (t === 'spares' && spares.value.length === 0) loadSpares()
  }
  watch(() => route.query.tab, () => { const next = routeTab(); if (next !== tab.value) { tab.value = next; onTabChange(next) } })
  onMounted(async () => { await Promise.all([loadInstances(), loadPlans(), loadOverdue(), loadChecklists(), loadBreakdowns(), loadSpares()]); onTabChange(tab.value) })

  return {
    route, router, tabNames, routeTab, tab, saving, overdueCount, instances,
    planLoading, plans, planFilter, maintTypeLabel, planStatusLabel, planStatusTag, isOverdue,
    planDlg, planForm, loadPlans, openPlanDialog, resetPlanForm, savePlan,
    execDlg, execPlan, execForm, openExecDialog, resetExecForm, submitExecution,
    logLoading, logs, logFilter, logStatusLabel, logStatusTag, loadLogs,
    checklistLoading, checklists, checklistDlg, checklistForm, execChecklistDlg,
    openChecklistDialog, saveChecklist, openExecChecklist, submitChecklist, parseItems,
    breakdownLoading, breakdowns, breakdownDlg, breakdownForm, breakdownEditDlg,
    openBreakdownDialog, saveBreakdown, openBreakdownEdit, saveBreakdownEdit,
    spareLoading, spares, spareDlg, spareForm, lowStockCount, openSpareAdjustDialog, submitSpareAdjust,
    loadOverdue, onTabChange,
  }
}
