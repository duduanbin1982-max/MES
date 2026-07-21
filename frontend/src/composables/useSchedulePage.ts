import { ref, onMounted, computed } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'

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

  const nodeStatusTag = (status: string) => {
    const map: Record<string, string> = { completed: 'success', in_progress: 'warning', pending: 'info', delayed: 'danger', blocked: 'danger' }
    return map[status] || 'info'
  }

  const nodeStatusLabel = (status: string) => {
    const map: Record<string, string> = { completed: '已完成', in_progress: '进行中', pending: '待开始', delayed: '延期', blocked: '阻塞' }
    return map[status] || status || '待开始'
  }

  const loadSchedule = async () => {
    loading.value = true
    try {
      if (instances.value.length === 0) instances.value = await api.get('/equipment_instances')
      if (selectedInstance.value) {
        milestones.value = await api.get('/equipment_instances/' + selectedInstance.value + '/milestones')
      }
    } catch (error: any) {
      ElMessage.error('加载调度数据失败: ' + (error?.message || error))
    } finally {
      loading.value = false
    }
  }

  const markActive = async (milestone: any) => {
    loading.value = true
    try {
      await api.put('/milestones/' + milestone.id, { status: 'active', actual_start: new Date().toISOString().slice(0, 10) })
      ElMessage.success(milestone.phase_code + ' 已开始')
      await loadSchedule()
    } catch (error: any) {
      ElMessage.error('激活里程碑失败: ' + (error?.message || error))
    } finally {
      loading.value = false
    }
  }

  const markComplete = async (milestone: any) => {
    loading.value = true
    try {
      await api.put('/milestones/' + milestone.id, { status: 'completed', actual_end: new Date().toISOString().slice(0, 10) })
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
      const dateStr = selectedDate instanceof Date ? selectedDate.toISOString().slice(0, 10) : String(selectedDate).slice(0, 10)
      weeklyData.value = await api.get('/schedule/weekly', { params: { date: dateStr } })
      activeEquipments.value = weeklyEquipments.value.map((equipment: any) => equipment.id || equipment.instance_id)
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
        workstation_id: row.workstation_id || row.required_workstation_id || null
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
      await api.put('/schedule/process-nodes/' + assignRow.value.id + '/assign', {
        user_id: assignForm.value.assigned_id,
        planned_start: assignForm.value.planned_start || null,
        planned_end: assignForm.value.planned_end || null,
        workstation_id: assignForm.value.workstation_id || null
      })
      ElMessage.success('分配成功')
      assignDialogVisible.value = false
      await loadWeekly()
    } catch (error: any) {
      ElMessage.error('提交分配失败: ' + (error?.message || error))
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
  }
}
