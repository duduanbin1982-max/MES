<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title">📦 库存管理</div>
      <el-button @click="load">刷新</el-button>
      <el-button type="success" @click="dlgReceive = true">📥 一键入库</el-button>
      <el-button type="warning" @click="dlgAllocate = true">🔁 调拨/预留</el-button>
      <el-button type="info" @click="dlgRelease = true">🔓 释放预留</el-button>
      <el-button type="primary" @click="dlgBatch = true">⚡ 批量入库</el-button>
    </div>
    <el-alert v-if="alerts.length" type="error" :closable="false" style="margin-bottom: 12px" show-icon>
      ⚠ {{ alerts.length }} 项物料低于安全库存: {{ alerts.slice(0, 3).map(a => a.material_code).join('、') }}{{ alerts.length > 3 ? ` 等 ${alerts.length} 项` : '' }}
    </el-alert>
    <el-tabs v-model="tab">
      <el-tab-pane label="库存清单" name="inv">
        <el-card>
          <el-input v-model="filter" placeholder="搜索物料/批次/位置" size="small" style="margin-bottom: 12px; width: 300px" clearable />
          <el-table :data="filteredInv" stripe size="small">
            <el-table-column prop="material_code" label="编码" width="140" />
            <el-table-column prop="material_name" label="名称" min-width="180" />
            <el-table-column prop="lot_no" label="批次" width="140" />
            <el-table-column prop="location" label="库位" width="140" />
            <el-table-column prop="quantity" label="数量" width="80" align="right" />
            <el-table-column prop="unit" label="单位" width="60" />
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <el-tag :type="row.status === 'available' ? 'success' : (row.status === 'allocated' ? 'warning' : 'info')" size="small">{{ row.status }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="220" fixed="right">
              <template #default="{ row }">
                <el-button size="small" link type="primary" @click="openLotDetail(row)">详情</el-button>
                <el-button size="small" link type="warning" @click="openSplit(row)" :disabled="!row.quantity || row.quantity <= 0">拆批</el-button>
                <el-button size="small" link type="success" @click="openMerge(row)">合批</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <el-tab-pane :label="'移动记录' + (movTotal > 0 ? ' (' + movTotal + ')' : '')" name="mov">
        <el-card>
          <el-form :inline="true" size="small" style="margin-bottom: 12px">
            <el-form-item label="类型">
              <el-select v-model="movFilter.movement_type" clearable placeholder="全部" style="width: 120px">
                <el-option v-for="t in movTypeOptions" :key="t.value" :label="t.label" :value="t.value" />
              </el-select>
            </el-form-item>
            <el-form-item label="批次">
              <el-select v-model="movFilter.material_lot_id" clearable filterable placeholder="全部" style="width: 200px">
                <el-option v-for="l in lots" :key="l.id" :label="l.lot_no + ' | ' + l.material_name" :value="l.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="日期">
              <el-date-picker v-model="movFilter.dateRange" type="daterange" range-separator="→" start-placeholder="起" end-placeholder="止" value-format="YYYY-MM-DD" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="movPage = 1; loadMovs()">查询</el-button>
              <el-button @click="resetMovFilter">重置</el-button>
            </el-form-item>
          </el-form>
          <el-table :data="movs" stripe size="small">
            <el-table-column prop="material_name" label="物料" min-width="180" />
            <el-table-column prop="lot_no" label="批次" width="120" />
            <el-table-column label="类型" width="100">
              <template #default="{ row }">
                <el-tag :type="movTypeColor(row.movement_type)" size="small">{{ movTypeLabel(row.movement_type) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="quantity" label="数量" width="80" align="right" />
            <el-table-column prop="from_location" label="源库位" width="100" />
            <el-table-column prop="to_location" label="目标库位" width="100" />
            <el-table-column prop="created_at" label="时间" width="170" />
            <el-table-column prop="notes" label="备注" min-width="150" />
          </el-table>
          <el-pagination
            v-model:current-page="movPage"
            v-model:page-size="movLimit"
            :total="movTotal"
            :page-sizes="[20, 50, 100, 200]"
            layout="total, sizes, prev, pager, next, jumper"
            style="margin-top: 12px; text-align: right"
            @current-change="loadMovs"
            @size-change="(s: number) => { movLimit = s; movPage = 1; loadMovs() }"
          />
        </el-card>
      </el-tab-pane>

      <el-tab-pane label="操作" name="ops">
        <el-card>
          <el-form :model="form" label-width="100px" style="max-width: 600px">
            <el-form-item label="类型" required>
              <el-radio-group v-model="form.movement_type">
                <el-radio-button label="receive">入库</el-radio-button>
                <el-radio-button label="issue">领料</el-radio-button>
                <el-radio-button label="return">退料</el-radio-button>
                <el-radio-button label="transfer">调拨</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="批次" required>
              <el-select v-model="form.material_lot_id" filterable placeholder="选批次" style="width: 100%">
                <el-option v-for="l in lots" :key="l.id" :label="l.lot_no + ' | ' + l.material_name" :value="l.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="数量" required>
              <el-input-number v-model="form.quantity" :min="0" :step="1" />
            </el-form-item>
            <el-form-item :label="form.movement_type === 'transfer' ? '源库位' : '目标库位'" required>
              <el-input v-model="form.to_location" />
            </el-form-item>
            <el-form-item v-if="form.movement_type === 'transfer'" label="目标库位" required>
              <el-input v-model="form.from_location" />
            </el-form-item>
            <el-form-item label="工单">
              <el-select v-model="form.work_order_id" filterable clearable style="width: 100%">
                <el-option v-for="w in workOrders" :key="w.id" :label="w.wo_code" :value="w.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="备注">
              <el-input v-model="form.notes" type="textarea" :rows="2" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="submit" :loading="submitting">提交</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="dlgReceive" title="一键入库" width="520px">
      <el-form :model="fReceive" label-width="100px">
        <el-form-item label="物料"><el-select v-model="fReceive.material_id" filterable style="width:100%"><el-option v-for="m in materials" :key="m.id" :label="m.material_code+' | '+m.material_name" :value="m.id" /></el-select></el-form-item>
        <el-form-item label="批次号"><el-input v-model="fReceive.lot_no" /></el-form-item>
        <el-form-item label="供应商"><el-input v-model="fReceive.supplier" /></el-form-item>
        <el-form-item label="炉号"><el-input v-model="fReceive.heat_no" /></el-form-item>
        <el-form-item label="数量"><el-input-number v-model="fReceive.quantity" :min="0" :step="1" /></el-form-item>
        <el-form-item label="单位"><el-input v-model="fReceive.unit" /></el-form-item>
        <el-form-item label="库位"><el-input v-model="fReceive.location" /></el-form-item>
        <el-form-item label="证书号"><el-input v-model="fReceive.certificate_no" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlgReceive=false">取消</el-button>
        <el-button type="primary" :loading="busy" @click="doReceive">入库</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="dlgAllocate" title="调拨/预留库存" width="480px">
      <el-form :model="fAllocate" label-width="100px">
        <el-form-item label="批次"><el-select v-model="fAllocate.material_lot_id" filterable style="width:100%"><el-option v-for="l in lots" :key="l.id" :label="l.lot_no+' | '+l.material_name" :value="l.id" /></el-select></el-form-item>
        <el-form-item label="数量"><el-input-number v-model="fAllocate.quantity" :min="0" :step="1" /></el-form-item>
        <el-form-item label="目标库位"><el-input v-model="fAllocate.location" placeholder="选填, 调拨时填" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="fAllocate.notes" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlgAllocate=false">取消</el-button>
        <el-button type="primary" :loading="busy" @click="doAllocate">确认</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="dlgRelease" title="释放预留" width="420px">
      <el-form :model="fRelease" label-width="100px">
        <el-form-item label="批次"><el-select v-model="fRelease.material_lot_id" filterable style="width:100%"><el-option v-for="l in lots.filter(x=>x.status==='allocated')" :key="l.id" :label="l.lot_no+' | '+l.material_name+' (余 '+x2.qty(l)+')'" :value="l.id" /></el-select></el-form-item>
        <el-form-item label="数量"><el-input-number v-model="fRelease.quantity" :min="0" :step="1" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlgRelease=false">取消</el-button>
        <el-button type="primary" :loading="busy" @click="doRelease">释放</el-button>
      </template>
    </el-dialog>

    <!-- 拆批 -->
    <el-dialog v-model="dlgSplit" title="拆批" width="460px">
      <el-form :model="fSplit" label-width="100px">
        <el-form-item label="源批次"><el-input :value="fSplit.src_lot_no" disabled /></el-form-item>
        <el-form-item label="拆出数量" required>
          <el-input-number v-model="fSplit.quantity" :min="0.01" :step="1" :max="fSplit.src_max" />
          <span style="margin-left: 8px; color: #909399">/ 可用 {{ fSplit.src_max }}</span>
        </el-form-item>
        <el-form-item label="新批次号" required><el-input v-model="fSplit.new_lot_no" /></el-form-item>
        <el-form-item label="库位"><el-input v-model="fSplit.location" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="fSplit.notes" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlgSplit=false">取消</el-button>
        <el-button type="primary" :loading="busy" @click="doSplit">确认拆批</el-button>
      </template>
    </el-dialog>

    <!-- 合批 -->
    <el-dialog v-model="dlgMerge" title="合批 (把其它 lot 合到此 lot)" width="540px">
      <el-form :model="fMerge" label-width="100px">
        <el-form-item label="目标批次"><el-input :value="fMerge.dst_lot_no + ' | ' + fMerge.dst_material_name" disabled /></el-form-item>
        <el-form-item label="源批次(多选)" required>
          <el-select v-model="fMerge.source_lot_ids" multiple filterable style="width:100%">
            <el-option v-for="l in mergeCandidates" :key="l.id" :label="l.lot_no + ' | ' + l.material_name + ' (库 ' + (l.location || '-') + ': ' + (l.quantity || 0) + ')'" :value="l.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="库位"><el-input v-model="fMerge.location" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="fMerge.notes" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlgMerge=false">取消</el-button>
        <el-button type="primary" :loading="busy" @click="doMerge">确认合批</el-button>
      </template>
    </el-dialog>

    <!-- 批量入库 -->
    <el-dialog v-model="dlgBatch" title="批量入库" width="720px">
      <el-form :model="fBatch" label-width="100px">
        <el-form-item label="模式">
          <el-radio-group v-model="fBatch.atomic">
            <el-radio-button :value="false">非原子 (部分成功)</el-radio-button>
            <el-radio-button :value="true">原子 (全成功或全回滚)</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item>
          <el-button size="small" @click="addBatchRow">+ 添加一行</el-button>
          <el-button size="small" type="danger" @click="clearBatchRows" :disabled="fBatch.rows.length <= 1">清空</el-button>
        </el-form-item>
        <div style="max-height: 360px; overflow-y: auto">
          <el-table :data="fBatch.rows" size="small" border>
            <el-table-column label="#" width="50" type="index" />
            <el-table-column label="批次" width="200">
              <template #default="{ row }">
                <el-select v-model="row.material_lot_id" filterable size="small" style="width:100%">
                  <el-option v-for="l in lots" :key="l.id" :label="l.lot_no + ' | ' + l.material_name" :value="l.id" />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="类型" width="100">
              <template #default="{ row }">
                <el-select v-model="row.movement_type" size="small" style="width:100%">
                  <el-option v-for="t in movTypeOptions" :key="t.value" :label="t.label" :value="t.value" />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="数量" width="100">
              <template #default="{ row }">
                <el-input-number v-model="row.quantity" :min="0" :step="1" size="small" style="width:100%" />
              </template>
            </el-table-column>
            <el-table-column label="目标库位" width="120">
              <template #default="{ row }">
                <el-input v-model="row.to_location" size="small" placeholder="receive 必填" />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="60">
              <template #default="{ $index }">
                <el-button size="small" link type="danger" @click="fBatch.rows.splice($index, 1)" :disabled="fBatch.rows.length <= 1">删</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
        <el-alert v-if="fBatch.result" :type="fBatch.result.success ? 'success' : 'warning'" :closable="false" style="margin-top: 12px">
          <pre style="margin: 0; white-space: pre-wrap; font-size: 12px">{{ JSON.stringify(fBatch.result, null, 2) }}</pre>
        </el-alert>
      </el-form>
      <template #footer>
        <el-button @click="dlgBatch=false">关闭</el-button>
        <el-button type="primary" :loading="busy" @click="doBatch">提交 ({{ fBatch.rows.length }} 条)</el-button>
      </template>
    </el-dialog>

    <!-- Lot 详情 -->
    <el-dialog v-model="dlgLotDetail" :title="'批次详情: ' + (lotDetail?.lot_no || '')" width="640px">
      <div v-if="lotDetail" v-loading="lotDetailLoading">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="物料编码">{{ lotDetail.material_code }}</el-descriptions-item>
          <el-descriptions-item label="物料名称">{{ lotDetail.material_name }}</el-descriptions-item>
          <el-descriptions-item label="规格">{{ lotDetail.spec || '-' }}</el-descriptions-item>
          <el-descriptions-item label="单位">{{ lotDetail.material_unit || lotDetail.unit || '-' }}</el-descriptions-item>
          <el-descriptions-item label="批次号">{{ lotDetail.lot_no }}</el-descriptions-item>
          <el-descriptions-item label="供应商">{{ lotDetail.supplier || '-' }}</el-descriptions-item>
          <el-descriptions-item label="炉号">{{ lotDetail.heat_no || '-' }}</el-descriptions-item>
          <el-descriptions-item label="证书号">{{ lotDetail.certificate_no || '-' }}</el-descriptions-item>
          <el-descriptions-item label="到货日期">{{ lotDetail.received_date || '-' }}</el-descriptions-item>
          <el-descriptions-item label="总库存"><strong style="color: #409eff">{{ lotDetail.inventory_total }}</strong></el-descriptions-item>
        </el-descriptions>
        <h4 style="margin-top: 16px">📍 各库位库存</h4>
        <el-table :data="lotDetail.inventory" size="small" border>
          <el-table-column prop="location" label="库位" />
          <el-table-column prop="quantity" label="数量" align="right" />
          <el-table-column prop="unit" label="单位" width="80" />
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="row.status === 'available' ? 'success' : 'warning'" size="small">{{ row.status }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="last_updated" label="更新" width="170" />
        </el-table>
        <h4 style="margin-top: 16px">📊 移动汇总</h4>
        <el-table :data="movStatRows" size="small" border>
          <el-table-column prop="type_label" label="类型" />
          <el-table-column prop="qty" label="累计数量" align="right" />
          <el-table-column prop="cnt" label="次数" align="right" />
        </el-table>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'

const tab = ref('inv')
const inv = ref<any[]>([])
const alerts = ref<any[]>([])
const lots = ref<any[]>([])
const workOrders = ref<any[]>([])
const materials = ref<any[]>([])
const filter = ref('')
const submitting = ref(false)

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

const form = reactive({
  movement_type: 'receive', material_lot_id: undefined as any, quantity: 1,
  to_location: '主仓库-A-01', from_location: '', work_order_id: undefined as any, notes: ''
})

const filteredInv = computed(() => {
  if (!filter.value) return inv.value
  const f = filter.value.toLowerCase()
  return inv.value.filter((i: any) =>
    (i.material_name || '').toLowerCase().includes(f) ||
    (i.lot_no || '').toLowerCase().includes(f) ||
    (i.location || '').toLowerCase().includes(f)
  )
})

const x2 = { qty: (l: any) => l.available ?? l.quantity ?? 0 }

const load = async () => {
  const [a, c, d, e] = await Promise.all([
    api.get('/inventory'), api.get('/material_lots'), api.get('/work_orders'),
    api.get('/inventory/alerts')
  ])
  inv.value = a; lots.value = c; workOrders.value = d; alerts.value = (e as any).items || []
  await loadMovs()
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
  if (r && Array.isArray(r.items)) {
    movs.value = r.items
    movTotal.value = r.total || 0
  } else {
    movs.value = r || []
    movTotal.value = movs.value.length
  }
}

const resetMovFilter = () => {
  movFilter.movement_type = undefined
  movFilter.material_lot_id = undefined
  movFilter.dateRange = undefined
  movPage.value = 1
  loadMovs()
}

const submit = async () => {
  if (!form.material_lot_id || !form.quantity) { ElMessage.warning('请填写完整'); return }
  submitting.value = true
  try {
    const payload: any = { ...form }
    if (form.movement_type !== 'transfer') delete payload.from_location
    if (form.movement_type !== 'issue' && form.movement_type !== 'return') delete payload.work_order_id
    await api.post('/material_movements', payload)
    ElMessage.success('已记录')
    await load()
  } catch (e: any) { ElMessage.error('失败: ' + (e.response?.data?.error || e.message)) }
  finally { submitting.value = false }
}

onMounted(async () => {
  await load()
  materials.value = await api.materials()
})

const dlgReceive = ref(false)
const dlgAllocate = ref(false)
const dlgRelease = ref(false)
const dlgSplit = ref(false)
const dlgMerge = ref(false)
const dlgBatch = ref(false)
const dlgLotDetail = ref(false)
const lotDetail = ref<any>(null)
const lotDetailLoading = ref(false)
const busy = ref(false)

const fReceive = reactive({ material_id: undefined as any, lot_no: '', supplier: '', heat_no: '', quantity: 1, unit: '件', location: '主仓库-A-01', certificate_no: '' })
const fAllocate = reactive({ material_lot_id: undefined as any, quantity: 1, location: '', notes: '' })
const fRelease = reactive({ material_lot_id: undefined as any, quantity: 1 })

const fSplit = reactive({ src_id: 0, src_lot_no: '', src_max: 0, quantity: 1, new_lot_no: '', location: '主仓库-A-01', notes: '' })
const fMerge = reactive({ dst_id: 0, dst_lot_no: '', dst_material_name: '', source_lot_ids: [] as number[], location: '主仓库-A-01', notes: '' })
const mergeCandidates = computed(() => {
  if (!fMerge.dst_id) return []
  const dst = inv.value.find((i: any) => i.material_lot_id === fMerge.dst_id)
  if (!dst) return []
  return inv.value.filter((i: any) => i.material_lot_id !== fMerge.dst_id && i.material_id === dst.material_id && (i.quantity || 0) > 0)
})
const movStatRows = computed(() => {
  if (!lotDetail.value?.movement_stats) return []
  return Object.entries(lotDetail.value.movement_stats).map(([k, v]: any) => ({
    type_label: movTypeLabel(k), qty: v.qty, cnt: v.cnt
  }))
})

const fBatch = reactive({ atomic: false, rows: [] as any[], result: null as any })
const addBatchRow = () => { fBatch.rows.push({ material_lot_id: undefined, movement_type: 'receive', quantity: 1, to_location: '主仓库-A-01' }) }
const clearBatchRows = () => { fBatch.rows.splice(0, fBatch.rows.length); addBatchRow() }
const openBatch = () => { fBatch.result = null; if (fBatch.rows.length === 0) addBatchRow(); dlgBatch.value = true }
watch(dlgBatch, (v) => { if (v && fBatch.rows.length === 0) addBatchRow() })

const doReceive = async () => {
  if (!fReceive.material_id || !fReceive.lot_no || !fReceive.quantity) { ElMessage.warning('请填完整'); return }
  busy.value = true
  try { await api.receiveLot(fReceive); ElMessage.success('入库成功'); dlgReceive.value = false; await load() }
  catch (e: any) { ElMessage.error('失败: ' + (e.response?.data?.error || e.message)) }
  finally { busy.value = false }
}
const doAllocate = async () => {
  if (!fAllocate.material_lot_id || !fAllocate.quantity) { ElMessage.warning('请填完整'); return }
  busy.value = true
  try { await api.allocate(fAllocate); ElMessage.success('调拨成功'); dlgAllocate.value = false; await load() }
  catch (e: any) { ElMessage.error('失败: ' + (e.response?.data?.error || e.message)) }
  finally { busy.value = false }
}
const doRelease = async () => {
  if (!fRelease.material_lot_id || !fRelease.quantity) { ElMessage.warning('请填完整'); return }
  busy.value = true
  try { await api.release(fRelease); ElMessage.success('已释放'); dlgRelease.value = false; await load() }
  catch (e: any) { ElMessage.error('失败: ' + (e.response?.data?.error || e.message)) }
  finally { busy.value = false }
}

const openLotDetail = async (row: any) => {
  dlgLotDetail.value = true
  lotDetailLoading.value = true
  lotDetail.value = null
  try { lotDetail.value = await api.materialLot(row.material_lot_id) }
  catch (e: any) { ElMessage.error('加载失败: ' + (e.response?.data?.error || e.message)); dlgLotDetail.value = false }
  finally { lotDetailLoading.value = false }
}

const openSplit = (row: any) => {
  fSplit.src_id = row.material_lot_id
  fSplit.src_lot_no = row.lot_no
  fSplit.src_max = row.quantity || 0
  fSplit.quantity = 1
  fSplit.new_lot_no = row.lot_no + '-S' + Date.now().toString().slice(-4)
  fSplit.location = row.location || '主仓库-A-01'
  fSplit.notes = ''
  dlgSplit.value = true
}
const doSplit = async () => {
  if (!fSplit.quantity || !fSplit.new_lot_no) { ElMessage.warning('请填完整'); return }
  busy.value = true
  try {
    const r = await api.splitLot(fSplit.src_id, { quantity: fSplit.quantity, new_lot_no: fSplit.new_lot_no, location: fSplit.location, notes: fSplit.notes })
    ElMessage.success('拆批成功: ' + r.new_lot_no)
    dlgSplit.value = false
    await load()
  } catch (e: any) { ElMessage.error('失败: ' + (e.response?.data?.error || e.message)) }
  finally { busy.value = false }
}

const openMerge = (row: any) => {
  fMerge.dst_id = row.material_lot_id
  fMerge.dst_lot_no = row.lot_no
  fMerge.dst_material_name = row.material_name
  fMerge.source_lot_ids = []
  fMerge.location = row.location || '主仓库-A-01'
  fMerge.notes = ''
  dlgMerge.value = true
}
const doMerge = async () => {
  if (fMerge.source_lot_ids.length === 0) { ElMessage.warning('请选源批次'); return }
  busy.value = true
  try {
    const r = await api.mergeLot(fMerge.dst_id, { source_lot_ids: fMerge.source_lot_ids, location: fMerge.location, notes: fMerge.notes })
    ElMessage.success('合批成功: 合并了 ' + r.merged.length + ' 个源 lot')
    dlgMerge.value = false
    await load()
  } catch (e: any) { ElMessage.error('失败: ' + (e.response?.data?.error || e.message)) }
  finally { busy.value = false }
}

const doBatch = async () => {
  if (fBatch.rows.length === 0) { ElMessage.warning('请添加至少一行'); return }
  busy.value = true
  try {
    fBatch.result = await api.batchMovements(fBatch.rows, fBatch.atomic)
    if (fBatch.result.success) ElMessage.success('批量成功: ' + fBatch.result.count + ' 条')
    else ElMessage.warning('部分失败: ' + fBatch.result.count + ' 成功, ' + (fBatch.result.failed?.length || 0) + ' 失败')
    await load()
  } catch (e: any) { ElMessage.error('失败: ' + (e.response?.data?.error || e.message)) }
  finally { busy.value = false }
}
</script>
