import { reactive, ref, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../../api'

type BomRiskDeps = {
  instanceId: Ref<number | null>
  businessViews: Ref<any>
  loadAll: () => Promise<void>
}

export function useBomRiskActions({ instanceId, businessViews, loadAll }: BomRiskDeps) {
  const dlgRiskDrill = ref(false)
  const selectedRiskComponent = ref<any | null>(null)
  const riskOwners = ref<any[]>([])
  const dlgRiskAction = ref(false)
  const riskActionMode = ref<'followup' | 'assign' | 'eta'>('followup')
  const selectedRiskItem = ref<any | null>(null)
  const riskActionLoading = ref(false)
  const riskActionForm = reactive({
    owner_id: null as number | null,
    expected_date: '',
    note: '',
  })

  async function loadRiskOwners() {
    if (!instanceId.value) return
    try {
      const result: any = await api.get(`/equipment_instances/${instanceId.value}/bom/risk-owner-options`)
      riskOwners.value = result.items || []
    } catch (_error) {
      riskOwners.value = []
    }
  }

  function openRiskDrill(row: any) {
    selectedRiskComponent.value = row
    dlgRiskDrill.value = true
  }

  function resetRiskActionForm(row: any) {
    selectedRiskItem.value = row
    riskActionForm.owner_id = null
    riskActionForm.expected_date = row?.next_expected_date || ''
    riskActionForm.note = ''
  }

  function openRiskFollowup(row: any) {
    resetRiskActionForm(row)
    riskActionMode.value = 'followup'
    dlgRiskAction.value = true
  }

  function openRiskAssign(row: any) {
    resetRiskActionForm(row)
    const owner = riskOwners.value.find((item) => item.full_name === row?.primary_owner || item.username === row?.primary_owner)
    riskActionForm.owner_id = owner?.id || null
    riskActionMode.value = 'assign'
    dlgRiskAction.value = true
  }

  function openRiskEta(row: any) {
    resetRiskActionForm(row)
    riskActionMode.value = 'eta'
    dlgRiskAction.value = true
  }

  function refreshSelectedRiskComponent() {
    if (!selectedRiskComponent.value) return
    const next = (businessViews.value.assembly?.kit_risks || []).find((item: any) => item.component_id === selectedRiskComponent.value.component_id)
    if (next) selectedRiskComponent.value = next
  }

  async function submitRiskAction() {
    if (!instanceId.value || !selectedRiskItem.value) return
    const row = selectedRiskItem.value
    const payload: any = {
      material_id: row.material_id,
      shortage_case_ids: row.shortage_cases?.map((item: any) => item.id) || [],
      purchase_order_ids: row.purchase_orders?.map((item: any) => item.purchase_order_id || item.po_id).filter(Boolean) || [],
      shortage_qty: row.projected_shortage_qty || row.shortage_qty || 0,
      required_qty: row.required_qty || 0,
      available_qty: row.available_qty || 0,
      unit: row.unit || '件',
    }
    try {
      riskActionLoading.value = true
      if (riskActionMode.value === 'followup') {
        await api.post(`/equipment_instances/${instanceId.value}/bom/risk-items/purchase-followup`, {
          ...payload,
          owner_id: riskActionForm.owner_id || null,
          expected_date: riskActionForm.expected_date || null,
          note: riskActionForm.note || 'BOM 风险一键生成采购催办',
        })
        ElMessage.success('已生成采购催办')
      } else if (riskActionMode.value === 'assign') {
        if (!riskActionForm.owner_id) {
          ElMessage.warning('请选择缺料责任人')
          return
        }
        await api.post(`/equipment_instances/${instanceId.value}/bom/risk-items/assign-owner`, {
          ...payload,
          owner_id: riskActionForm.owner_id,
        })
        ElMessage.success('已分派缺料责任人')
      } else {
        if (!riskActionForm.expected_date) {
          ElMessage.warning('请填写预计到货日期')
          return
        }
        await api.post(`/equipment_instances/${instanceId.value}/bom/risk-items/update-eta`, {
          ...payload,
          expected_date: riskActionForm.expected_date,
        })
        ElMessage.success('已回写预计到货日期')
      }
      dlgRiskAction.value = false
      await loadAll()
      refreshSelectedRiskComponent()
    } catch (error: any) {
      ElMessage.error('处理失败: ' + (error?.response?.data?.message || error.message || error))
    } finally {
      riskActionLoading.value = false
    }
  }

  function openPurchasePage(row: any) {
    const params = new URLSearchParams()
    if (instanceId.value) params.set('equipment_instance_id', String(instanceId.value))
    if (row?.material_id) params.set('material_id', String(row.material_id))
    const url = '/purchase' + (params.toString() ? `?${params.toString()}` : '')
    window.open(url, '_blank')
  }

  function openMaterialAlerts(row: any) {
    const params = new URLSearchParams()
    if (instanceId.value) params.set('equipment_instance_id', String(instanceId.value))
    if (row?.material_id) params.set('material_id', String(row.material_id))
    const url = '/material-alerts' + (params.toString() ? `?${params.toString()}` : '')
    window.open(url, '_blank')
  }

  return {
    dlgRiskDrill,
    selectedRiskComponent,
    riskOwners,
    dlgRiskAction,
    riskActionMode,
    selectedRiskItem,
    riskActionLoading,
    riskActionForm,
    loadRiskOwners,
    openRiskDrill,
    resetRiskActionForm,
    openRiskFollowup,
    openRiskAssign,
    openRiskEta,
    refreshSelectedRiskComponent,
    submitRiskAction,
    openPurchasePage,
    openMaterialAlerts,
  }
}
