import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Api } from '../api'
import { useProcessTree } from './useProcessTree.js'
import { processTreePageApi } from '../services/processTreePageApi.js'

const defaultEditForm = (overrides = {}) => ({
  id: null,
  operation_name: '',
  operation_type: 'make',
  estimated_hours: 4,
  required_workstation_id: null,
  required_skill: '',
  operation_template_id: null,
  required_position_code: '',
  worker_count: 1,
  qc_required: false,
  sop_required: false,
  notes: '',
  parent_id: null,
  equipment_instance_id: null,
  subsystem_id: null,
  ...overrides,
})

export function useProcessTreePage() {
  const route = useRoute()
  const instances = ref([])
  const workstations = ref([])
  const users = ref([])
  const operationTemplates = ref([])
  const selectedInstance = ref(undefined)
  const regenerating = ref(false)
  const saving = ref(false)
  const showEdit = ref(false)
  const showAssign = ref(false)
  const showDep = ref(false)
  const showHours = ref(false)
  const hoursSaving = ref(false)
  const currentUserId = ref(null)
  const allExpanded = ref(true)
  const routeGapFilter = ref('all')
  const routeFixing = ref(false)
  const autoBinding = ref(false)

  const subsystems = ref([])
  const uncategorized = ref([])
  const subsystemsList = ref([])
  const componentRoutes = ref([])
  const componentRouteSummary = reactive({
    component_count: 0,
    complete_count: 0,
    missing_route_count: 0,
    missing_hours_count: 0,
    missing_workstation_count: 0,
    total_operations: 0,
    total_estimated_hours: 0,
    total_standard_man_hours: 0,
  })

  const { tree, flat, cpm, progress, loading, criticalSet, load } = useProcessTree(selectedInstance)

  const editForm = reactive(defaultEditForm({ estimated_hours: 0 }))
  const assignForm = reactive({ id: null, assigned_to: null, required_workstation_id: null })
  const depForm = reactive({ successor_id: null, predecessor_id: null, dep_type: 'FS' })
  const hoursForm = reactive({ id: null, operation_name: '', work_type: 'assembly', standard_hours: 8, worker_count: 2, description: '' })
  const filters = reactive({ searchKey: '', workstationId: null, onlyCritical: false, onlyMine: false })

  const selectedInstanceMeta = computed(() => instances.value.find((item) => Number(item.id) === Number(selectedInstance.value)) || null)
  const routeCompletenessPct = computed(() => {
    const total = Number(componentRouteSummary.component_count || 0)
    if (!total) return 0
    return Math.round((Number(componentRouteSummary.complete_count || 0) / total) * 100)
  })
  const hasRouteGaps = computed(() => (
    Number(componentRouteSummary.missing_route_count || 0) +
    Number(componentRouteSummary.missing_hours_count || 0) +
    Number(componentRouteSummary.missing_workstation_count || 0)
  ) > 0)
  const filteredComponentRoutes = computed(() => componentRoutes.value.filter((row) => {
    if (routeGapFilter.value === 'complete') return row.ok
    if (routeGapFilter.value === 'missing_route') return row.missing?.includes('未建立工序')
    if (routeGapFilter.value === 'missing_hours') return row.missing?.some((item) => item.includes('标准工时'))
    if (routeGapFilter.value === 'missing_workstation') return row.missing?.some((item) => item.includes('工位'))
    return true
  }))

  const loadComponentRoutes = async () => {
    if (!selectedInstance.value) return
    try {
      const data = await processTreePageApi.loadComponentRoutes(selectedInstance.value)
      componentRoutes.value = data.components || []
      Object.assign(componentRouteSummary, data.summary || {})
    } catch (error) {
      console.error('[loadComponentRoutes]', error)
      ElMessage.warning('部件工艺路线加载失败: ' + error.message)
    }
  }

  const loadSubsystems = async () => {
    if (!selectedInstance.value) return
    try {
      const data = await processTreePageApi.loadSubsystems(selectedInstance.value)
      subsystems.value = data.subsystems || []
      uncategorized.value = data.uncategorized || []
    } catch (error) {
      console.error('[loadSubsystems]', error)
      ElMessage.error('子系统数据加载失败: ' + error.message)
    }
  }

  const reloadAll = async () => {
    await load()
    await loadSubsystems()
    await loadComponentRoutes()
  }

  const loadProcessMasterOptions = async () => {
    try {
      operationTemplates.value = await processTreePageApi.loadOperationTemplates()
    } catch (error) {
      console.error('[loadProcessMasterOptions]', error)
    }
  }

  const loadSubsystemsList = async () => {
    try {
      subsystemsList.value = await processTreePageApi.loadSubsystemsList()
    } catch (error) {
      console.error('[loadSubsystemsList]', error)
    }
  }

  const toggleExpandAll = () => {
    allExpanded.value = !allExpanded.value
  }

  const flashElement = (element, className = 'focus-flash') => {
    if (!element) return false
    element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    element.classList.add(className)
    window.setTimeout(() => element.classList.remove(className), 1600)
    return true
  }

  const scrollToCard = (subsystemId) => {
    const key = subsystemId == null ? 'uncategorized' : String(subsystemId)
    const element = document.querySelector(`.subsystem-card[data-subsystem-id="${key}"]`)
    if (!flashElement(element)) ElMessage.info('没有找到对应子系统卡片')
  }

  const focusProcessNode = (nodeId) => {
    const element = document.querySelector(`.node-row[data-node-id="${nodeId}"]`)
    if (!flashElement(element, 'node-flash')) ElMessage.info('该工序节点当前不在可见筛选结果中')
  }

  const focusComponentRoute = (row) => {
    const firstOperation = row.operations?.[0]
    if (!firstOperation) {
      ElMessage.info('该部件尚未生成工序，可点击“生成缺失工序”')
      return
    }
    focusProcessNode(firstOperation.id)
  }

  const generateMissingRoutes = async () => {
    if (!selectedInstance.value) return
    routeFixing.value = true
    try {
      const created = await processTreePageApi.generateMissingRoutes(selectedInstance.value)
      ElMessage.success(`已生成 ${created} 条缺失工序`)
      await reloadAll()
    } catch (error) {
      ElMessage.error('生成缺失工序失败: ' + error.message)
    } finally {
      routeFixing.value = false
    }
  }

  const autoBindRoutes = async () => {
    if (!selectedInstance.value) return
    autoBinding.value = true
    try {
      const changed = await processTreePageApi.autoBindRoutes(selectedInstance.value)
      ElMessage.success(`已自动补齐 ${changed} 个节点的工位/技能`)
      await reloadAll()
    } catch (error) {
      ElMessage.error('自动绑定失败: ' + error.message)
    } finally {
      autoBinding.value = false
    }
  }

  const regenerate = async () => {
    try {
      await ElMessageBox.confirm('重新生成会清空现有工艺树, 确认?', '警告', { type: 'warning' })
    } catch {
      return
    }
    regenerating.value = true
    try {
      await processTreePageApi.regenerate(selectedInstance.value)
      ElMessage.success('已重新生成')
      await reloadAll()
    } catch (error) {
      ElMessage.error('重新生成失败: ' + error.message)
    } finally {
      regenerating.value = false
    }
  }

  const onAddRoot = () => {
    Object.assign(editForm, defaultEditForm({ equipment_instance_id: selectedInstance.value }))
    showEdit.value = true
  }

  const onStart = async (node) => {
    try {
      await processTreePageApi.executeNode(node.id, { action: 'start', operator_id: currentUserId.value || 4 })
      ElMessage.success('已开始 #' + node.id)
      await reloadAll()
    } catch (error) {
      ElMessage.error('开始失败: ' + error.message)
    }
  }

  const onComplete = async (node) => {
    try {
      await processTreePageApi.executeNode(node.id, { action: 'complete', operator_id: currentUserId.value || 4, hours_worked: node.estimated_hours || 0 })
      ElMessage.success('已完成 #' + node.id)
      await reloadAll()
    } catch (error) {
      ElMessage.error('完成失败: ' + error.message)
    }
  }

  const onCmd = async (cmd, node) => {
    if (cmd === 'edit') {
      Object.assign(editForm, {
        id: node.id,
        operation_name: node.operation_name,
        operation_type: node.operation_type,
        estimated_hours: node.estimated_hours,
        required_workstation_id: node.required_workstation_id,
        required_skill: node.required_skill,
        operation_template_id: node.operation_template_id ?? null,
        required_position_code: node.required_position_code || '',
        worker_count: node.worker_count || 1,
        qc_required: !!node.qc_required,
        sop_required: !!node.sop_required,
        notes: node.notes,
        parent_id: node.parent_id,
        equipment_instance_id: node.equipment_instance_id,
        subsystem_id: node.subsystem_id ?? null,
      })
      showEdit.value = true
    } else if (cmd === 'assign') {
      Object.assign(assignForm, { id: node.id, assigned_to: node.assigned_to, required_workstation_id: node.required_workstation_id })
      showAssign.value = true
    } else if (cmd === 'hours') {
      Object.assign(hoursForm, { id: node.id, operation_name: node.operation_name || node.material_name, work_type: 'assembly', standard_hours: node.estimated_hours || 8, worker_count: 2, description: '' })
      showHours.value = true
    } else if (cmd === 'addchild') {
      Object.assign(editForm, defaultEditForm({ parent_id: node.id, equipment_instance_id: selectedInstance.value, subsystem_id: node.subsystem_id ?? null }))
      showEdit.value = true
    } else if (cmd === 'adddep') {
      Object.assign(depForm, { successor_id: node.id, predecessor_id: null, dep_type: 'FS' })
      showDep.value = true
    } else if (cmd === 'delete') {
      try {
        await ElMessageBox.confirm('确认删除 #' + node.id + '?', '确认', { type: 'warning' })
      } catch {
        return
      }
      try {
        await processTreePageApi.deleteNode(node.id)
        ElMessage.success('已删除 #' + node.id)
        await reloadAll()
      } catch (error) {
        ElMessage.error('删除失败: ' + error.message)
      }
    }
  }

  const saveNode = async () => {
    if (!editForm.operation_name) {
      ElMessage.warning('请填写操作名')
      return
    }
    saving.value = true
    try {
      await processTreePageApi.saveNode(editForm)
      ElMessage.success('已保存')
      showEdit.value = false
      await reloadAll()
    } catch (error) {
      ElMessage.error('保存失败: ' + error.message)
    } finally {
      saving.value = false
    }
  }

  const saveAssign = async () => {
    try {
      await processTreePageApi.assignNode(assignForm)
      ElMessage.success('已分配')
      showAssign.value = false
      await reloadAll()
    } catch (error) {
      ElMessage.error('分配失败: ' + error.message)
    }
  }

  const saveDep = async () => {
    if (!depForm.predecessor_id) {
      ElMessage.warning('请选前置节点')
      return
    }
    try {
      await processTreePageApi.saveDependency(selectedInstance.value, depForm)
      ElMessage.success('依赖已加')
      showDep.value = false
      await reloadAll()
    } catch (error) {
      ElMessage.error('加依赖失败: ' + error.message)
    }
  }

  const saveHours = async () => {
    hoursSaving.value = true
    try {
      await processTreePageApi.saveHours(hoursForm)
      ElMessage.success('工时定额已保存')
      showHours.value = false
      await reloadAll()
    } catch (error) {
      ElMessage.error('保存失败: ' + error.message)
    } finally {
      hoursSaving.value = false
    }
  }

  const onNodeDropped = async ({ node_id, node_name, to_subsystem_id, to_subsystem_name }) => {
    try {
      await ElMessageBox.confirm(
        `确认将「${node_name} (#${node_id})」移到「${to_subsystem_name || '未分类'}」？`,
        '拖放改归属',
        { type: 'warning', confirmButtonText: '确认移动', cancelButtonText: '取消' },
      )
    } catch {
      return
    }
    try {
      await processTreePageApi.moveNodeSubsystem(node_id, to_subsystem_id)
      ElMessage.success(`#${node_id} 已移到「${to_subsystem_name || '未分类'}」`)
      await reloadAll()
    } catch (error) {
      console.error('[onNodeDropped]', error)
      ElMessage.error('移动失败: ' + error.message)
    }
  }

  const onMindmapNavigate = (nav) => {
    console.log('[mindmap navigate]', nav)
  }

  onMounted(async () => {
    instances.value = await Api.instances()
    if (instances.value.length > 0) {
      const routeInstanceId = Number(route.query.instance_id || route.query.equipment_instance_id || 0)
      const routed = instances.value.find((item) => Number(item.id) === routeInstanceId)
      selectedInstance.value = routed?.id || instances.value[0].id
    }
    try {
      const me = await Api.me?.()
      if (me && me.id) currentUserId.value = me.id
    } catch {
      // Api.me fallback
    }
    const [loadedWorkstations, loadedUsers] = await Promise.all([
      Api.workstations().catch(() => []),
      Api.users().catch(() => []),
    ])
    workstations.value = loadedWorkstations || []
    users.value = loadedUsers || []
    await Promise.all([loadSubsystemsList(), loadProcessMasterOptions()])
    if (selectedInstance.value) await reloadAll()
  })

  return {
    allExpanded,
    assignForm,
    autoBindRoutes,
    autoBinding,
    componentRouteSummary,
    cpm,
    criticalSet,
    currentUserId,
    depForm,
    editForm,
    filteredComponentRoutes,
    filters,
    flat,
    focusComponentRoute,
    focusProcessNode,
    generateMissingRoutes,
    hasRouteGaps,
    hoursForm,
    hoursSaving,
    instances,
    loadComponentRoutes,
    loading,
    onAddRoot,
    onCmd,
    onComplete,
    onMindmapNavigate,
    onNodeDropped,
    onStart,
    operationTemplates,
    progress,
    regenerate,
    regenerating,
    reloadAll,
    routeCompletenessPct,
    routeFixing,
    routeGapFilter,
    saveAssign,
    saveDep,
    saveHours,
    saveNode,
    saving,
    scrollToCard,
    selectedInstance,
    selectedInstanceMeta,
    showAssign,
    showDep,
    showEdit,
    showHours,
    subsystems,
    subsystemsList,
    toggleExpandAll,
    tree,
    uncategorized,
    users,
    workstations,
  }
}
