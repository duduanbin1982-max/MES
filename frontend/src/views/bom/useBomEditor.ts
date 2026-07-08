import { ref, type Ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../../api'
import { defaultBomForm, templateDesc } from './bomShared'

type BomEditorDeps = {
  instanceId: Ref<number | null>
  selected: Ref<any | null>
  drillNode: Ref<any | null>
  health: Ref<any>
  templateMeta: Ref<any>
  loadAll: () => Promise<void>
}

export function useBomEditor({ instanceId, selected, drillNode, health, templateMeta, loadAll }: BomEditorDeps) {
  const dlgAdd = ref(false)
  const dlgImport = ref(false)
  const dlgValidate = ref(false)
  const dlgCompare = ref(false)
  const saving = ref(false)
  const importing = ref(false)
  const comparing = ref(false)
  const editingNode = ref<any | null>(null)
  const addForm = ref<any>(defaultForm())
  const csvText = ref('')
  const validateResult = ref<any>(null)
  const compareV1 = ref('A0')
  const compareV2 = ref('A1')
  const compareResult = ref<any>(null)

  function defaultForm() {
    return defaultBomForm()
  }

  function resetAddForm() {
    editingNode.value = null
    addForm.value = defaultForm()
  }

  function onTierChange(tier: number) {
    if (tier === 0) addForm.value.category = '成品'
    else if (tier === 1) addForm.value.category = '自制部件'
    else if (tier === 2) addForm.value.category = '外购成品'
    else if (tier === 3) addForm.value.category = '自制机加件'
  }

  function prefillTier(tier: number) {
    resetAddForm()
    addForm.value.tier = tier
    if (tier === 0) addForm.value.category = '成品'
    if (tier === 1) addForm.value.category = '自制部件'
    if (tier === 2) addForm.value.category = '外购成品'
  }

  function openAddChild(parent: any) {
    resetAddForm()
    editingNode.value = { ...parent, _adding: true }
    addForm.value.parent_id = parent.id
    addForm.value.tier = Math.min(parent.tier + 1, 3)
    onTierChange(addForm.value.tier)
    dlgAdd.value = true
  }

  function openEdit() {
    if (!selected.value) return
    editingNode.value = selected.value
    addForm.value = { ...defaultForm(), ...selected.value }
    dlgAdd.value = true
  }

  async function doSave() {
    saving.value = true
    try {
      if (editingNode.value && !editingNode.value._adding) {
        await api.put(`/bom/${editingNode.value.id}`, addForm.value)
        ElMessage.success(`已更新 #${editingNode.value.id}`)
      } else {
        const result: any = await api.post(`/equipment_instances/${instanceId.value}/bom`, {
          ...addForm.value,
          parent_id: addForm.value.parent_id || null,
        })
        ElMessage.success(`已新增 #${result.id}`)
      }
      dlgAdd.value = false
      await loadAll()
    } catch (error: any) {
      const message = error.response?.data?.message || error.message
      const details = error.response?.data?.details
      ElMessage.error('保存失败: ' + message + (details ? ' ' + JSON.stringify(details) : ''))
    } finally {
      saving.value = false
    }
  }

  async function doDelete(node: any) {
    try {
      await ElMessageBox.confirm(`确认删除节点 #${node.id} "${node.material_name || ''}" 及其所有子节点?`, '危险操作', { type: 'warning' })
      await api.delete(`/bom/${node.id}`)
      ElMessage.success('已删除')
      if (selected.value?.id === node.id) selected.value = null
      if (drillNode.value?.id === node.id) drillNode.value = null
      await loadAll()
    } catch (error: any) {
      if (error !== 'cancel' && error !== 'close') ElMessage.error('删除失败: ' + (error.message || error))
    }
  }

  async function doImport() {
    importing.value = true
    try {
      const result: any = await api.post(`/equipment_instances/${instanceId.value}/bom/import`, { csv: csvText.value })
      ElMessage.success(`导入完成: ${result.inserted} 成功, ${result.errors} 失败`)
      if (result.errors && result.error_list?.length) {
        ElMessage.warning(`前 ${Math.min(result.error_list.length, 30)} 条错误已保留在返回结果中`)
      }
      dlgImport.value = false
      csvText.value = ''
      await loadAll()
    } catch (error: any) {
      ElMessage.error('导入失败: ' + (error.response?.data?.message || error.message))
    } finally {
      importing.value = false
    }
  }

  async function initMinimumBom() {
    if (!instanceId.value) return
    try {
      await ElMessageBox.confirm('将生成 0级整机、1级部件、2级零件/外购件的 BOM 空壳。仅允许在当前实例无 BOM 时执行。', '生成最低三级 BOM 骨架', { type: 'warning' })
      await api.post(`/equipment_instances/${instanceId.value}/bom/init-minimum`)
      ElMessage.success('已生成最低三级 BOM 骨架')
      await loadAll()
    } catch (error: any) {
      if (error !== 'cancel' && error !== 'close') ElMessage.error('生成失败: ' + (error.response?.data?.message || error.message))
    }
  }

  async function doValidate() {
    const result: any = await api.get(`/equipment_instances/${instanceId.value}/bom/validate`)
    validateResult.value = result
    health.value = result.health || health.value
    dlgValidate.value = true
    if (result.ok) ElMessage.success('校验通过')
    else ElMessage.warning(`${result.errors.length} 项错误`)
  }

  async function doCompare() {
    comparing.value = true
    try {
      compareResult.value = await api.get(`/equipment_instances/${instanceId.value}/bom/compare?v1=${compareV1.value}&v2=${compareV2.value}`)
    } catch (error: any) {
      ElMessage.error('对比失败: ' + (error.message || error))
    } finally {
      comparing.value = false
    }
  }

  async function loadTemplate() {
    try {
      templateMeta.value = await api.get(`/equipment_instances/${instanceId.value}/bom/import-template`)
      dlgImport.value = true
    } catch (error: any) {
      ElMessage.error('模板加载失败: ' + (error.message || error))
    }
  }

  function fillTemplate() {
    if (!templateMeta.value.sample_csv) return
    const [header] = templateMeta.value.sample_csv.split('\n')
    csvText.value = header + '\n'
  }

  function fillSample() {
    csvText.value = templateMeta.value.sample_csv || csvText.value
  }

  async function copyTemplate() {
    try {
      await navigator.clipboard.writeText(templateMeta.value.sample_csv || '')
      ElMessage.success('模板已复制')
    } catch (error: any) {
      ElMessage.error('复制失败: ' + (error.message || error))
    }
  }

  return {
    dlgAdd,
    dlgImport,
    dlgValidate,
    dlgCompare,
    saving,
    importing,
    comparing,
    editingNode,
    addForm,
    csvText,
    validateResult,
    compareV1,
    compareV2,
    compareResult,
    defaultForm,
    resetAddForm,
    prefillTier,
    onTierChange,
    openAddChild,
    openEdit,
    doSave,
    doDelete,
    doImport,
    initMinimumBom,
    doValidate,
    doCompare,
    loadTemplate,
    fillTemplate,
    fillSample,
    copyTemplate,
    templateDesc,
  }
}
