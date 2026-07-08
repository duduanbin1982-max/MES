import { computed, reactive, ref, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Api } from '../../api'
import { followUpStatusLabel, followUpStatusTag } from './purchaseShared'

type FollowupDeps = {
  tab: Ref<string>
  saving: Ref<boolean>
}

export function usePurchaseFollowup({ tab, saving }: FollowupDeps) {
  const followUpLoading = ref(false)
  const followUpRows = ref<any[]>([])
  const followUpSummary = ref<any>({})
  const followUpFilter = reactive({ status: '', onlyOverdue: false, sourceType: '', purchaseRequestNo: '', instanceId: '' })
  const filteredFollowUps = computed(() => {
    let rows = [...followUpRows.value]
    if (followUpFilter.status) rows = rows.filter((row: any) => row.tracking_status === followUpFilter.status)
    if (followUpFilter.sourceType) rows = rows.filter((row: any) => row.source_type === followUpFilter.sourceType)
    if (followUpFilter.purchaseRequestNo) rows = rows.filter((row: any) => String(row.purchase_request_no || row.po_no || '').includes(followUpFilter.purchaseRequestNo))
    if (followUpFilter.instanceId) rows = rows.filter((row: any) => String(row.equipment_instance_id || row.instance_id || '') === String(followUpFilter.instanceId))
    if (followUpFilter.onlyOverdue) rows = rows.filter((row: any) => Number(row.delay_days || 0) > 0 && row.tracking_status !== 'delivered' && row.tracking_status !== 'cancelled')
    return rows
  })
  const followUpDlg = reactive({ visible: false })
  const currentFollowUp = ref<any | null>(null)
  const followUpForm = reactive({ status: 'pending', planned_delivery: '', actual_delivery: '', urgent_tags: '', remarks: '', owner_name: '' })

  function applyRouteToFollowUp(query: any) {
    if (query.tab) tab.value = String(query.tab)
    followUpFilter.purchaseRequestNo = query.purchase_request_no ? String(query.purchase_request_no) : ''
    followUpFilter.instanceId = query.instance_id ? String(query.instance_id) : ''
    if (tab.value === 'followup') {
      followUpFilter.sourceType = query.source_type ? String(query.source_type) : (followUpFilter.purchaseRequestNo ? 'shortage' : followUpFilter.sourceType)
    }
  }

  const loadPurchaseFollowUp = async () => {
    followUpLoading.value = true
    try {
      const data = await Api.purchaseFollowUp()
      followUpRows.value = data.rows || []
      followUpSummary.value = data.summary || {}
    } catch (error: any) {
      ElMessage.error(error?.message || '采购跟催加载失败')
      followUpRows.value = []
      followUpSummary.value = {}
    } finally {
      followUpLoading.value = false
    }
  }

  const openFollowUpDialog = (row: any) => {
    currentFollowUp.value = row
    Object.assign(followUpForm, {
      status: row.tracking_status || 'pending',
      planned_delivery: row.planned_delivery || row.expected_date || '',
      actual_delivery: row.actual_delivery || '',
      urgent_tags: row.urgent_tags || '',
      remarks: row.remarks || '',
      owner_name: row.owner_name || '',
    })
    followUpDlg.visible = true
  }

  const saveFollowUp = async () => {
    if (!currentFollowUp.value) return
    saving.value = true
    try {
      await Api.updatePurchaseFollowUp(currentFollowUp.value.id, { ...followUpForm })
      ElMessage.success('采购跟催已更新')
      followUpDlg.visible = false
      await loadPurchaseFollowUp()
    } catch (error: any) {
      ElMessage.error(error?.message || '跟催更新失败')
    } finally {
      saving.value = false
    }
  }

  const goKitFromFollowUp = (row: any) => {
    const instanceId = row.equipment_instance_id || row.instance_id
    if (!instanceId) return
    location.href = `/kit-closure?instance_id=${instanceId}`
  }

  return {
    followUpLoading, followUpSummary, followUpFilter, filteredFollowUps, followUpDlg,
    currentFollowUp, followUpForm, followUpStatusLabel, followUpStatusTag,
    applyRouteToFollowUp, loadPurchaseFollowUp, openFollowUpDialog, saveFollowUp,
    goKitFromFollowUp,
  }
}
