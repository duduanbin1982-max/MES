import { ref, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'
import {
  nodeStatusLabel as scheduleNodeStatusLabel,
  nodeStatusTone as scheduleNodeStatusTone,
} from '../domain/scheduleBoard'

export function useSchedulePage() {

  const activeTab = ref('weekly')

  const instances = ref<any[]>([])
  const selectedInstance = ref<any>(undefined)
  const milestones = ref<any[]>([])
  const filters = ref({})
  const loading = ref(false)

  const weeklyWeek = ref<any>(new Date())
  const weeklyData = ref<any>(null)
  const activeEquipments = ref<number[]>([])
  const assignDialogVisible = ref(false)
  const assignRow = ref<any>(null)
  const assignForm = ref<any>({ assigned_id: null, planned_start: '', planned_end: '', workstation_id: null })
  const workers = ref<any[]>([])
  const workstations = ref<any[]>([])

  const weeklyEquipments = computed(() => weeklyData.value?.equipment_instances || weeklyData.value?.equipment || [])

  // 2026-11-04：批次记录（可撤销）+ 数据更新时间
  const refreshAt = ref<Date | null>(null)
  const batches = ref<any[]>([])
  const batchLoading = ref(false)

  const loadBatches = async () => {
    batchLoading.value = true
    try {
      const result = await api.get('/schedule/reschedule/batches', { params: { limit: 20 } })
      batches.value = result?.items || result || []
    } catch (error: any) {
      ElMessage.error('加载批次记录失败: ' + (error?.message || error))
    } finally {
      batchLoading.value = false
    }
  }

  const undoBatch = async (batch: any) => {
    batchLoading.value = true
    try {
      const result = await api.post('/schedule/reschedule/batches/' + batch.id + '/undo')
      ElMessage.success(`已撤销 ${result.batch_no}：还原 ${result.restored} 条${result.skipped ? `，跳过 ${result.skipped} 条（时间已被改过）` : ''}`)
      await Promise.all([loadBatches(), loadWeekly()])
    } catch (error: any) {
      ElMessage.error('撤销失败: ' + (error?.message || error))
    } finally {
      batchLoading.value = false
    }
  }

  const weeklySummary = computed(() => {
    const summary = weeklyData.value?.summary || {}
    return {
      total: Number(summary.total ?? summary.total_nodes ?? 0),
      completed: Number(summary.completed || 0),
      in_progress: Number(summary.in_progress || 0),
      pending: Number(summary.pending || 0),
      delayed: Number(summary.delayed || 0)
    }
  })

  const msTagType = (status: string) => ({ pending: 'info', active: 'primary', completed: 'success', delayed: 'danger' }[status] || 'info')
  const milestoneStatusLabel = (status: string) => ({ pending: '待开始', active: '进行中', completed: '已完成', delayed: '延期' }[status] || status)
  const msProgress = (milestone: any) => {
    if (milestone.status === 'completed') return 100
    if (milestone.status === 'active') return 50
    if (milestone.status === 'delayed') return 25
    return 0
  }

  // 2026-11-04：状态文案/色调统一走 domain/scheduleBoard（支持 ready/paused 等，避免出现英文原值）
  const nodeStatusTag = (status: string) => scheduleNodeStatusTone(status)
  const nodeStatusLabel = (status: string) => scheduleNodeStatusLabel(status)

  const loadSchedule = async () => {
    loading.value = true
    try {
      if (instances.value.length === 0) instances.value = await api.get('/equipment_instances')
      if (selectedInstance.value) {
        milestones.value = await api.get('/equipment_instances/' + selectedInstance.value + '/milestones')
        refreshAt.value = new Date()
      }
    } catch (error: any) {
      ElMessage.error('加载调度数据失败: ' + (error?.message || error))
    } finally {
      loading.value = false
    }
  }

  // 2026-11-05（审计 F-01/F-05）：本地日期格式化（不要 toISOString，东八区会变成前一天）
  const formatLocalDate = (value: Date = new Date()) => {
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
  }

  const markActive = async (milestone: any) => {
    try {
      await ElMessageBox.confirm(
        `确认开始「${milestone.phase_name || milestone.phase_code}」？实际开始日期记为今天（${formatLocalDate()}）。`,
        '开始里程碑',
        { type: 'warning' },
      )
    } catch {
      return
    }
    loading.value = true
    try {
      await api.put('/milestones/' + milestone.id, { status: 'active', actual_start: formatLocalDate() })
      ElMessage.success(milestone.phase_code + ' 已开始')
      await loadSchedule()
    } catch (error: any) {
      ElMessage.error('激活里程碑失败: ' + (error?.message || error))
    } finally {
      loading.value = false
    }
  }

  const markComplete = async (milestone: any) => {
    try {
      await ElMessageBox.confirm(
        `确认完成「${milestone.phase_name || milestone.phase_code}」？实际完成日期记为今天（${formatLocalDate()}），完成后不可回退。`,
        '完成里程碑',
        { type: 'warning' },
      )
    } catch {
      return
    }
    loading.value = true
    try {
      await api.put('/milestones/' + milestone.id, { status: 'completed', actual_end: formatLocalDate() })
      ElMessage.success(milestone.phase_code + ' 已完成')
      await loadSchedule()
    } catch (error: any) {
      ElMessage.error('完成里程碑失败: ' + (error?.message || error))
    } finally {
      loading.value = false
    }
  }

  const loadWeekly = async () => {
    loading.value = true
    try {
      const selectedDate = weeklyWeek.value
      if (!selectedDate) return
      // 2026-11-05（审计 F-01）：本地日期，避免 toISOString 把周一变成周日
      const dateStr = selectedDate instanceof Date ? formatLocalDate(selectedDate) : String(selectedDate).slice(0, 10)
      weeklyData.value = await api.get('/schedule/weekly', { params: { date: dateStr } })
      activeEquipments.value = weeklyEquipments.value.map((equipment: any) => equipment.id || equipment.instance_id)
      refreshAt.value = new Date()
    } catch (error: any) {
      ElMessage.error('加载周调度失败: ' + (error?.message || error))
    } finally {
      loading.value = false
    }
  }

  const goCurrentWeek = () => {
    weeklyWeek.value = new Date()
    loadWeekly()
  }

  const nodeAction = async (row: any, status: string) => {
    loading.value = true
    try {
      const payload: any = { status }
      if (status === 'in_progress') payload.actual_start = new Date().toISOString()
      if (status === 'completed') payload.actual_end = new Date().toISOString()
      await api.put('/schedule/process-nodes/' + row.id + '/status', payload)
      ElMessage.success('工序状态已更新为：' + nodeStatusLabel(status))
      await loadWeekly()
    } catch (error: any) {
      ElMessage.error('更新工序状态失败: ' + (error?.message || error))
    } finally {
      loading.value = false
    }
  }

  const openAssign = async (row: any) => {
    loading.value = true
    try {
      assignRow.value = row
      assignForm.value = {
        assigned_id: row.assigned_id || row.assigned_to || null,
        planned_start: row.planned_start || '',
        planned_end: row.planned_end || '',
        workstation_id: row.workstation_id || row.required_workstation_id || null,
        // 2026-11-05（审计 F-06）：无资质时允许应急强制派工（勾选后重试）
        force: false,
      }
      const [workerResult, workstationResult] = await Promise.all([
        api.get('/resources/workers', { params: { available: 1 } }),
        api.get('/resources/workstations')
      ])
      workers.value = workerResult?.workers || workerResult || []
      workstations.value = workstationResult?.workstations || workstationResult || []
      assignDialogVisible.value = true
    } catch (error: any) {
      ElMessage.error('打开分配对话失败: ' + (error?.message || error))
    } finally {
      loading.value = false
    }
  }

  const submitAssign = async () => {
    loading.value = true
    try {
      if (!assignRow.value) return
      if (!assignForm.value.assigned_id) {
        ElMessage.warning('请选择负责人')
        return
      }
      const result: any = await api.put('/schedule/process-nodes/' + assignRow.value.id + '/assign', {
        user_id: assignForm.value.assigned_id,
        planned_start: assignForm.value.planned_start || null,
        planned_end: assignForm.value.planned_end || null,
        workstation_id: assignForm.value.workstation_id || null,
        force: Boolean((assignForm.value as any).force),
      })
      const missing = result?.validation?.missing
      if (missing?.length) {
        ElMessage.warning('已强制派工，但该人员仍缺：' + missing.slice(0, 2).join('；'))
      } else {
        ElMessage.success('分配成功')
      }
      assignDialogVisible.value = false
      await loadWeekly()
    } catch (error: any) {
      const details = error?.response?.data?.details
      const missing = details?.missing
      if (missing?.length) {
        ElMessage.error('人员资质不满足：' + missing.slice(0, 3).join('；') + '（可勾选「强制派工」）')
      } else {
        ElMessage.error('提交分配失败: ' + (error?.response?.data?.message || error?.message || error))
      }
    } finally {
      loading.value = false
    }
  }

  const onTabChange = (tabName: string) => {
    if (tabName === 'weekly') loadWeekly()
    if (tabName === 'schedule') loadSchedule()
  }

  const load = () => {
    if (activeTab.value === 'weekly') loadWeekly()
    else loadSchedule()
  }

  onMounted(async () => {
    await Promise.all([loadWeekly(), loadSchedule()])
  })

  return {
    activeTab,
    instances,
    selectedInstance,
    milestones,
    filters,
    loading,
    weeklyWeek,
    weeklyData,
    activeEquipments,
    assignDialogVisible,
    assignRow,
    assignForm,
    workers,
    workstations,
    weeklyEquipments,
    weeklySummary,
    msTagType,
    milestoneStatusLabel,
    msProgress,
    nodeStatusTag,
    nodeStatusLabel,
    loadSchedule,
    markActive,
    markComplete,
    loadWeekly,
    goCurrentWeek,
    nodeAction,
    openAssign,
    submitAssign,
    onTabChange,
    load,
    refreshAt,
    batches,
    batchLoading,
    loadBatches,
    undoBatch,
  }
}
