<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title">📑 工单管理</div>
      <el-button @click="load">刷新</el-button>
    </div>

    <el-card style="margin-bottom: 16px">
      <el-form :inline="true" :model="filters">
        <el-form-item label="实例">
          <el-select v-model="filters.equipment_instance_id" clearable placeholder="全部" style="width: 220px">
            <el-option v-for="i in instances" :key="i.id" :label="i.instance_code + ' | ' + (i.instance_name || '')" :value="i.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="filters.status" clearable placeholder="全部" style="width: 140px">
            <el-option v-for="s in statuses" :key="s.value" :label="s.label" :value="s.value" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="load">查询</el-button>
          <el-button @click="resetFilters">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card>
      <el-table :data="rows" stripe v-loading="loading" size="small">
        <el-table-column prop="wo_code" label="工单号" width="160" />
        <el-table-column prop="instance_code" label="实例" width="140" />
        <el-table-column prop="subsystem_name" label="子系统" width="100" />
        <el-table-column prop="title" label="标题" min-width="200" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="woStatusTagType(row.status)" size="small">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="priority" label="优先级" width="80" align="center" />
        <el-table-column label="实际工时" width="100" align="right">
          <template #default="{ row }">{{ row.actual_hours || '-' }}</template>
        </el-table-column>
        <el-table-column label="开始" width="110">
          <template #default="{ row }">{{ (row.actual_start || '').slice(0, 10) }}</template>
        </el-table-column>
        <el-table-column label="结束" width="110">
          <template #default="{ row }">{{ (row.actual_end || '').slice(0, 10) }}</template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { Api } from '../api'

const filters = reactive({ equipment_instance_id: undefined as any, status: '' })
const instances = ref<any[]>([])
const rows = ref<any[]>([])
const loading = ref(false)

const statuses = [
  { value: 'pending', label: '待开始' },
  { value: 'in_progress', label: '进行中' },
  { value: 'paused', label: '已暂停' },
  { value: 'completed', label: '已完成' },
  { value: 'issue', label: '异常' },
  { value: 'rework', label: '返工' }
]
const woStatusTagType = (s: string) => ({ pending: 'info', in_progress: 'primary', paused: 'warning', completed: 'success', issue: 'danger', rework: 'danger' }[s] || 'info')

const resetFilters = () => { filters.equipment_instance_id = undefined; filters.status = ''; load() }

const load = async () => {
  loading.value = true
  try {
    const params: any = {}
    if (filters.equipment_instance_id) params.equipment_instance_id = filters.equipment_instance_id
    if (filters.status) params.status = filters.status
    rows.value = await Api.workOrders(params)
    if (instances.value.length === 0) instances.value = await Api.instances()
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>
