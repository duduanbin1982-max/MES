<template>
  <div class="page">
    <PageToolbar>
      <div>
        <div class="page-title">项目领料</div>
        <div class="page-subtitle">项目直供库存的领用、退料与消耗流水；项目库存不参与常备库存预警。</div>
      </div>
      <div class="toolbar-right">
        <el-select v-model="equipmentId" filterable placeholder="选择项目装备" style="width: 300px" @change="loadAll">
          <el-option v-for="eq in equipments" :key="eq.id" :label="eq.instance_code + ' | ' + (eq.instance_name || '')" :value="eq.id" />
        </el-select>
        <el-button @click="loadAll">刷新</el-button>
        <el-button type="warning" @click="openClosure">库存关闭/结转</el-button>
      </div>
    </PageToolbar>

    <el-row :gutter="12" class="kpi-row">
      <el-col :span="8"><el-card shadow="hover"><div class="kpi-label">项目库存金额</div><div class="kpi-value">¥ {{ summary.total_value || 0 }}</div></el-card></el-col>
      <el-col :span="8"><el-card shadow="hover"><div class="kpi-label">库存品种</div><div class="kpi-value">{{ summary.material_count || 0 }}</div></el-card></el-col>
      <el-col :span="8"><el-card shadow="hover"><div class="kpi-label">库存总数量</div><div class="kpi-value">{{ summary.total_quantity || 0 }}</div></el-card></el-col>
    </el-row>

    <el-tabs v-model="tab">
      <el-tab-pane label="项目库存" name="stock">
        <el-table :data="inventory" v-loading="loading" stripe size="small" border>
          <el-table-column prop="material_code" label="物料编码" width="150" />
          <el-table-column prop="material_name" label="物料名称" min-width="180" />
          <el-table-column prop="lot_no" label="批次" width="180" />
          <el-table-column prop="location" label="项目库位" width="180" />
          <el-table-column prop="quantity" label="可用数量" width="100" align="right" />
          <el-table-column prop="material_unit" label="单位" width="70" />
          <el-table-column label="单位成本" width="100" align="right"><template #default="{ row }">¥ {{ row.effective_unit_cost || 0 }}</template></el-table-column>
          <el-table-column label="库存金额" width="120" align="right"><template #default="{ row }">¥ {{ row.inventory_value || 0 }}</template></el-table-column>
          <el-table-column label="质量状态" width="100"><template #default="{ row }"><el-tag size="small" :type="row.status === 'available' ? 'success' : 'warning'">{{ row.status === 'available' ? '可用' : row.status }}</el-tag></template></el-table-column>
          <el-table-column label="操作" width="150" fixed="right">
            <template #default="{ row }">
              <el-button size="small" type="primary" link :disabled="row.status !== 'available' || row.quantity <= 0" @click="openIssue(row)">领料</el-button>
              <el-button size="small" type="warning" link @click="openReturn(row)">退料</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!loading && equipmentId && !inventory.length" description="该项目暂无项目直供库存" />
      </el-tab-pane>

      <el-tab-pane label="关闭记录" name="closures">
        <el-table :data="closures" v-loading="loading" size="small" border>
          <el-table-column prop="closed_at" label="关闭时间" width="180" />
          <el-table-column prop="total_items" label="品种数" width="90" align="right" />
          <el-table-column prop="total_quantity" label="数量" width="100" align="right" />
          <el-table-column prop="total_value" label="结转金额" width="120" align="right"><template #default="{ row }">¥ {{ row.total_value || 0 }}</template></el-table-column>
          <el-table-column prop="notes" label="备注" min-width="200" />
          <el-table-column label="明细" min-width="320"><template #default="{ row }"><span v-for="item in row.items" :key="item.id" class="closure-line">{{ item.material_code }} × {{ item.quantity }}（{{ dispositionLabel(item.disposition) }}）</span></template></el-table-column>
        </el-table>
        <el-empty v-if="!loading && !closures.length" description="暂无关闭记录" />
      </el-tab-pane>

      <el-tab-pane label="领用/退料流水" name="movements">
        <el-table :data="movements" v-loading="loading" stripe size="small" border>
          <el-table-column prop="created_at" label="时间" width="170" />
          <el-table-column label="类型" width="90"><template #default="{ row }"><el-tag :type="row.movement_type === 'issue' ? 'danger' : 'success'" size="small">{{ movementLabel(row.movement_type) }}</el-tag></template></el-table-column>
          <el-table-column prop="material_code" label="物料编码" width="150" />
          <el-table-column prop="material_name" label="物料名称" min-width="180" />
          <el-table-column prop="lot_no" label="批次" width="180" />
          <el-table-column prop="quantity" label="数量" width="100" align="right" />
          <el-table-column label="金额" width="110" align="right"><template #default="{ row }">¥ {{ row.amount || 0 }}</template></el-table-column>
          <el-table-column prop="from_location" label="出库库位" width="160" />
          <el-table-column prop="notes" label="备注" min-width="180" />
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="closureDlg" title="项目库存关闭/结转" width="760px">
      <el-alert type="warning" :closable="false" show-icon style="margin-bottom:12px"
        title="关闭后项目库存将全部处理：转常备、退供应商或报废。此操作会生成项目库存关闭记录。" />
      <el-table :data="closureRows" size="small" border max-height="420">
        <el-table-column prop="material_code" label="物料" width="150" />
        <el-table-column prop="lot_no" label="批次" width="160" />
        <el-table-column prop="quantity" label="数量" width="90" align="right" />
        <el-table-column label="金额" width="100" align="right"><template #default="{ row }">¥ {{ row.inventory_value || 0 }}</template></el-table-column>
        <el-table-column label="处置方式" width="160">
          <template #default="{ row }">
            <el-select v-model="row.disposition" style="width:100%">
              <el-option label="转常备库存" value="transfer" />
              <el-option label="退供应商" value="return_supplier" />
              <el-option label="报废" value="scrap" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="备注" min-width="160"><template #default="{ row }"><el-input v-model="row.notes" placeholder="可选" /></template></el-table-column>
      </el-table>
      <div class="closure-total">待处理金额：<strong>¥ {{ closureTotalValue }}</strong></div>
      <template #footer><el-button @click="closureDlg = false">取消</el-button><el-button type="danger" :loading="saving" @click="submitClosure">确认关闭</el-button></template>
    </el-dialog>

    <el-dialog v-model="issueDlg" title="项目直供领料" width="460px">
      <el-form label-width="90px">
        <el-form-item label="物料"><el-input :model-value="current?.material_code + ' · ' + current?.material_name" disabled /></el-form-item>
        <el-form-item label="批次"><el-input :model-value="current?.lot_no" disabled /></el-form-item>
        <el-form-item label="可用库存"><el-input :model-value="current?.quantity" disabled /></el-form-item>
        <el-form-item label="领料数量" required><el-input-number v-model="form.quantity" :min="0.001" :max="current?.quantity || 0" :precision="3" style="width:100%" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="form.notes" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="issueDlg = false">取消</el-button><el-button type="primary" :loading="saving" @click="submitIssue">确认领料</el-button></template>
    </el-dialog>

    <el-dialog v-model="returnDlg" title="项目直供退料" width="460px">
      <el-form label-width="90px">
        <el-form-item label="物料"><el-input :model-value="current?.material_code + ' · ' + current?.material_name" disabled /></el-form-item>
        <el-form-item label="退料数量" required><el-input-number v-model="form.quantity" :min="0.001" :precision="3" style="width:100%" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="form.notes" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="returnDlg = false">取消</el-button><el-button type="primary" :loading="saving" @click="submitReturn">确认退料</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import PageToolbar from '../components/PageToolbar.vue'
import api from '../api'

const equipments = ref<any[]>([])
const equipmentId = ref<number | null>(null)
const inventory = ref<any[]>([])
const movements = ref<any[]>([])
const loading = ref(false)
const saving = ref(false)
const tab = ref('stock')
const issueDlg = ref(false)
const returnDlg = ref(false)
const current = ref<any>(null)
const summary = ref<any>({ total_value: 0, material_count: 0, total_quantity: 0 })
const closures = ref<any[]>([])
const closureDlg = ref(false)
const closureRows = ref<any[]>([])
const closureTotalValue = ref(0)
const form = reactive({ quantity: 1, notes: '' })
const movementLabel = (value: string) => ({ issue: '领料', return: '退料', transfer: '转常备', return_supplier: '退供应商', scrap: '报废' } as any)[value] || value
const dispositionLabel = (value: string) => ({ transfer: '转常备', return_supplier: '退供应商', scrap: '报废' } as any)[value] || value

const loadEquipments = async () => {
  try {
    const result: any = await api.get('/equipment_instances')
    equipments.value = Array.isArray(result) ? result : (result.items || [])
    if (!equipmentId.value && equipments.value.length) equipmentId.value = equipments.value[0].id
  } catch { equipments.value = [] }
}
const loadAll = async () => {
  if (!equipmentId.value) return
  loading.value = true
  try {
    inventory.value = await api.get('/project-inventory', { params: { equipment_instance_id: equipmentId.value } })
    movements.value = await api.get('/project-inventory/movements', { params: { equipment_instance_id: equipmentId.value } })
    summary.value = await api.get('/project-inventory/summary', { params: { equipment_instance_id: equipmentId.value } })
    closures.value = await api.get('/project-inventory/closures', { params: { equipment_instance_id: equipmentId.value } })
  } catch (error: any) { ElMessage.error(error?.response?.data?.message || '加载项目库存失败') } finally { loading.value = false }
}
const openClosure = () => {
  closureRows.value = inventory.value.map((row: any) => ({ ...row, disposition: 'transfer', notes: '' }))
  closureTotalValue.value = Math.round(closureRows.value.reduce((sum: number, row: any) => sum + Number(row.inventory_value || 0), 0) * 100) / 100
  closureDlg.value = true
}
const submitClosure = async () => {
  saving.value = true
  try {
    const result: any = await api.post('/project-inventory/close', {
      equipment_instance_id: equipmentId.value,
      actions: closureRows.value.map((row: any) => ({ inventory_id: row.id, disposition: row.disposition, notes: row.notes || undefined })),
      notes: '项目库存关闭/结转',
    })
    ElMessage.success(`关闭完成：${result.total_items} 项，金额 ¥${result.total_value}`)
    closureDlg.value = false
    await loadAll()
  } catch (error: any) { ElMessage.error(error?.response?.data?.message || '关闭失败') } finally { saving.value = false }
}
const openIssue = (row: any) => { current.value = row; Object.assign(form, { quantity: Math.min(1, Number(row.quantity)), notes: '' }); issueDlg.value = true }
const openReturn = (row: any) => { current.value = row; Object.assign(form, { quantity: 1, notes: '' }); returnDlg.value = true }
const submitIssue = async () => {
  if (!form.quantity || form.quantity <= 0) return ElMessage.warning('请填写领料数量')
  saving.value = true
  try {
    await api.post('/project-inventory/issue', { inventory_id: current.value.id, quantity: form.quantity, notes: form.notes })
    ElMessage.success(`项目领料成功，金额 ¥${current.value?.effective_unit_cost ? (Number(current.value.effective_unit_cost) * Number(form.quantity)).toFixed(2) : '0.00'}`)
    issueDlg.value = false
    await loadAll()
  } catch (error: any) { ElMessage.error(error?.response?.data?.message || '领料失败') } finally { saving.value = false }
}
const submitReturn = async () => {
  if (!form.quantity || form.quantity <= 0) return ElMessage.warning('请填写退料数量')
  saving.value = true
  try {
    await api.post('/project-inventory/return', { inventory_id: current.value.id, quantity: form.quantity, notes: form.notes })
    ElMessage.success('项目退料成功')
    returnDlg.value = false
    await loadAll()
  } catch (error: any) { ElMessage.error(error?.response?.data?.message || '退料失败') } finally { saving.value = false }
}
onMounted(async () => { await loadEquipments(); await loadAll() })
</script>

<style scoped>
.page { padding: 16px 24px; }
.page-title { font-size: 20px; font-weight: 600; }
.page-subtitle { color: var(--el-text-color-secondary); font-size: 13px; margin-top: 4px; }
.toolbar-right { display: flex; align-items: center; gap: 10px; }
.kpi-row { margin-bottom: 12px; }
.kpi-label { color: var(--el-text-color-secondary); font-size: 13px; }
.kpi-value { margin-top: 4px; font-size: 24px; font-weight: 700; }
.closure-total { margin-top: 12px; text-align: right; }
.closure-line { display: inline-block; margin-right: 12px; }
</style>
