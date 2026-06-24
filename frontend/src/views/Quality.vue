<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title">🔍 质检管理</div>
      <el-button type="primary" @click="showCreate = true">+ 新建质检记录</el-button>
    </div>
    <el-row :gutter="16" style="margin-bottom: 12px">
      <el-col :span="6">
        <el-card><div class="stat-card">
          <div class="stat-label">总检数</div>
          <div class="stat-value">{{ stats.total || 0 }}</div>
        </div></el-card>
      </el-col>
      <el-col :span="6">
        <el-card><div class="stat-card">
          <div class="stat-label">✓ 通过</div>
          <div class="stat-value" style="color: #67c23a">{{ stats.pass || 0 }}</div>
        </div></el-card>
      </el-col>
      <el-col :span="6">
        <el-card><div class="stat-card">
          <div class="stat-label">✗ 不通过</div>
          <div class="stat-value" style="color: #f56c6c">{{ stats.fail || 0 }}</div>
        </div></el-card>
      </el-col>
      <el-col :span="6">
        <el-card><div class="stat-card">
          <div class="stat-label">合格率</div>
          <div class="stat-value" :style="{color: (stats.pass_rate||0) >= 95 ? '#67c23a' : '#e6a23c'}">{{ stats.pass_rate || 0 }}%</div>
        </div></el-card>
      </el-col>
    </el-row>
    <el-card>
      <el-form :inline="true" :model="filters" size="default">
        <el-form-item label="实例">
          <el-select v-model="filters.project_id" clearable placeholder="全部" style="width: 220px">
            <el-option v-for="i in instances" :key="i.id" :label="i.instance_code" :value="i.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="filters.inspection_type" clearable placeholder="全部" style="width: 140px">
            <el-option v-for="t in types" :key="t.value" :label="t.label" :value="t.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="结果">
          <el-select v-model="filters.result" clearable placeholder="全部" style="width: 100px">
            <el-option label="通过" value="pass" />
            <el-option label="不通过" value="fail" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="load">查询</el-button>
        </el-form-item>
      </el-form>
    </el-card>
    <el-card style="margin-top: 12px">
      <el-table :data="rows" stripe v-loading="loading" size="small">
        <el-table-column prop="instance_code" label="实例" width="140" />
        <el-table-column prop="wo_code" label="工单" width="160" />
        <el-table-column label="类型" width="120">
          <template #default="{ row }">
            <el-tag size="small" :type="typeColor(row.inspection_type)">{{ typeLabel(row.inspection_type) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="结果" width="100">
          <template #default="{ row }">
            <el-tag :type="row.result === 'pass' ? 'success' : 'danger'" size="small">{{ row.result === 'pass' ? '✓ 通过' : '✗ 不通过' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="inspector_name" label="检验员" width="100" />
        <el-table-column prop="inspection_date" label="日期" width="170" />
        <el-table-column prop="notes" label="备注" min-width="200" />
      </el-table>
    </el-card>

    <el-dialog v-model="showCreate" title="新建质检记录" width="500px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="实例" required>
          <el-select v-model="form.equipment_instance_id" placeholder="选实例" style="width: 100%">
            <el-option v-for="i in instances" :key="i.id" :label="i.instance_code + ' | ' + (i.instance_name || '')" :value="i.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="工单">
          <el-select v-model="form.work_order_id" clearable style="width: 100%">
            <el-option v-for="w in workOrders" :key="w.id" :label="w.wo_code" :value="w.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="检验类型" required>
          <el-select v-model="form.inspection_type" style="width: 100%">
            <el-option v-for="t in types" :key="t.value" :label="t.label" :value="t.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="结果" required>
          <el-radio-group v-model="form.result">
            <el-radio-button label="pass">通过</el-radio-button>
            <el-radio-button label="fail">不通过</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="检验员">
          <el-select v-model="form.inspector_id" style="width: 100%">
            <el-option v-for="u in users" :key="u.id" :label="u.full_name" :value="u.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.notes" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreate = false">取消</el-button>
        <el-button type="primary" @click="submit" :loading="submitting">提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'

const filters = reactive({ project_id: undefined as any, inspection_type: '', result: '' })
const rows = ref<any[]>([])
const stats = ref<any>({ total: 0, pass: 0, fail: 0, pass_rate: 0 })
const instances = ref<any[]>([])
const workOrders = ref<any[]>([])
const users = ref<any[]>([])
const loading = ref(false)
const showCreate = ref(false)
const submitting = ref(false)
const form = reactive({
  equipment_instance_id: undefined as any, work_order_id: undefined as any,
  inspection_type: 'in_process', result: 'pass', inspector_id: undefined as any, notes: ''
})

const types = [
  { value: 'incoming', label: '来料检验' },
  { value: 'in_process', label: '工序检验' },
  { value: 'final', label: '终检' },
  { value: 'pre_shipping', label: '出厂前' }
]
const typeLabel = (v: string) => types.find(t => t.value === v)?.label || v
const typeColor = (v: string) => ({ incoming: 'info', in_process: 'primary', final: 'success', pre_shipping: 'warning' }[v] || 'info')

const load = async () => {
  loading.value = true
  try {
    const params: any = {}
    if (filters.project_id) params.project_id = filters.project_id
    if (filters.inspection_type) params.inspection_type = filters.inspection_type
    if (filters.result) params.result = filters.result
    rows.value = await api.get('/qc_inspections', { params })
    if (instances.value.length === 0) instances.value = await api.get('/equipment_instances')
    if (workOrders.value.length === 0) workOrders.value = await api.get('/work_orders')
    if (users.value.length === 0) users.value = await api.get('/users')
    stats.value = await api.get('/qc/stats')
  } finally { loading.value = false }
}

const submit = async () => {
  if (!form.equipment_instance_id) { ElMessage.warning('请选实例'); return }
  submitting.value = true
  try {
    await api.post('/qc_inspections', form)
    ElMessage.success('已保存')
    showCreate.value = false
    Object.assign(form, { equipment_instance_id: undefined, work_order_id: undefined, inspection_type: 'in_process', result: 'pass', inspector_id: undefined, notes: '' })
    await load()
  } catch (e: any) { ElMessage.error('失败') }
  finally { submitting.value = false }
}

onMounted(load)
</script>
