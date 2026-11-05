<template>
      <!-- ===== Tab 2: 采购订单 ===== -->
      <el-tab-pane label="采购订单" name="orders">
        <div class="tb">
          <el-select v-model="orderFilter.status" placeholder="按状态筛选" clearable style="width:140px" @change="emit('load-orders')">
            <el-option v-for="s in poStatuses" :key="s" :label="poStatusLabel(s)" :value="s" />
          </el-select>
          <el-button type="primary" @click="emit('open-order-dialog')">+ 新建PO</el-button>
        </div>
        <el-alert v-if="orderError" class="order-error" type="error" :closable="false" show-icon>
          <template #title>采购订单加载失败</template>
          <div class="order-error__body">
            <span>{{ orderError }}</span>
            <el-button size="small" @click="emit('load-orders')">重试</el-button>
          </div>
        </el-alert>
        <el-table :data="orders" v-loading="oLoading" size="small" max-height="500" stripe>
          <el-table-column prop="po_no" label="PO编号" width="160" />
          <el-table-column prop="supplier_name" label="供应商" min-width="160" />
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <el-tag :type="poStatusTag(row.status)" size="small">{{ poStatusLabel(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="总金额" width="130" align="right">
            <template #default="{ row }">¥{{ (row.total_amount || 0).toLocaleString() }}</template>
          </el-table-column>
          <el-table-column prop="created_at" label="创建时间" width="170" />
          <el-table-column label="操作" width="200" fixed="right">
            <template #default="{ row }">
              <el-button size="small" link type="primary" @click="emit('show-order-detail', row)">详情</el-button>
              <el-button v-if="['draft', 'submitted'].includes(row.status)" size="small" link type="success" @click="emit('approve-order', row)">确认</el-button>
              <el-button v-if="['confirmed', 'in_transit', 'partially_received'].includes(row.status)" size="small" link type="warning" @click="emit('open-receive-dialog', row)">收货</el-button>
            </template>
          </el-table-column>
        </el-table>

        <!-- New PO Dialog -->
        <el-dialog v-model="orderDlg.visible" title="新建采购订单" width="min(650px, calc(100vw - 24px))" @closed="emit('reset-order-form')">
          <el-form :model="orderForm" label-width="80px">
            <el-form-item label="供应商" required>
              <el-select v-model="orderForm.supplier_id" filterable style="width:100%" placeholder="选择供应商">
                <el-option v-for="s in suppliers" :key="s.id" :label="supplierName(s)" :value="s.id" />
              </el-select>
            </el-form-item>
            <el-divider>物料明细</el-divider>
            <div v-for="(item, idx) in orderForm.items" :key="idx" style="display:flex;gap:8px;margin-bottom:8px;align-items:center">
              <el-select v-model="item.material_id" filterable placeholder="物料" style="flex:2">
                <el-option v-for="m in materials" :key="m.id" :label="m.material_code + ' ' + m.material_name" :value="m.id" />
              </el-select>
              <el-input-number aria-label="购买数量" v-model="item.quantity" :min="1" placeholder="数量" style="width:90px" />
              <el-input-number v-model="item.unit_price" :min="0" :precision="2" placeholder="单价" style="width:110px" />
              <span style="width:70px;text-align:right;font-weight:600">¥{{ ((item.quantity || 0) * (item.unit_price || 0)).toLocaleString() }}</span>
              <el-button size="small" type="danger" circle @click="orderForm.items.splice(idx, 1)">×</el-button>
            </div>
            <el-button size="small" @click="orderForm.items.push({ material_id: null, quantity: 1, unit_price: 0 })">+ 添加物料</el-button>
            <el-divider />
            <div style="text-align:right;font-size:16px;font-weight:700;margin-bottom:12px">
              合计: ¥{{ orderTotal.toLocaleString() }}
            </div>
            <el-form-item label="备注"><el-input v-model="orderForm.notes" type="textarea" :rows="2" /></el-form-item>
          </el-form>
          <template #footer>
            <el-button @click="orderDlg.visible = false">取消</el-button>
            <el-button type="primary" @click="emit('save-order')" :loading="saving">创建</el-button>
          </template>
        </el-dialog>

        <!-- PO Detail Dialog -->
        <el-dialog v-model="detailDlg.visible" title="PO详情" width="min(650px, calc(100vw - 24px))">
          <template v-if="detailPo">
            <el-descriptions :column="2" border size="small">
              <el-descriptions-item label="PO编号">{{ detailPo.po_no }}</el-descriptions-item>
              <el-descriptions-item label="供应商">{{ detailPo.supplier_name }}</el-descriptions-item>
              <el-descriptions-item label="状态">
                <el-tag :type="poStatusTag(detailPo.status)" size="small">{{ poStatusLabel(detailPo.status) }}</el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="总金额">¥{{ (detailPo.total_amount || 0).toLocaleString() }}</el-descriptions-item>
              <el-descriptions-item label="创建时间">{{ detailPo.created_at }}</el-descriptions-item>
              <el-descriptions-item label="备注">{{ detailPo.notes || '-' }}</el-descriptions-item>
            </el-descriptions>
            <el-divider>物料明细</el-divider>
            <el-table :data="detailPo.lines || []" size="small" max-height="250">
              <el-table-column prop="material_name" label="物料" min-width="160" />
              <el-table-column prop="quantity" label="数量" width="80" />
              <el-table-column prop="unit_price" label="单价" width="100">
                <template #default="{ row }">¥{{ (row.unit_price || 0).toFixed(2) }}</template>
              </el-table-column>
              <el-table-column label="小计" width="100" align="right">
                <template #default="{ row }">¥{{ ((row.quantity || 0) * (row.unit_price || 0)).toLocaleString() }}</template>
              </el-table-column>
            </el-table>
            <el-divider>对账（订单 / 收货 / 发票）</el-divider>
            <template v-if="detailPo.reconciliation">
              <el-descriptions :column="3" border size="small">
                <el-descriptions-item label="已订金额">¥{{ (detailPo.reconciliation.ordered_amount || 0).toLocaleString() }}</el-descriptions-item>
                <el-descriptions-item label="已收金额">¥{{ (detailPo.reconciliation.received_amount || 0).toLocaleString() }}</el-descriptions-item>
                <el-descriptions-item label="已开票金额">¥{{ (detailPo.reconciliation.invoiced_amount || 0).toLocaleString() }}</el-descriptions-item>
                <el-descriptions-item label="差异">
                  <span :class="Math.abs(detailPo.reconciliation.variance || 0) > 0.01 ? 'recon-diff' : ''">¥{{ (detailPo.reconciliation.variance || 0).toLocaleString() }}</span>
                </el-descriptions-item>
                <el-descriptions-item label="对账状态">
                  <el-tag :type="detailPo.reconciliation.status === 'matched' ? 'success' : (detailPo.reconciliation.status === 'variance' ? 'danger' : 'info')" size="small">
                    {{ detailPo.reconciliation.status === 'matched' ? '已匹配' : (detailPo.reconciliation.status === 'variance' ? '有差异' : '待开票') }}
                  </el-tag>
                </el-descriptions-item>
                <el-descriptions-item label="发票数">{{ detailPo.reconciliation.invoice_count || 0 }}</el-descriptions-item>
              </el-descriptions>
              <el-table v-if="(detailPo.reconciliation.invoices || []).length" :data="detailPo.reconciliation.invoices" size="small" max-height="160" style="margin-top:8px">
                <el-table-column prop="invoice_no" label="发票号" width="150" />
                <el-table-column prop="invoice_date" label="开票日期" width="120" />
                <el-table-column label="金额" width="120" align="right">
                  <template #default="{ row }">¥{{ (row.amount || 0).toLocaleString() }}</template>
                </el-table-column>
                <el-table-column prop="status" label="状态" width="100" />
              </el-table>
              <div class="invoice-form">
                <el-input v-model="invoiceForm.invoice_no" placeholder="发票号" style="width:160px" />
                <el-date-picker v-model="invoiceForm.invoice_date" type="date" value-format="YYYY-MM-DD" placeholder="开票日期" style="width:150px" />
                <el-input-number v-model="invoiceForm.amount" :min="0" :precision="2" placeholder="金额" style="width:140px" />
                <el-button type="primary" size="small" :loading="invoiceSaving" @click="emit('save-invoice')">录入发票</el-button>
              </div>
            </template>
            <el-divider v-if="detailPo.receiving_history && detailPo.receiving_history.length">收货记录</el-divider>
            <el-table v-if="detailPo.receiving_history && detailPo.receiving_history.length" :data="detailPo.receiving_history" size="small" max-height="200">
              <el-table-column prop="material_name" label="物料" min-width="140" />
              <el-table-column prop="received_qty" label="收货数量" width="100" />
              <el-table-column prop="received_at" label="收货时间" width="170" />
            </el-table>
          </template>
          <template #footer>
            <el-button @click="detailDlg.visible = false">关闭</el-button>
          </template>
        </el-dialog>

        <!-- Receive Dialog -->
        <el-dialog v-model="receiveDlg.visible" title="收货入库" width="min(500px, calc(100vw - 24px))">
          <template v-if="receivePo">
            <el-descriptions :column="2" border size="small" style="margin-bottom:16px">
              <el-descriptions-item label="PO编号">{{ receivePo.po_no }}</el-descriptions-item>
              <el-descriptions-item label="供应商">{{ receivePo.supplier_name }}</el-descriptions-item>
            </el-descriptions>
            <div v-for="(item, idx) in receiveItems" :key="idx" style="display:flex;gap:8px;margin-bottom:8px;align-items:center">
              <span style="flex:1">{{ item.material_name }}</span>
              <span class="remaining-qty">未收: {{ item.remaining || item.quantity }}</span>
              <el-input-number v-model="item.receive_qty" :min="0" :max="item.remaining || item.quantity" style="width:110px" />
            </div>
          </template>
          <template #footer>
            <el-button @click="receiveDlg.visible = false">取消</el-button>
            <el-button type="primary" @click="emit('do-receive')" :loading="saving">确认收货</el-button>
          </template>
        </el-dialog>
      </el-tab-pane>
</template>

<script setup lang="ts">
defineProps<{
  poStatuses: readonly string[]
  poStatusLabel: (value: string) => string
  poStatusTag: (value: string) => string
  orders: any[]
  oLoading: boolean
  orderError: string
  suppliers: any[]
  supplierName: (row: any) => string
  materials: any[]
  orderTotal: number
  saving: boolean
  detailPo: any
  receivePo: any
  receiveItems: any[]
  invoiceSaving: boolean
}>()
// 2026-10-17（前端 eslint 棘轮）：被模板改写的对象 prop 改为 defineModel，
// 父组件用 v-model:xxx 绑定；改的仍是父组件同一对象，行为不变。
const orderFilter = defineModel<any>('orderFilter', { required: true })
const orderDlg = defineModel<any>('orderDlg', { required: true })
const orderForm = defineModel<any>('orderForm', { required: true })
const detailDlg = defineModel<any>('detailDlg', { required: true })
const receiveDlg = defineModel<any>('receiveDlg', { required: true })
const invoiceForm = defineModel<any>('invoiceForm', { required: true })


const emit = defineEmits<{
  (event: 'load-orders'): void
  (event: 'open-order-dialog'): void
  (event: 'show-order-detail', row: any): void
  (event: 'approve-order', row: any): void
  (event: 'open-receive-dialog', row: any): void
  (event: 'reset-order-form'): void
  (event: 'save-order'): void
  (event: 'do-receive'): void
  (event: 'save-invoice'): void
}>()
</script>

<style scoped>
.tb { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
.order-error { margin-bottom: 12px; }
.order-error__body { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.remaining-qty { width: 100px; color: var(--el-text-color-secondary); }
.invoice-form { display: flex; gap: 8px; align-items: center; margin-top: 8px; flex-wrap: wrap; }
.recon-diff { color: var(--el-color-danger); font-weight: 600; }
</style>
