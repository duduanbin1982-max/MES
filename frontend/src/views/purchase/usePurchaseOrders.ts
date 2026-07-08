import { computed, reactive, ref, type Ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Api } from '../../api'
import { poStatuses, poStatusLabel, poStatusTag } from './purchaseShared'

export function usePurchaseOrders(saving: Ref<boolean>) {
  const orders = ref<any[]>([])
  const oLoading = ref(false)
  const orderFilter = reactive({ status: '' })
  const orderDlg = reactive({ visible: false })
  const orderForm = reactive({
    supplier_id: null as number | null,
    items: [{ material_id: null as number | null, quantity: 1, unit_price: 0 }] as any[],
    notes: ''
  })
  const orderTotal = computed(() => orderForm.items.reduce((sum: number, item: any) => sum + (item.quantity || 0) * (item.unit_price || 0), 0))
  const detailDlg = reactive({ visible: false })
  const detailPo = ref<any>(null)
  const receiveDlg = reactive({ visible: false })
  const receivePo = ref<any>(null)
  const receiveItems = ref<any[]>([])

  const loadOrders = async () => {
    oLoading.value = true
    try {
      const params: any = {}
      if (orderFilter.status) params.status = orderFilter.status
      orders.value = await Api.get('/purchase/orders', { params })
    } catch (_) { orders.value = [] }
    finally { oLoading.value = false }
  }

  const resetOrderForm = () => {
    orderForm.supplier_id = null
    orderForm.items = [{ material_id: null, quantity: 1, unit_price: 0 }]
    orderForm.notes = ''
  }

  const openOrderDialog = () => {
    resetOrderForm()
    orderDlg.visible = true
  }

  const saveOrder = async () => {
    if (!orderForm.supplier_id) { ElMessage.warning('请选择供应商'); return }
    if (!orderForm.items.filter((item: any) => item.material_id).length) { ElMessage.warning('请添加物料明细'); return }
    saving.value = true
    try {
      await Api.post('/purchase/orders', {
        supplier_id: orderForm.supplier_id,
        items: orderForm.items.filter((item: any) => item.material_id).map((item: any) => ({
          material_id: item.material_id, quantity: item.quantity, unit_price: item.unit_price
        })),
        notes: orderForm.notes || undefined
      })
      ElMessage.success('订单已创建')
      orderDlg.visible = false
      loadOrders()
    } catch (error: any) { ElMessage.error(error?.message || '创建失败') }
    finally { saving.value = false }
  }

  const showOrderDetail = async (row: any) => {
    try {
      detailPo.value = await Api.get(`/purchase/orders/${row.id}`)
      detailDlg.visible = true
    } catch (_error: any) { ElMessage.error('加载详情失败') }
  }

  const approveOrder = async (row: any) => {
    try {
      await ElMessageBox.confirm(`确认审批 PO "${row.po_code}" ?`, '审批确认', { type: 'warning' })
      await Api.put(`/purchase/orders/${row.id}/approve`)
      ElMessage.success('已审批')
      loadOrders()
    } catch (_) { }
  }

  const openReceiveDialog = async (row: any) => {
    try {
      const detail = await Api.get(`/purchase/orders/${row.id}`)
      receivePo.value = detail
      receiveItems.value = (detail.items || []).map((item: any) => ({
        ...item,
        receive_qty: 0,
        remaining: (item.quantity || 0) - (item.received_qty || 0)
      }))
      receiveDlg.visible = true
    } catch (_error: any) { ElMessage.error('加载订单详情失败') }
  }

  const doReceive = async () => {
    const toReceive = receiveItems.value.filter((item: any) => item.receive_qty > 0)
    if (!toReceive.length) { ElMessage.warning('请填写收货数量'); return }
    saving.value = true
    try {
      await Api.post(`/purchase/orders/${receivePo.value.id}/receive`, {
        items: toReceive.map((item: any) => ({ material_id: item.material_id, quantity: item.receive_qty }))
      })
      ElMessage.success('已收货入库')
      receiveDlg.visible = false
      loadOrders()
    } catch (error: any) { ElMessage.error(error?.message || '收货失败') }
    finally { saving.value = false }
  }

  return {
    poStatuses, poStatusLabel, poStatusTag, orders, oLoading, orderFilter, orderDlg,
    orderForm, orderTotal, detailDlg, detailPo, receiveDlg, receivePo, receiveItems,
    loadOrders, openOrderDialog, resetOrderForm, saveOrder, showOrderDetail,
    approveOrder, openReceiveDialog, doReceive,
  }
}
