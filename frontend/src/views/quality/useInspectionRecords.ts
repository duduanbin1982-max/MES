import { computed, ref, reactive } from 'vue'
import Api from '../../api'
import { ElMessage } from 'element-plus'

const inspectionTypeNames = new Set(['incoming', 'in_process', 'final'])

const defaultInspectionEntry = {
  title: '质检管理',
  subtitle: '检验记录、NCR、CAPA 与模板统一管理',
  badge: '全部质量',
  createLabel: '质检记录',
}

const inspectionEntries = {
  incoming: {
    title: '来料检验',
    subtitle: '供应商来料、外购件和关键件入厂检验视图',
    badge: '入厂质量',
    createLabel: '来料检验记录',
  },
  in_process: {
    title: '过程检验',
    subtitle: '工序、装配、焊接等生产过程检验视图',
    badge: '过程质量',
    createLabel: '过程检验记录',
  },
  final: {
    title: '出厂检验',
    subtitle: '整机调试、终检、客户交付前质量放行视图',
    badge: '出厂质量',
    createLabel: '出厂检验记录',
  },
} as const

export function useInspectionRecords() {
  const filters = reactive({ equipment_instance_id: undefined as any, inspection_type: '', result: '' })
  const routeInspectionType = ref('')
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
    { value: 'in_process', label: '过程检验' },
    { value: 'final', label: '出厂检验' },
    { value: 'pre_shipping', label: '出厂前确认' }
  ]
  const inspectionEntry = computed(() => (
    routeInspectionType.value
      ? inspectionEntries[routeInspectionType.value as keyof typeof inspectionEntries]
      : defaultInspectionEntry
  ))
  const isInspectionTypeScoped = computed(() => Boolean(routeInspectionType.value))
  const typeLabel = (value: string) => types.find(type => type.value === value)?.label || value
  const typeColor = (value: string) => ({ incoming: 'info', in_process: 'primary', final: 'success', pre_shipping: 'warning' }[value] || 'info')
  const defaultInspectionType = () => filters.inspection_type || routeInspectionType.value || 'in_process'

  const applyInspectionTypeFromRoute = (rawType: unknown) => {
    const value = String(rawType || '')
    const nextType = inspectionTypeNames.has(value) ? value : ''
    const changed = routeInspectionType.value !== nextType || filters.inspection_type !== nextType
    routeInspectionType.value = nextType
    if (filters.inspection_type !== nextType) filters.inspection_type = nextType
    return changed
  }

  const openCreateInspection = () => {
    form.inspection_type = defaultInspectionType()
    showCreate.value = true
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
      if (!Array.isArray(users.value) || users.value.length === 0) {
        const userResult: any = await Api.get('/users', { params: { is_active: 1, page_size: 200 } })
        users.value = Array.isArray(userResult) ? userResult : (userResult?.items || [])
      }
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
      Object.assign(form, { equipment_instance_id: undefined, work_order_id: undefined, inspection_type: defaultInspectionType(), result: 'pass', inspector_id: undefined, notes: '' })
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
    inspectionEntry,
    isInspectionTypeScoped,
    typeLabel,
    typeColor,
    applyInspectionTypeFromRoute,
    openCreateInspection,
    load,
    submit,
  }
}
