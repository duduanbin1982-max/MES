import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Api } from '../../api'
import { outsourceStatusLabel, outsourceStatusTag, scoreGradeTag } from './purchaseShared'

export function useSupplierCollaboration() {
  const collabLoading = ref(false)
  const collabOverview = ref<any>({})
  const pendingReceipts = ref<any[]>([])
  const incomingInspections = ref<any[]>([])
  const outsourcingOrders = ref<any[]>([])
  const scorecards = ref<any[]>([])
  const incomingForm = reactive({
    receiving_id: null as number | null,
    purchase_order_id: null as number | null,
    supplier_id: null as number | null,
    material_id: null as number | null,
    lot_no: '',
    result: 'pass',
    sample_qty: 1,
    defect_qty: 0,
    defect_desc: '',
    disposition: 'accept'
  })
  const outsourceForm = reactive({
    supplier_id: null as number | null,
    item_name: '',
    process_name: '',
    planned_finish: '',
    contract_amount: 0
  })

  const loadSupplierCollab = async () => {
    collabLoading.value = true
    try {
      const [overview, receipts, incoming, outsourcing, scores] = await Promise.all([
        Api.get('/supplier-collab/overview'),
        Api.get('/supplier-collab/pending-receipts'),
        Api.get('/supplier-collab/incoming-inspections'),
        Api.get('/supplier-collab/outsourcing-orders'),
        Api.get('/supplier-collab/scorecards')
      ])
      collabOverview.value = overview || {}
      pendingReceipts.value = receipts || []
      incomingInspections.value = incoming || []
      outsourcingOrders.value = outsourcing || []
      scorecards.value = scores || []
    } catch (error: any) {
      ElMessage.error(error?.message || '供应商协同数据加载失败')
    } finally {
      collabLoading.value = false
    }
  }

  const saveIncomingInspection = async () => {
    if (!incomingForm.receiving_id) { ElMessage.warning('请选择待检收货批次'); return }
    if (incomingForm.result === 'fail' && !incomingForm.defect_desc) { ElMessage.warning('不合格时请填写缺陷说明'); return }
    collabLoading.value = true
    try {
      const result = await Api.post('/supplier-collab/incoming-inspections', incomingForm)
      ElMessage.success(result.ncr ? `已登记并生成 NCR #${result.ncr.id}` : '来料检验已登记')
      Object.assign(incomingForm, { receiving_id: null, purchase_order_id: null, supplier_id: null, material_id: null, lot_no: '', result: 'pass', sample_qty: 1, defect_qty: 0, defect_desc: '', disposition: 'accept' })
      await loadSupplierCollab()
    } catch (error: any) {
      ElMessage.error(error?.message || '登记失败')
    } finally {
      collabLoading.value = false
    }
  }

  const saveOutsourceOrder = async () => {
    if (!outsourceForm.supplier_id || !outsourceForm.item_name) { ElMessage.warning('请选择供应商并填写外协件'); return }
    collabLoading.value = true
    try {
      await Api.post('/supplier-collab/outsourcing-orders', outsourceForm)
      ElMessage.success('外协单已创建')
      Object.assign(outsourceForm, { item_name: '', process_name: '', planned_finish: '', contract_amount: 0 })
      await loadSupplierCollab()
    } catch (error: any) {
      ElMessage.error(error?.message || '创建外协失败')
    } finally {
      collabLoading.value = false
    }
  }

  const updateOutsource = async (row: any, patch: any) => {
    try {
      await Api.put(`/supplier-collab/outsourcing-orders/${row.id}`, patch)
      ElMessage.success('外协进度已更新')
      await loadSupplierCollab()
    } catch (error: any) {
      ElMessage.error(error?.message || '更新失败')
    }
  }

  return {
    collabLoading, collabOverview, pendingReceipts, incomingInspections, outsourcingOrders, scorecards,
    outsourceStatusLabel, outsourceStatusTag, scoreGradeTag, incomingForm, outsourceForm,
    loadSupplierCollab, saveIncomingInspection, saveOutsourceOrder, updateOutsource,
  }
}
