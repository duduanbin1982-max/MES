<template>
  <div class="page">
    <PageToolbar class="page-header">
      <div>
        <div class="page-title">备件生产</div>
        <div class="page-subtitle">通用配件按库存生产：BOM、工艺模板、领料、工序、质检、完工自动入库。</div>
      </div>
      <div>
        <el-button @click="partDlg = true">+ 新增自产备件</el-button>
        <el-button @click="loadAll">刷新</el-button>
      </div>
    </PageToolbar>

    <el-row :gutter="12" class="kpi-row">
      <el-col :span="6"><el-card shadow="hover"><div class="kpi-label">生产工单</div><div class="kpi-value">{{ overview.orders || 0 }}</div></el-card></el-col>
      <el-col :span="6"><el-card shadow="hover"><div class="kpi-label">在制/待质检</div><div class="kpi-value">{{ overview.in_progress || 0 }}</div></el-card></el-col>
      <el-col :span="6"><el-card shadow="hover"><div class="kpi-label">已完工</div><div class="kpi-value success">{{ overview.completed || 0 }}</div></el-card></el-col>
      <el-col :span="6"><el-card shadow="hover"><div class="kpi-label">待入库</div><div class="kpi-value warning">{{ overview.pending_receipt || 0 }}</div></el-card></el-col>
    </el-row>

    <el-tabs v-model="tab" style="margin-top: 12px">
      <el-tab-pane label="生产工单" name="orders">
        <div class="toolbar">
          <el-button type="primary" @click="openOrderDialog">+ 新建生产工单</el-button>
          <el-select v-model="orderStatus" clearable placeholder="状态" style="width: 140px" @change="loadOrders">
            <el-option label="已计划" value="planned" /><el-option label="生产中" value="in_progress" />
            <el-option label="待质检" value="pending_qc" /><el-option label="已完成" value="completed" />
          </el-select>
        </div>
        <el-table :data="orders" v-loading="loading" stripe border size="small">
          <el-table-column prop="order_no" label="工单号" width="170" />
          <el-table-column label="备件" min-width="220">
            <template #default="{ row }">{{ row.material_code }} · {{ row.material_name }}</template>
          </el-table-column>
          <el-table-column prop="planned_qty" label="计划数量" width="90" align="right" />
          <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag size="small" :type="statusTag(row.status)">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
          <el-table-column label="质检" width="90"><template #default="{ row }"><el-tag size="small" :type="row.qc_status === 'passed' ? 'success' : row.qc_status === 'failed' ? 'danger' : 'info'">{{ qcLabel(row.qc_status) }}</el-tag></template></el-table-column>
          <el-table-column label="入库" width="100"><template #default="{ row }">{{ row.receipt_status === 'received' ? '已入库' : '待入库' }}</template></el-table-column>
          <el-table-column prop="planned_end" label="计划完成" width="120" />
          <el-table-column label="操作" width="120" fixed="right"><template #default="{ row }"><el-button size="small" link type="primary" @click="openDetail(row)">详情</el-button></template></el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="备件 BOM" name="bom">
        <div class="toolbar">
          <el-select v-model="selectedPartId" filterable placeholder="选择自产备件" style="width: 360px" @change="loadBom">
            <el-option v-for="part in parts" :key="part.id" :label="part.material_code + ' · ' + part.material_name" :value="part.id" />
          </el-select>
          <el-button type="primary" :disabled="!selectedPartId" @click="bomDlg = true">+ 添加用料</el-button>
        </div>
        <el-table :data="bomLines" border size="small" empty-text="该备件还没有 BOM 用料">
          <el-table-column prop="material_code" label="物料编码" width="160" />
          <el-table-column prop="material_name" label="物料名称" min-width="200" />
          <el-table-column prop="quantity" label="单件用量" width="100" align="right" />
          <el-table-column prop="unit" label="单位" width="80" />
          <el-table-column label="操作" width="90"><template #default="{ row }"><el-button size="small" link type="danger" @click="removeBom(row)">删除</el-button></template></el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="工艺模板" name="route">
        <div class="toolbar">
          <el-select v-model="selectedPartId" filterable placeholder="选择自产备件" style="width: 360px" @change="loadRoute">
            <el-option v-for="part in parts" :key="part.id" :label="part.material_code + ' · ' + part.material_name" :value="part.id" />
          </el-select>
          <el-button type="primary" :disabled="!selectedPartId" @click="routeDlg = true">+ 添加工序</el-button>
        </div>
        <el-table :data="routeSteps" border size="small" empty-text="该备件还没有工艺模板">
          <el-table-column prop="sequence" label="顺序" width="80" />
          <el-table-column prop="operation_name" label="工序名称" min-width="180" />
          <el-table-column prop="workstation_name" label="工位" width="160" />
          <el-table-column prop="standard_hours" label="标准工时(h)" width="110" align="right" />
          <el-table-column label="质检" width="80"><template #default="{ row }">{{ row.qc_required ? '是' : '否' }}</template></el-table-column>
          <el-table-column label="操作" width="90"><template #default="{ row }"><el-button size="small" link type="danger" @click="removeRoute(row)">删除</el-button></template></el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="完工入库记录" name="receipts">
        <el-table :data="receipts" border size="small">
          <el-table-column prop="receipt_no" label="入库单号" width="180" />
          <el-table-column prop="order_no" label="生产工单" width="170" />
          <el-table-column label="备件" min-width="200"><template #default="{ row }">{{ row.material_code }} · {{ row.material_name }}</template></el-table-column>
          <el-table-column prop="lot_no" label="产出批次" width="180" />
          <el-table-column prop="quantity" label="数量" width="90" align="right" />
          <el-table-column prop="location" label="库位" width="130" />
          <el-table-column prop="created_at" label="入库时间" width="170" />
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="partDlg" title="新增自产备件" width="480px">
      <el-form :model="partForm" label-width="100px">
        <el-form-item label="物料编码" required><el-input v-model="partForm.material_code" placeholder="例如 SP-PIN-001" /></el-form-item>
        <el-form-item label="名称" required><el-input v-model="partForm.material_name" /></el-form-item>
        <el-form-item label="规格"><el-input v-model="partForm.spec" /></el-form-item>
        <el-form-item label="单位"><el-input v-model="partForm.unit" placeholder="件" /></el-form-item>
        <el-form-item label="安全库存"><el-input-number v-model="partForm.safety_stock" :min="0" style="width: 100%" /></el-form-item>
        <el-form-item label="再订货点"><el-input-number v-model="partForm.reorder_point" :min="0" style="width: 100%" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="partDlg = false">取消</el-button><el-button type="primary" :loading="saving" @click="createPart">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="orderDlg" title="新建备件生产工单" width="520px">
      <el-form :model="orderForm" label-width="100px">
        <el-form-item label="自产备件" required>
          <el-select v-model="orderForm.part_material_id" filterable style="width: 100%">
            <el-option v-for="part in parts" :key="part.id" :label="part.material_code + ' · ' + part.material_name" :value="part.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="计划数量" required><el-input-number v-model="orderForm.planned_qty" :min="1" style="width: 100%" /></el-form-item>
        <el-form-item label="计划开始"><el-date-picker v-model="orderForm.planned_start" type="date" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
        <el-form-item label="计划结束"><el-date-picker v-model="orderForm.planned_end" type="date" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
        <el-form-item label="优先级"><el-radio-group v-model="orderForm.priority"><el-radio :value="1">紧急</el-radio><el-radio :value="2">高</el-radio><el-radio :value="3">普通</el-radio></el-radio-group></el-form-item>
        <el-form-item label="备注"><el-input v-model="orderForm.notes" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="orderDlg = false">取消</el-button><el-button type="primary" :loading="saving" @click="createOrder">创建</el-button></template>
    </el-dialog>

    <el-dialog v-model="bomDlg" title="添加备件用料" width="480px">
      <el-form :model="bomForm" label-width="100px">
        <el-form-item label="物料" required><el-select v-model="bomForm.component_material_id" filterable style="width: 100%"><el-option v-for="m in materials" :key="m.id" :label="m.material_code + ' · ' + m.material_name" :value="m.id" /></el-select></el-form-item>
        <el-form-item label="单件用量" required><el-input-number v-model="bomForm.quantity" :min="0.001" :precision="3" style="width: 100%" /></el-form-item>
        <el-form-item label="单位"><el-input v-model="bomForm.unit" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="bomDlg = false">取消</el-button><el-button type="primary" :loading="saving" @click="saveBom">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="routeDlg" title="添加工艺工序" width="500px">
      <el-form :model="routeForm" label-width="100px">
        <el-form-item label="顺序" required><el-input-number v-model="routeForm.sequence" :min="1" style="width: 100%" /></el-form-item>
        <el-form-item label="工序名称" required><el-input v-model="routeForm.operation_name" /></el-form-item>
        <el-form-item label="工位"><el-select v-model="routeForm.workstation_id" clearable filterable style="width: 100%"><el-option v-for="w in workstations" :key="w.id" :label="w.name" :value="w.id" /></el-select></el-form-item>
        <el-form-item label="标准工时(h)"><el-input-number v-model="routeForm.standard_hours" :min="0" :precision="2" style="width: 100%" /></el-form-item>
        <el-form-item label="需要质检"><el-switch v-model="routeForm.qc_required" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="routeDlg = false">取消</el-button><el-button type="primary" :loading="saving" @click="saveRoute">保存</el-button></template>
    </el-dialog>

    <el-drawer v-model="detailDlg" :title="detail ? detail.order_no : '生产工单'" size="640px">
      <template v-if="detail">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="备件">{{ detail.part?.material_code }} · {{ detail.part?.material_name }}</el-descriptions-item>
          <el-descriptions-item label="数量">{{ detail.planned_qty }}</el-descriptions-item>
          <el-descriptions-item label="状态">{{ statusLabel(detail.status) }}</el-descriptions-item>
          <el-descriptions-item label="质检">{{ qcLabel(detail.qc_status) }}</el-descriptions-item>
          <el-descriptions-item label="入库">{{ detail.receipt_status === 'received' ? '已入库' : '待入库' }}</el-descriptions-item>
          <el-descriptions-item label="计划">{{ detail.planned_start || '-' }} → {{ detail.planned_end || '-' }}</el-descriptions-item>
        </el-descriptions>
        <div class="section-title">领料</div>
        <el-table :data="detail.materials || []" size="small" border>
          <el-table-column prop="material_code" label="物料" width="150" />
          <el-table-column prop="required_qty" label="需求" width="90" align="right" />
          <el-table-column prop="issued_qty" label="已领" width="90" align="right" />
        </el-table>
        <el-button size="small" type="warning" style="margin-top: 8px" @click="issueMaterials">一键领料</el-button>

        <div class="section-title">工序</div>
        <el-table :data="detail.operations || []" size="small" border>
          <el-table-column prop="sequence" label="顺序" width="70" />
          <el-table-column prop="operation_name" label="工序" min-width="150" />
          <el-table-column label="状态" width="90"><template #default="{ row }"><el-tag size="small">{{ opLabel(row.status) }}</el-tag></template></el-table-column>
          <el-table-column label="操作" width="120"><template #default="{ row }">
            <el-button v-if="row.status === 'pending'" size="small" type="primary" link @click="startOp(row)">开始</el-button>
            <el-button v-if="row.status === 'in_progress'" size="small" type="success" link @click="completeOp(row)">完成</el-button>
          </template></el-table-column>
        </el-table>

        <div v-if="detail.status === 'pending_qc'" class="qc-actions">
          <el-button type="success" @click="qc('pass')">质检通过并自动入库</el-button>
          <el-button type="danger" plain @click="qc('fail')">质检不通过</el-button>
        </div>
        <div v-if="detail.receipt" class="receipt-box">
          已自动入库：{{ detail.receipt.receipt_no }} / 批次 {{ detail.receipt.lot_id }} / 数量 {{ detail.receipt.quantity }}
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Api } from '../api'

const tab = ref('orders')
const loading = ref(false)
const saving = ref(false)
const overview = reactive<any>({})
const orders = ref<any[]>([])
const orderStatus = ref('')
const parts = ref<any[]>([])
const materials = ref<any[]>([])
const workstations = ref<any[]>([])
const selectedPartId = ref<number | null>(null)
const bomLines = ref<any[]>([])
const routeSteps = ref<any[]>([])
const receipts = ref<any[]>([])
const partDlg = ref(false)
const partForm = reactive({ material_code: '', material_name: '', spec: '', unit: '件', safety_stock: 0, reorder_point: 0 })
const orderDlg = ref(false)
const bomDlg = ref(false)
const routeDlg = ref(false)
const detailDlg = ref(false)
const detail = ref<any>(null)

const orderForm = reactive({ part_material_id: null as number | null, planned_qty: 1, planned_start: '', planned_end: '', priority: 3, notes: '' })
const bomForm = reactive({ component_material_id: null as number | null, quantity: 1, unit: '' })
const routeForm = reactive({ sequence: 10, operation_name: '', workstation_id: null as number | null, standard_hours: 1, qc_required: false })

const statusLabel = (s: string) => ({ planned: '已计划', in_progress: '生产中', pending_qc: '待质检', completed: '已完成', cancelled: '已取消' } as any)[s] || s
const statusTag = (s: string) => ({ planned: 'info', in_progress: 'primary', pending_qc: 'warning', completed: 'success', cancelled: 'info' } as any)[s] || 'info'
const qcLabel = (s: string) => ({ pending: '待检', passed: '通过', failed: '不通过' } as any)[s] || s
const opLabel = (s: string) => ({ pending: '待开始', in_progress: '进行中', completed: '已完成' } as any)[s] || s

async function loadAll() {
  loading.value = true
  try {
    Object.assign(overview, await Api.get('/spare-production/overview'))
    parts.value = await Api.get('/spare-production/parts')
    const materialResult: any = await Api.materials()
    materials.value = Array.isArray(materialResult) ? materialResult : (materialResult?.items || materialResult?.data || [])
    workstations.value = await Api.workstations()
    await Promise.all([loadOrders(), loadReceipts()])
    if (!selectedPartId.value && parts.value.length) { selectedPartId.value = parts.value[0].id; await Promise.all([loadBom(), loadRoute()]) }
  } catch (error: any) { ElMessage.error(error?.message || '加载失败') }
  finally { loading.value = false }
}
async function loadOrders() {
  const query = orderStatus.value ? '?status=' + encodeURIComponent(orderStatus.value) : ''
  orders.value = await Api.get('/spare-production/orders' + query)
}
async function loadReceipts() { receipts.value = await Api.get('/spare-production/receipts') }
async function loadBom() {
  if (!selectedPartId.value) return
  bomLines.value = await Api.get('/spare-production/boms?part_material_id=' + selectedPartId.value)
}
async function loadRoute() {
  if (!selectedPartId.value) return
  const result: any = await Api.get('/spare-production/routes?part_material_id=' + selectedPartId.value)
  routeSteps.value = result.steps || []
}
async function createPart() {
  if (!partForm.material_code || !partForm.material_name) return ElMessage.warning('编码和名称必填')
  saving.value = true
  try {
    await Api.post('/spare-production/parts', { ...partForm, material_type: 'bought_part' })
    ElMessage.success('自产备件已创建')
    partDlg.value = false
    Object.assign(partForm, { material_code: '', material_name: '', spec: '', unit: '件', safety_stock: 0, reorder_point: 0 })
    parts.value = await Api.get('/spare-production/parts')
  } catch (error: any) { ElMessage.error(error?.response?.data?.message || '创建失败') }
  finally { saving.value = false }
}
function openOrderDialog() { Object.assign(orderForm, { part_material_id: null, planned_qty: 1, planned_start: '', planned_end: '', priority: 3, notes: '' }); orderDlg.value = true }
async function createOrder() {
  if (!orderForm.part_material_id) return ElMessage.warning('请选择自产备件')
  saving.value = true
  try {
    await Api.post('/spare-production/orders', { ...orderForm })
    ElMessage.success('生产工单已创建')
    orderDlg.value = false
    await loadAll()
  } catch (error: any) { ElMessage.error(error?.response?.data?.message || error?.message || '创建失败') }
  finally { saving.value = false }
}
async function saveBom() {
  if (!selectedPartId.value || !bomForm.component_material_id) return ElMessage.warning('请选择物料')
  saving.value = true
  try {
    await Api.post('/spare-production/boms', { part_material_id: selectedPartId.value, ...bomForm })
    ElMessage.success('BOM 已保存')
    bomDlg.value = false
    await loadBom()
  } catch (error: any) { ElMessage.error(error?.response?.data?.message || '保存失败') }
  finally { saving.value = false }
}
async function removeBom(row: any) {
  try { await ElMessageBox.confirm('删除该物料行？', '确认'); await Api.delete('/spare-production/boms/' + row.id); await loadBom() }
  catch (error: any) { if (error !== 'cancel' && error !== 'close') ElMessage.error('删除失败') }
}
async function saveRoute() {
  if (!selectedPartId.value || !routeForm.operation_name) return ElMessage.warning('请填写工序名称')
  saving.value = true
  try {
    await Api.post('/spare-production/routes', { part_material_id: selectedPartId.value, ...routeForm })
    ElMessage.success('工艺已保存')
    routeDlg.value = false
    await loadRoute()
  } catch (error: any) { ElMessage.error(error?.response?.data?.message || '保存失败') }
  finally { saving.value = false }
}
async function removeRoute(row: any) {
  try { await ElMessageBox.confirm('删除该工序？', '确认'); await Api.delete('/spare-production/routes/' + row.id); await loadRoute() }
  catch (error: any) { if (error !== 'cancel' && error !== 'close') ElMessage.error('删除失败') }
}
async function openDetail(row: any) {
  detail.value = await Api.get('/spare-production/orders/' + row.id)
  detailDlg.value = true
}
async function refreshDetail() {
  if (detail.value?.id) detail.value = await Api.get('/spare-production/orders/' + detail.value.id)
  await loadOrders()
}
async function startOp(row: any) {
  try { await Api.post(`/spare-production/orders/${detail.value.id}/operations/${row.id}/start`); await refreshDetail() }
  catch (error: any) { ElMessage.error(error?.response?.data?.message || '开工失败') }
}
async function completeOp(row: any) {
  try { await Api.post(`/spare-production/orders/${detail.value.id}/operations/${row.id}/complete`); await refreshDetail() }
  catch (error: any) { ElMessage.error(error?.response?.data?.message || '完成失败') }
}
async function issueMaterials() {
  try { await Api.post(`/spare-production/orders/${detail.value.id}/issue`); ElMessage.success('领料完成'); await refreshDetail() }
  catch (error: any) { ElMessage.error(error?.response?.data?.message || '领料失败') }
}
async function qc(result: string) {
  try {
    const response: any = await Api.post(`/spare-production/orders/${detail.value.id}/qc`, { result })
    ElMessage.success(result === 'pass' ? '质检通过，已自动入库' : '已记录质检不通过')
    await refreshDetail()
    if (response?.receipt) detail.value.receipt = response.receipt
    await loadReceipts()
  } catch (error: any) { ElMessage.error(error?.response?.data?.message || '质检失败') }
}

onMounted(loadAll)
</script>

<style scoped>
.page { padding: 16px 24px; }
.page-title { font-size: 20px; font-weight: 600; }
.page-subtitle { color: var(--el-text-color-secondary); font-size: 13px; margin-top: 4px; }
.kpi-row { margin-bottom: 4px; }
.kpi-label { color: var(--el-text-color-secondary); font-size: 13px; }
.kpi-value { margin-top: 4px; font-size: 26px; font-weight: 700; }
.kpi-value.success { color: var(--el-color-success); }
.kpi-value.warning { color: var(--el-color-warning); }
.toolbar { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
.section-title { margin: 16px 0 8px; font-weight: 600; }
.qc-actions { display: flex; gap: 10px; margin-top: 16px; }
.receipt-box { margin-top: 12px; padding: 10px; border-radius: 8px; background: var(--el-color-success-light-9); color: var(--el-color-success); }
</style>
