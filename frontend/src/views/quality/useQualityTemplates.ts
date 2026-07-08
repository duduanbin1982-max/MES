import { ref, reactive } from 'vue'
import Api from '../../api'
import { ElMessage } from 'element-plus'

export function useQualityTemplates() {
  const templateRows = ref<any[]>([])
  const templateLoading = ref(false)
  const showTemplateCreate = ref(false)
  const templateSubmitting = ref(false)
  const templateForm = reactive({ template_name: '', equipment_type: '', category: '', check_items: '' })
  const equipmentTypes = ref<string[]>(['CNC机床', '注塑机', '冲压机', '焊接机', '装配线', '检测设备'])
  const showTemplateItems = ref(false)
  const templateItemsTemplate = ref<any>(null)
  const templateItemsList = ref<{ name: string }[]>([])

  const loadTemplates = async () => {
    templateLoading.value = true
    try { templateRows.value = await Api.get('/qc/inspection-templates') } catch { templateRows.value = [] }
    finally { templateLoading.value = false }
  }

  const submitTemplate = async () => {
    if (!templateForm.template_name) { ElMessage.warning('请输入模板名称'); return }
    templateSubmitting.value = true
    try {
      const items = templateForm.check_items.split('\n').filter((line: string) => line.trim())
      await Api.post('/qc/inspection-templates', {
        template_name: templateForm.template_name,
        equipment_type: templateForm.equipment_type,
        category: templateForm.category,
        check_items: items
      })
      ElMessage.success('模板已创建')
      showTemplateCreate.value = false
      Object.assign(templateForm, { template_name: '', equipment_type: '', category: '', check_items: '' })
      await loadTemplates()
    } catch {
      ElMessage.error('创建失败')
    } finally {
      templateSubmitting.value = false
    }
  }

  const viewTemplateItems = (row: any) => {
    templateItemsTemplate.value = row
    templateItemsList.value = (row.check_items || []).map((name: string) => ({ name }))
    showTemplateItems.value = true
  }

  return {
    templateRows,
    templateLoading,
    showTemplateCreate,
    templateSubmitting,
    templateForm,
    equipmentTypes,
    showTemplateItems,
    templateItemsTemplate,
    templateItemsList,
    loadTemplates,
    submitTemplate,
    viewTemplateItems,
  }
}
