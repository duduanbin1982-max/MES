import { computed, reactive, ref, type Ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Api } from '../../api'
import { poStatuses, poStatusLabel, poStatusTag } from './purchaseShared'
import { useAuthStore } from '../../stores/auth'

export function usePurchaseOrders(saving: Ref<boolean>) {
  const auth = useAuthStore()
  const orders = ref<any[]>([])
  const oLoading = ref(false)
  const orderError = ref('')
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
    orderError.value = ''
    try {
      const params: any = {}
      if (orderFilter.status) params.status = orderFilter.status
      orders.value = await Api.get('/purchase_orders', { params })
    } catch (error: any) {
      orders.value = []
      orderError.value = error?.response?.data?.message || error?.message || '采购订单加载失败'
    }
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
      await Api.post('/purchase_orders', {
        supplier_id: orderForm.supplier_id,
        lines: orderForm.items.filter((item: any) => item.material_id).map((item: any) => ({
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
      detailPo.value = await Api.get(`/purchase_orders/${row.id}`)
      detailDlg.visible = true
    } catch (error: any) { ElMessage.error(error?.response?.data?.message || '加载详情失败') }
  }

  const approveOrder = async (row: any) => {
    try {
      await ElMessageBox.confirm(`确认采购订单 "${row.po_no}" ?`, '确认订单', { type: 'warning' })
      // 2026-11-05 状态机整改：draft 先提交，再确认；确认必须带审批人（职责分离由后端校验）
      if (row.status === 'draft') await Api.patch(`/purchase_orders/${row.id}/status`, { status: 'submitted' })
      await Api.patch(`/purchase_orders/${row.id}/status`, { status: 'confirmed', approved_by: auth.user?.id })
      ElMessage.success('订单已确认')
      loadOrders()
    } catch (error: any) {
      if (error === 'cancel' || error === 'close') return
      ElMessage.error(error?.response?.data?.message || error?.message || '采购订单审批失败')
    }
  }

  const invoiceForm = reactive({ invoice_no: '', invoice_date: '', amount: null as number | null, tax_amount: 0 })
  const invoiceSaving = ref(false)
  const saveInvoice = async () => {
    if (!detailPo.value) return
    if (!invoiceForm.invoice_no || !(Number(invoiceForm.amount) > 0)) {
      ElMessage.warning('请填写发票号与金额')
      return
    }
    invoiceSaving.value = true
    try {
      await Api.post(`/purchase_orders/${detailPo.value.id}/invoices`, {
        invoice_no: invoiceForm.invoice_no,
        invoice_date: invoiceForm.invoice_date || undefined,
        amount: Number(invoiceForm.amount),
        tax_amount: Number(invoiceForm.tax_amount || 0),
      })
      ElMessage.success('发票已录入')
      invoiceForm.invoice_no = ''
      invoiceForm.amount = null
      invoiceForm.tax_amount = 0
      detailPo.value = await Api.get(`/purchase_orders/${detailPo.value.id}`)
    } catch (error: any) {
      ElMessage.error(error?.response?.data?.message || error?.message || '录入发票失败')
    } finally {
      invoiceSaving.value = false
    }
  }

  const openReceiveDialog = async (row: any) => {
    try {
      const detail = await Api.get(`/purchase_orders/${row.id}`)
      receivePo.value = detail
      receiveItems.value = (detail.lines || []).map((item: any) => ({
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
      await Api.post(`/purchase_orders/${receivePo.value.id}/receive`, {
        lines: toReceive.map((item: any) => ({ line_id: item.id, received_qty: item.receive_qty }))
      })
      ElMessage.success('已收货入库')
      receiveDlg.visible = false
      loadOrders()
    } catch (error: any) { ElMessage.error(error?.message || '收货失败') }
    finally { saving.value = false }
  }

  return {
    poStatuses, poStatusLabel, poStatusTag, orders, oLoading, orderError, orderFilter, orderDlg,
    orderForm, orderTotal, detailDlg, detailPo, receiveDlg, receivePo, receiveItems,
    invoiceForm, invoiceSaving, saveInvoice,
    loadOrders, openOrderDialog, resetOrderForm, saveOrder, showOrderDetail,
    approveOrder, openReceiveDialog, doReceive,
  }
}
