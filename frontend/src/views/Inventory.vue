<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title">📦 库存管理</div>
      <el-button @click="load">刷新</el-button>
    </div>
    <el-alert v-if="alerts.length" type="error" :closable="false" style="margin-bottom: 12px" show-icon>
      ⚠ {{ alerts.length }} 项物料低于安全库存：{{ alerts.slice(0, 3).map(a => a.material_code).join('、') }}{{ alerts.length > 3 ? ` 等 ${alerts.length} 项` : '' }}
    </el-alert>
    <el-tabs v-model="tab">
      <el-tab-pane label="库存清单" name="inv">
        <el-card>
          <el-input v-model="filter" placeholder="搜索物料/批次/位置" size="small" style="margin-bottom: 12px; width: 300px" clearable />
          <el-table :data="filteredInv" stripe size="small">
            <el-table-column prop="material_code" label="编码" width="140" />
            <el-table-column prop="material_name" label="名称" min-width="200" />
            <el-table-column prop="lot_no" label="批次" width="140" />
            <el-table-column prop="supplier" label="供应商" width="120" />
            <el-table-column prop="heat_no" label="炉号" width="100" />
            <el-table-column prop="location" label="库位" width="140" />
            <el-table-column prop="quantity" label="数量" width="80" align="right" />
            <el-table-column prop="unit" label="单位" width="60" />
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <el-tag :type="row.status === 'available' ? 'success' : (row.status === 'allocated' ? 'warning' : 'info')" size="small">{{ row.status }}</el-tag>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>
      <el-tab-pane label="移动记录" name="mov">
        <el-card>
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
            <el-table-column prop="wo_code" label="工单" width="140" />
            <el-table-column prop="created_at" label="时间" width="170" />
            <el-table-column prop="notes" label="备注" min-width="150" />
          </el-table>
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
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'

const tab = ref('inv')
const inv = ref<any[]>([])
const alerts = ref<any[]>([])
const movs = ref<any[]>([])
const lots = ref<any[]>([])
const workOrders = ref<any[]>([])
const filter = ref('')
const submitting = ref(false)
const form = reactive({
  movement_type: 'receive', material_lot_id: undefined as any, quantity: 1,
  to_location: '主仓库-A-01', from_location: '', work_order_id: undefined as any, notes: ''
})

const movTypeLabel = (s: string) => ({ receive: '入库', issue: '领料', return: '退料', transfer: '调拨', adjust: '盘点' }[s] || s)
const movTypeColor = (s: string) => ({ receive: 'success', issue: 'warning', return: 'primary', transfer: 'info', adjust: 'danger' }[s] || 'info')

const filteredInv = computed(() => {
  if (!filter.value) return inv.value
  const f = filter.value.toLowerCase()
  return inv.value.filter((i: any) =>
    (i.material_name || '').toLowerCase().includes(f) ||
    (i.lot_no || '').toLowerCase().includes(f) ||
    (i.location || '').toLowerCase().includes(f)
  )
})

const load = async () => {
  const [a, b, c, d, e] = await Promise.all([
    api.get('/inventory'), api.get('/material_movements'),
    api.get('/material_lots'), api.get('/work_orders'),
    api.get('/inventory/alerts')
  ])
  inv.value = a; movs.value = b; lots.value = c; workOrders.value = d; alerts.value = (e as any).items || []
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

onMounted(load)
</script>
