<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title">📦 装备实例列表</div>
      <el-button type="primary" @click="showCreate = true">
        <el-icon><Plus /></el-icon>新建实例
      </el-button>
    </div>

    <!-- 筛选 -->
    <el-card style="margin-bottom: 16px">
      <el-form :inline="true" :model="filters" size="default">
        <el-form-item label="状态">
          <el-select v-model="filters.status" clearable placeholder="全部" style="width: 140px">
            <el-option v-for="s in statuses" :key="s.value" :label="s.label" :value="s.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="filters.equipment_type_id" clearable placeholder="全部" style="width: 160px">
            <el-option v-for="t in types" :key="t.id" :label="t.name_zh" :value="t.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="客户">
          <el-input v-model="filters.customer" clearable placeholder="搜索客户名" style="width: 200px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="load">查询</el-button>
          <el-button @click="resetFilters">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 列表 -->
    <el-card>
      <el-table :data="rows" stripe v-loading="loading" @row-click="goDetail" style="cursor: pointer">
        <el-table-column prop="instance_code" label="编号" width="150" />
        <el-table-column prop="instance_name" label="名称" min-width="200" />
        <el-table-column prop="type_name" label="类型" width="120" />
        <el-table-column prop="model_name" label="型号" width="150" />
        <el-table-column prop="customer_name" label="客户" width="140" />
        <el-table-column prop="contract_amount" label="金额(万)" width="100" align="right">
          <template #default="{ row }">{{ row.contract_amount || '-' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="生命周期" width="100">
          <template #default="{ row }">
            <span class="milestone-tag milestone-pending">{{ row.lifecycle_stage || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="工期" width="180">
          <template #default="{ row }">{{ row.planned_start || '-' }} → {{ row.planned_end || '-' }}</template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 创建对话框 -->
    <el-dialog v-model="showCreate" title="新建装备实例" width="500px">
      <el-form :model="newInst" label-width="100px">
        <el-form-item label="实例编号" required>
          <el-input v-model="newInst.instance_code" placeholder="如 TBM-2026-003" />
        </el-form-item>
        <el-form-item label="名称">
          <el-input v-model="newInst.instance_name" placeholder="项目名 + 机型描述" />
        </el-form-item>
        <el-form-item label="类型" required>
          <el-select v-model="newInst.equipment_type_id" placeholder="选产品类别" @change="loadModels" style="width: 100%">
            <el-option v-for="t in types" :key="t.id" :label="t.name_zh" :value="t.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="型号" required>
          <el-select v-model="newInst.equipment_model_id" placeholder="先选类型" style="width: 100%">
            <el-option v-for="m in models" :key="m.id" :label="m.model_name" :value="m.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="客户" required>
          <el-input v-model="newInst.customer_name" />
        </el-form-item>
        <el-form-item label="合同金额(万)">
          <el-input-number v-model="newInst.contract_amount" :min="0" />
        </el-form-item>
        <el-form-item label="工期">
          <el-date-picker v-model="dateRange" type="daterange" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreate = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="createInstance">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Api } from '../api'

const router = useRouter()
const loading = ref(false)
const rows = ref<any[]>([])
const types = ref<any[]>([])
const models = ref<any[]>([])
const filters = reactive({ status: '', equipment_type_id: undefined as any, customer: '' })

const statuses = [
  { value: 'design', label: '设计' },
  { value: 'procurement', label: '采购' },
  { value: 'manufacturing', label: '生产' },
  { value: 'assembly', label: '装配' },
  { value: 'commissioning', label: '调试' },
  { value: 'shipping', label: '发运' },
  { value: 'accepted', label: '已验收' }
]
const statusLabel = (s: string) => statuses.find(x => x.value === s)?.label || s
const statusTagType = (s: string) => ({ design: 'info', procurement: 'warning', manufacturing: 'primary', assembly: 'primary', commissioning: 'success', shipping: 'warning', accepted: 'success' }[s] || 'info')

const resetFilters = () => { filters.status = ''; filters.equipment_type_id = undefined; filters.customer = ''; load() }

const goDetail = (row: any) => router.push(`/instances/${row.id}`)

const load = async () => {
  loading.value = true
  try {
    const params: any = {}
    if (filters.status) params.status = filters.status
    if (filters.equipment_type_id) params.equipment_type_id = filters.equipment_type_id
    if (filters.customer) params.customer = filters.customer
    rows.value = await Api.instances(params)
  } finally {
    loading.value = false
  }
}

const loadTypes = async () => { types.value = await Api.equipmentTypes() }
const loadModels = async () => {
  if (!newInst.equipment_type_id) { models.value = []; return }
  models.value = await Api.equipmentModels(newInst.equipment_type_id)
}

// 创建
const showCreate = ref(false)
const creating = ref(false)
const newInst = reactive({
  instance_code: '', instance_name: '', equipment_type_id: undefined as any,
  equipment_model_id: undefined as any, customer_name: '', contract_amount: undefined as any
})
const dateRange = ref<[string, string] | null>(null)

const createInstance = async () => {
  if (!newInst.instance_code || !newInst.equipment_model_id || !newInst.customer_name) {
    ElMessage.warning('请填写必填项'); return
  }
  creating.value = true
  try {
    const payload: any = { ...newInst }
    if (dateRange.value) { payload.planned_start = dateRange.value[0]; payload.planned_end = dateRange.value[1] }
    delete payload.equipment_type_id
    const r: any = await import('../api').then(m => m.default.post('/equipment_instances', payload))
    ElMessage.success('创建成功')
    showCreate.value = false
    load()
  } finally {
    creating.value = false
  }
}

onMounted(async () => { await loadTypes(); await load() })
</script>
