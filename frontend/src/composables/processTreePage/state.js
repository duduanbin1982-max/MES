import { computed, reactive, ref } from 'vue'

export const defaultEditForm = (overrides = {}) => ({
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

export function createProcessTreePageState() {
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

  return {
    allExpanded,
    assignForm,
    autoBinding,
    componentRoutes,
    componentRouteSummary,
    currentUserId,
    depForm,
    editForm,
    filteredComponentRoutes,
    filters,
    hasRouteGaps,
    hoursForm,
    hoursSaving,
    instances,
    operationTemplates,
    regenerating,
    routeCompletenessPct,
    routeFixing,
    routeGapFilter,
    saving,
    selectedInstance,
    selectedInstanceMeta,
    showAssign,
    showDep,
    showEdit,
    showHours,
    subsystems,
    subsystemsList,
    uncategorized,
    users,
    workstations,
  }
}
