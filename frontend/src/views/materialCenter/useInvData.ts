// frontend/src/views/materialCenter/useInvData.ts
// 库存数据共享: inv / lots / workOrders / movs / alerts, 供 TabInv + TabMov + Dialogs 复用
import { ref, reactive, computed } from 'vue'
import api from '../../api'

export function useInvData() {
  const inv = ref<any[]>([])
  const alerts = ref<any[]>([])
  const lots = ref<any[]>([])
  const workOrders = ref<any[]>([])
  const materials = ref<any[]>([])

  const movs = ref<any[]>([])
  const movTotal = ref(0)
  const movPage = ref(1)
  const movLimit = ref(50)
  const movFilter = reactive({ movement_type: undefined as any, material_lot_id: undefined as any, dateRange: undefined as any })

  const movTypeOptions = [
    { value: 'receive', label: '入库' },
    { value: 'issue', label: '领料' },
    { value: 'return', label: '退料' },
    { value: 'transfer', label: '调拨' },
    { value: 'adjust', label: '盘点' },
  ]
  const movTypeLabel = (s: string) => movTypeOptions.find(t => t.value === s)?.label || s
  const movTypeColor = (s: string) => ({ receive: 'success', issue: 'warning', return: 'primary', transfer: 'info', adjust: 'danger' }[s] || 'info')

  const loadAll = async () => {
    const [a, c, d, e] = await Promise.all([
      api.get('/inventory'), api.get('/material_lots'), api.get('/work_orders'),
      api.get('/inventory/alerts')
    ])
    inv.value = a; lots.value = c; workOrders.value = d; alerts.value = (e as any).items || []
    materials.value = await api.materials()
    await loadMovs()
  }
  const loadInvOnly = async () => {
    const [a, c, d, e] = await Promise.all([
      api.get('/inventory'), api.get('/material_lots'), api.get('/work_orders'),
      api.get('/inventory/alerts')
    ])
    inv.value = a; lots.value = c; workOrders.value = d; alerts.value = (e as any).items || []
  }
  const loadMovs = async () => {
    const params: any = { limit: movLimit.value, offset: (movPage.value - 1) * movLimit.value }
    if (movFilter.movement_type) params.movement_type = movFilter.movement_type
    if (movFilter.material_lot_id) params.material_lot_id = movFilter.material_lot_id
    if (movFilter.dateRange && movFilter.dateRange.length === 2) {
      params.date_from = movFilter.dateRange[0]
      params.date_to = movFilter.dateRange[1]
    }
    const r = await api.get('/material_movements', { params })
    if (r && Array.isArray(r.items)) { movs.value = r.items; movTotal.value = r.total || 0 }
    else { movs.value = r || []; movTotal.value = movs.value.length }
  }

  return {
    inv, alerts, lots, workOrders, materials,
    movs, movTotal, movPage, movLimit, movFilter,
    movTypeOptions, movTypeLabel, movTypeColor,
    loadAll, loadInvOnly, loadMovs,
  }
}