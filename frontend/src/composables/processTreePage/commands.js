import { ElMessage, ElMessageBox } from 'element-plus'
import { processTreePageApi } from '../../services/processTreePageApi.js'
import { defaultEditForm } from './state.js'

export function useProcessTreePageCommands({ state, reloadAll }) {
  const generateMissingRoutes = async () => {
    if (!state.selectedInstance.value) return
    state.routeFixing.value = true
    try {
      const created = await processTreePageApi.generateMissingRoutes(state.selectedInstance.value)
      ElMessage.success(`已生成 ${created} 条缺失工序`)
      await reloadAll()
    } catch (error) {
      ElMessage.error('生成缺失工序失败: ' + error.message)
    } finally {
      state.routeFixing.value = false
    }
  }

  const autoBindRoutes = async () => {
    if (!state.selectedInstance.value) return
    state.autoBinding.value = true
    try {
      const changed = await processTreePageApi.autoBindRoutes(state.selectedInstance.value)
      ElMessage.success(`已自动补齐 ${changed} 个节点的工位/技能`)
      await reloadAll()
    } catch (error) {
      ElMessage.error('自动绑定失败: ' + error.message)
    } finally {
      state.autoBinding.value = false
    }
  }

  const regenerate = async () => {
    try {
      await ElMessageBox.confirm('按 BOM 部件与工序模板补齐缺失工序（已存在的节点保留，不会清空），确认?', '从 BOM 补齐', { type: 'info' })
    } catch {
      return
    }
    state.regenerating.value = true
    try {
      const created = await processTreePageApi.generateMissingRoutes(state.selectedInstance.value)
      ElMessage.success(created > 0 ? `已补齐 ${created} 条缺失工序` : '没有需要补齐的工序')
      await reloadAll()
    } catch (error) {
      ElMessage.error('从 BOM 补齐失败: ' + error.message)
    } finally {
      state.regenerating.value = false
    }
  }

  const onAddRoot = () => {
    Object.assign(state.editForm, defaultEditForm({ equipment_instance_id: state.selectedInstance.value }))
    state.showEdit.value = true
  }

  const onStart = async (node) => {
    try {
      await processTreePageApi.executeNode(node.id, { action: 'start', operator_id: state.currentUserId.value || 4 })
      ElMessage.success('已开始 #' + node.id)
      await reloadAll()
    } catch (error) {
      ElMessage.error('开始失败: ' + error.message)
    }
  }

  const onComplete = async (node) => {
    try {
      await processTreePageApi.executeNode(node.id, { action: 'complete', operator_id: state.currentUserId.value || 4, hours_worked: node.estimated_hours || 0 })
      ElMessage.success('已完成 #' + node.id)
      await reloadAll()
    } catch (error) {
      ElMessage.error('完成失败: ' + error.message)
    }
  }

  const onCmd = async (command, node) => {
    if (command === 'edit') {
      Object.assign(state.editForm, {
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
      state.showEdit.value = true
    } else if (command === 'assign') {
      Object.assign(state.assignForm, { id: node.id, assigned_to: node.assigned_to, required_workstation_id: node.required_workstation_id })
      state.showAssign.value = true
    } else if (command === 'hours') {
      Object.assign(state.hoursForm, { id: node.id, operation_name: node.operation_name || node.material_name, work_type: 'assembly', standard_hours: node.estimated_hours || 8, worker_count: 2, description: '' })
      state.showHours.value = true
    } else if (command === 'addchild') {
      Object.assign(state.editForm, defaultEditForm({ parent_id: node.id, equipment_instance_id: state.selectedInstance.value, subsystem_id: node.subsystem_id ?? null }))
      state.showEdit.value = true
    } else if (command === 'adddep') {
      Object.assign(state.depForm, { successor_id: node.id, predecessor_id: null, dep_type: 'FS' })
      state.showDep.value = true
    } else if (command === 'delete') {
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
    if (!state.editForm.operation_name) {
      ElMessage.warning('请填写操作名')
      return
    }
    state.saving.value = true
    try {
      await processTreePageApi.saveNode(state.editForm)
      ElMessage.success('已保存')
      state.showEdit.value = false
      await reloadAll()
    } catch (error) {
      ElMessage.error('保存失败: ' + error.message)
    } finally {
      state.saving.value = false
    }
  }

  const saveAssign = async () => {
    try {
      await processTreePageApi.assignNode(state.assignForm)
      ElMessage.success('已分配')
      state.showAssign.value = false
      await reloadAll()
    } catch (error) {
      ElMessage.error('分配失败: ' + error.message)
    }
  }

  const saveDep = async () => {
    if (!state.depForm.predecessor_id) {
      ElMessage.warning('请选前置节点')
      return
    }
    try {
      await processTreePageApi.saveDependency(state.selectedInstance.value, state.depForm)
      ElMessage.success('依赖已加')
      state.showDep.value = false
      await reloadAll()
    } catch (error) {
      ElMessage.error('加依赖失败: ' + error.message)
    }
  }

  const saveHours = async () => {
    state.hoursSaving.value = true
    try {
      await processTreePageApi.saveHours(state.hoursForm)
      ElMessage.success('工时定额已保存')
      state.showHours.value = false
      await reloadAll()
    } catch (error) {
      ElMessage.error('保存失败: ' + error.message)
    } finally {
      state.hoursSaving.value = false
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

  return {
    autoBindRoutes,
    generateMissingRoutes,
    onAddRoot,
    onCmd,
    onComplete,
    onNodeDropped,
    onStart,
    regenerate,
    saveAssign,
    saveDep,
    saveHours,
    saveNode,
  }
}
