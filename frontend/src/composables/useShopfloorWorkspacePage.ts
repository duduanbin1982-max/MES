import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Api } from '../api'

export function useShopfloorWorkspacePage() {

  const route = useRoute()
  const router = useRouter()
  const loading = ref(false)
  const saving = ref(false)
  const activeTab = ref('scan')
  const summary = reactive<any>({})
  const workOrders = ref<any[]>([])
  const pendingDocs = ref<any[]>([])
  const scanCode = ref('')
  const scanResult = ref<any | null>(null)
  const currentWo = ref<any | null>(null)
  const reportVisible = ref(false)
  const qcVisible = ref(false)
  const pickVisible = ref(false)
  const pickLoading = ref(false)
  const pickSubmitting = ref(false)
  const pickList = ref<any | null>(null)
  const pickHistory = ref<any[]>([])
  const pickQuantities = reactive<Record<number, number>>({})
  const returnQuantities = reactive<Record<number, number>>({})
  const reportForm = reactive({ hours_spent: 1, quantity_completed: 1, quality_result: 'pass' })
  const qcForm = reactive({ inspection_type: 'in_process', result: 'pass', notes: '' })
  const andonForm = reactive({ title: '', message: '' })

  const currentUser = computed(() => {
    try { return JSON.parse(localStorage.getItem('tbm_user') || '{}') } catch { return {} }
  })
  const roleCode = computed(() => String(currentUser.value.role || currentUser.value.role_code || '').toLowerCase())
  const roleLabel = computed(() => {
    const map: any = { admin: '管理员', foreman: '车间主任', worker: '工人', welder: '焊工', qc: '质检员', warehouse: '仓库员', storekeeper: '仓库员', material: '仓库员' }
    return map[roleCode.value] || currentUser.value.role_name || '现场人员'
  })

  function defaultTabByRole(role: string) {
    if (['warehouse', 'storekeeper', 'material', 'inventory'].includes(role)) return 'pick'
    if (role === 'qc' || role.includes('quality')) return 'qc'
    if (role === 'worker' || role === 'welder' || role === 'foreman') return 'scan'
    return 'scan'
  }

  function applyDefaultTab() {
    const urlTab = typeof route.query.tab === 'string' ? route.query.tab : ''
    activeTab.value = urlTab || defaultTabByRole(roleCode.value)
  }

  watch(activeTab, (value) => {
    if (route.query.tab !== value) router.replace({ query: { ...route.query, tab: value } })
  })

  watch(() => route.query.tab, () => {
    const next = typeof route.query.tab === 'string' ? route.query.tab : defaultTabByRole(roleCode.value)
    if (next !== activeTab.value) activeTab.value = next
  })

  function go(path: string) { router.push(path) }

  async function loadAll() {
    loading.value = true
    try {
      const data: any = await Api.shopfloorOverview()
      Object.assign(summary, data.summary || {})
      workOrders.value = data.work_orders || []
      pendingDocs.value = data.pending_documents || []
    } finally { loading.value = false }
  }

  async function lookupScan() {
    if (!scanCode.value) return
    scanResult.value = await Api.get('/scan/lookup', { params: { code: scanCode.value } })
  }

  async function executeScan(action: string) {
    if (!scanCode.value) return
    saving.value = true
    try {
      await Api.post('/scan/execute', { code: scanCode.value, action, quantity_completed: 1, hours_worked: 1 })
      ElMessage.success('已记录')
      await loadAll()
    } finally { saving.value = false }
  }

  async function openPick(wo: any) {
    currentWo.value = wo
    pickVisible.value = true
    await refreshPick()
  }

  async function refreshPick() {
    if (!currentWo.value) return
    pickLoading.value = true
    try {
      const [list, history] = await Promise.all([
        Api.get(`/work_orders/${currentWo.value.id}/pick-list`),
        Api.get(`/work_orders/${currentWo.value.id}/pick-history`).catch(() => ({ movements: [] })),
      ])
      pickList.value = list
      pickHistory.value = history.movements || []
      Object.keys(pickQuantities).forEach(key => delete pickQuantities[Number(key)])
      Object.keys(returnQuantities).forEach(key => delete returnQuantities[Number(key)])
      for (const item of list.items || []) pickQuantities[item.material_id] = 0
      for (const lot of list.returnable_lots || []) returnQuantities[lot.lot_id] = 0
    } finally {
      pickLoading.value = false
    }
  }

  function pickStatusType(status: string) {
    return ({ ready: 'success', short: 'warning', empty: 'danger', done: 'info' } as any)[status] || 'info'
  }

  function pickStatusLabel(status: string) {
    return ({ ready: '可领', short: '部分', empty: '缺料', done: '已领完' } as any)[status] || status
  }

  function fillSuggestedPick() {
    for (const item of pickList.value?.items || []) {
      pickQuantities[item.material_id] = Number(item.suggested_pick_qty || 0)
    }
  }

  function allocationsForQty(row: any, quantity: number) {
    let remaining = Number(quantity || 0)
    const allocations = []
    for (const allocation of row.suggested_allocations || []) {
      if (remaining <= 0) break
      const qty = Math.min(remaining, Number(allocation.quantity || 0))
      if (qty > 0) allocations.push({ lot_id: allocation.lot_id, location: allocation.location, quantity: qty })
      remaining -= qty
    }
    return allocations
  }

  async function submitPick() {
    if (!currentWo.value || !pickList.value) return
    const items = (pickList.value.items || [])
      .map((row: any) => {
        const quantity = Number(pickQuantities[row.material_id] || 0)
        return quantity > 0 ? { material_id: row.material_id, quantity, allocations: allocationsForQty(row, quantity) } : null
      })
      .filter(Boolean)
    if (!items.length) { ElMessage.warning('请填写本次领料数量'); return }
    pickSubmitting.value = true
    try {
      const result: any = await Api.post(`/work_orders/${currentWo.value.id}/pick`, { items })
      if (result.errors) ElMessage.warning(`领料完成 ${result.picked || 0} 项，失败 ${result.errors} 项`)
      else ElMessage.success('领料成功')
      await refreshPick()
      await loadAll()
    } finally {
      pickSubmitting.value = false
    }
  }

  async function submitReturn(row: any) {
    if (!currentWo.value) return
    const quantity = Number(returnQuantities[row.lot_id] || 0)
    if (quantity <= 0) { ElMessage.warning('请填写退料数量'); return }
    pickSubmitting.value = true
    try {
      const result: any = await Api.post(`/work_orders/${currentWo.value.id}/return`, {
        items: [{ lot_id: row.lot_id, quantity, reason: '车间余料退库' }],
      })
      if (result.errors) ElMessage.warning(`退料完成 ${result.returned || 0} 项，失败 ${result.errors} 项`)
      else ElMessage.success('退料成功')
      await refreshPick()
      await loadAll()
    } finally {
      pickSubmitting.value = false
    }
  }

  function openReport(wo: any) {
    currentWo.value = wo
    Object.assign(reportForm, { hours_spent: 1, quantity_completed: 1, quality_result: 'pass' })
    reportVisible.value = true
  }

  async function submitReport() {
    if (!currentWo.value) return
    saving.value = true
    try {
      await Api.post('/work-reports', { work_order_id: currentWo.value.id, worker_id: 1, ...reportForm })
      ElMessage.success('报工已提交')
      reportVisible.value = false
      await loadAll()
    } finally { saving.value = false }
  }

  function openQc(wo: any) {
    currentWo.value = wo
    Object.assign(qcForm, { inspection_type: 'in_process', result: 'pass', notes: '' })
    qcVisible.value = true
  }

  async function submitQc() {
    if (!currentWo.value) return
    saving.value = true
    try {
      await Api.post('/qc_inspections', {
        equipment_instance_id: currentWo.value.equipment_instance_id,
        work_order_id: currentWo.value.id,
        ...qcForm,
      })
      ElMessage.success('质检已提交')
      qcVisible.value = false
      await loadAll()
    } finally { saving.value = false }
  }

  async function ackDoc(doc: any) {
    await Api.acknowledgeDocument(doc.id)
    ElMessage.success('已签收')
    await loadAll()
  }

  function downloadDoc(doc: any) {
    window.open(Api.documentDownloadUrl(doc.id), '_blank')
  }

  async function raiseException() {
    if (!andonForm.title) { ElMessage.warning('请填写异常标题'); return }
    saving.value = true
    try {
      await Api.post('/exceptions/shopfloor_manual/action', { action: 'comment', status: 'open', note: `${andonForm.title}：${andonForm.message || ''}` })
      ElMessage.success('异常已上报到异常中心')
      Object.assign(andonForm, { title: '', message: '' })
      await loadAll()
    } finally { saving.value = false }
  }

  onMounted(async () => { applyDefaultTab(); await loadAll() })

  return {
    route,
    router,
    loading,
    saving,
    activeTab,
    summary,
    workOrders,
    pendingDocs,
    scanCode,
    scanResult,
    currentWo,
    reportVisible,
    qcVisible,
    pickVisible,
    pickLoading,
    pickSubmitting,
    pickList,
    pickHistory,
    pickQuantities,
    returnQuantities,
    reportForm,
    qcForm,
    andonForm,
    currentUser,
    roleCode,
    roleLabel,
    defaultTabByRole,
    applyDefaultTab,
    go,
    loadAll,
    lookupScan,
    executeScan,
    openPick,
    refreshPick,
    pickStatusType,
    pickStatusLabel,
    fillSuggestedPick,
    allocationsForQty,
    submitPick,
    submitReturn,
    openReport,
    submitReport,
    openQc,
    submitQc,
    ackDoc,
    downloadDoc,
    raiseException,
  }
}
