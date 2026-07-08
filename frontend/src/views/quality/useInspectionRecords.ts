import { ref, reactive } from 'vue'
import Api from '../../api'
import { ElMessage } from 'element-plus'

const inspectionTypeNames = new Set(['incoming', 'in_process', 'final'])

export function useInspectionRecords() {
  const filters = reactive({ equipment_instance_id: undefined as any, inspection_type: '', result: '' })
  const rows = ref<any[]>([])
  const stats = ref<any>({ total: 0, pass: 0, fail: 0, pass_rate: 0 })
  const instances = ref<any[]>([])
  const workOrders = ref<any[]>([])
  const users = ref<any[]>([])
  const loading = ref(false)
  const showCreate = ref(false)
  const submitting = ref(false)
  const form = reactive({
    equipment_instance_id: undefined as any,
    work_order_id: undefined as any,
    inspection_type: 'in_process',
    result: 'pass',
    inspector_id: undefined as any,
    notes: ''
  })

  const types = [
    { value: 'incoming', label: '来料检验' },
    { value: 'in_process', label: '工序检验' },
    { value: 'final', label: '终检' },
    { value: 'pre_shipping', label: '出厂前' }
  ]
  const typeLabel = (value: string) => types.find(type => type.value === value)?.label || value
  const typeColor = (value: string) => ({ incoming: 'info', in_process: 'primary', final: 'success', pre_shipping: 'warning' }[value] || 'info')

  const applyInspectionTypeFromRoute = (rawType: unknown) => {
    const value = String(rawType || '')
    if (!inspectionTypeNames.has(value) || filters.inspection_type === value) return false
    filters.inspection_type = value
    return true
  }

  const load = async () => {
    loading.value = true
    try {
      const params: any = {}
      if (filters.equipment_instance_id) params.equipment_instance_id = filters.equipment_instance_id
      if (filters.inspection_type) params.inspection_type = filters.inspection_type
      if (filters.result) params.result = filters.result
      rows.value = await Api.get('/qc_inspections', { params })
      if (instances.value.length === 0) instances.value = await Api.get('/equipment_instances')
      if (workOrders.value.length === 0) workOrders.value = await Api.get('/work_orders')
      if (users.value.length === 0) users.value = await Api.get('/users')
      stats.value = await Api.get('/qc/stats')
    } finally {
      loading.value = false
    }
  }

  const submit = async () => {
    if (!form.equipment_instance_id) { ElMessage.warning('请选实例'); return }
    submitting.value = true
    try {
      await Api.post('/qc_inspections', form)
      ElMessage.success('已保存')
      showCreate.value = false
      Object.assign(form, { equipment_instance_id: undefined, work_order_id: undefined, inspection_type: 'in_process', result: 'pass', inspector_id: undefined, notes: '' })
      await load()
    } catch {
      ElMessage.error('失败')
    } finally {
      submitting.value = false
    }
  }

  return {
    filters,
    rows,
    stats,
    instances,
    workOrders,
    users,
    loading,
    showCreate,
    submitting,
    form,
    types,
    typeLabel,
    typeColor,
    applyInspectionTypeFromRoute,
    load,
    submit,
  }
}
