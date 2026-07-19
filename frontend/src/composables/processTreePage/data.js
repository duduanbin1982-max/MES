import { onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Api } from '../../api'
import { processTreePageApi } from '../../services/processTreePageApi.js'

export function useProcessTreePageData({ route, state, load }) {
  const loadComponentRoutes = async () => {
    if (!state.selectedInstance.value) return
    try {
      const data = await processTreePageApi.loadComponentRoutes(state.selectedInstance.value)
      state.componentRoutes.value = data.components || []
      Object.assign(state.componentRouteSummary, data.summary || {})
    } catch (error) {
      console.error('[loadComponentRoutes]', error)
      ElMessage.warning('部件工艺路线加载失败: ' + error.message)
    }
  }

  const loadSubsystems = async () => {
    if (!state.selectedInstance.value) return
    try {
      const data = await processTreePageApi.loadSubsystems(state.selectedInstance.value)
      state.subsystems.value = data.subsystems || []
      state.uncategorized.value = data.uncategorized || []
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
      state.operationTemplates.value = await processTreePageApi.loadOperationTemplates()
    } catch (error) {
      console.error('[loadProcessMasterOptions]', error)
    }
  }

  const loadSubsystemsList = async () => {
    try {
      state.subsystemsList.value = await processTreePageApi.loadSubsystemsList()
    } catch (error) {
      console.error('[loadSubsystemsList]', error)
    }
  }

  onMounted(async () => {
    state.instances.value = await Api.instances()
    if (state.instances.value.length > 0) {
      const routeInstanceId = Number(route.query.instance_id || route.query.equipment_instance_id || 0)
      const routed = state.instances.value.find((item) => Number(item.id) === routeInstanceId)
      state.selectedInstance.value = routed?.id || state.instances.value[0].id
    }
    try {
      const me = await Api.me?.()
      if (me && me.id) state.currentUserId.value = me.id
    } catch {
      // Api.me fallback
    }
    const [loadedWorkstations, loadedUsers] = await Promise.all([
      Api.workstations().catch(() => []),
      Api.users().catch(() => []),
    ])
    state.workstations.value = loadedWorkstations || []
    state.users.value = loadedUsers || []
    await Promise.all([loadSubsystemsList(), loadProcessMasterOptions()])
    if (state.selectedInstance.value) await reloadAll()
  })

  return { loadComponentRoutes, reloadAll }
}
