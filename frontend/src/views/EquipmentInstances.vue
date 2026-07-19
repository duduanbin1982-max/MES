<template>
  <div class="page">
    <div class="page-header">
      <div>
        <div class="page-title"><el-icon><Box /></el-icon> 项目装备台账</div>
        <div class="page-subtitle">项目号、合同号、序列号统一编码；从第一天就把 TBM 交付主线立住。</div>
      </div>
      <div class="header-actions">
        <el-button @click="router.push('/project-wizard')">
          <el-icon><Guide /></el-icon>项目启动向导
        </el-button>
        <el-button type="primary" @click="openCreate">
          <el-icon><Plus /></el-icon>创建项目装备
        </el-button>
      </div>
    </div>

    <el-card style="margin-bottom: 16px">
      <el-form :inline="true" :model="filters" size="default">
        <el-form-item label="生命周期">
          <el-select v-model="filters.status" clearable placeholder="全部" style="width: 150px">
            <el-option v-for="s in lifecycleOptions" :key="s.value" :label="s.label" :value="s.value" />
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

    <el-card>
      <el-table :data="rows" stripe v-loading="loading" @row-click="goDetail" style="cursor: pointer" max-height="500">
        <el-table-column prop="instance_code" label="项目装备编码" width="170" />
        <el-table-column prop="project_no" label="项目号" width="130">
          <template #default="{ row }">{{ row.project_no || '-' }}</template>
        </el-table-column>
        <el-table-column prop="instance_name" label="名称" min-width="190" />
        <el-table-column prop="customer_name" label="客户" width="140" />
        <el-table-column prop="contract_no" label="合同号" width="150">
          <template #default="{ row }">{{ row.contract_no || '-' }}</template>
        </el-table-column>
        <el-table-column prop="serial_no" label="序列号" width="150">
          <template #default="{ row }">{{ row.serial_no || '-' }}</template>
        </el-table-column>
        <el-table-column label="生命周期" width="110">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.lifecycle_stage || row.status)" size="small">{{ statusLabel(row.lifecycle_stage || row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="冻结" width="90">
          <template #default="{ row }">
            <el-tag v-if="row.archive_status === 'archived'" type="danger" size="small">归档</el-tag>
            <el-tag v-else-if="row.frozen_at" type="warning" size="small">冻结</el-tag>
            <el-tag v-else type="success" size="small">可编辑</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="工期" width="190">
          <template #default="{ row }">{{ row.planned_start || '-' }} → {{ row.planned_end || '-' }}</template>
        </el-table-column>
      </el-table>
    </el-card>

    <EquipmentInstanceCreateDialog v-model="showCreate" :types="types" :rows="rows" @created="handleCreated" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Api } from '../api'
import EquipmentInstanceCreateDialog from './equipment/EquipmentInstanceCreateDialog.vue'
import { EQUIPMENT_LIFECYCLE_META, EQUIPMENT_LIFECYCLE_OPTIONS, statusLabel as catalogStatusLabel, statusTag as catalogStatusTag } from '../domain/statusCatalog'

const router = useRouter()
const loading = ref(false)
const rows = ref<any[]>([])
const types = ref<any[]>([])
const lifecycleOptions = ref<any[]>([...EQUIPMENT_LIFECYCLE_OPTIONS])
const filters = reactive({ status: '', equipment_type_id: undefined as any, customer: '' })

const statusLabel = (s: string) => lifecycleOptions.value.find(x => x.value === s)?.label || catalogStatusLabel(EQUIPMENT_LIFECYCLE_META, s)
const statusTagType = (s: string) => catalogStatusTag(EQUIPMENT_LIFECYCLE_META, s)

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

const loadTypes = async () => { try { types.value = await Api.equipmentTypes() } catch (e: any) { ElMessage.error('加载产品类型失败: ' + (e?.message || e)) } }
const loadLifecycle = async () => {
  try { lifecycleOptions.value = await Api.instanceLifecycleOptions() } catch { lifecycleOptions.value = [...EQUIPMENT_LIFECYCLE_OPTIONS] }
}
const showCreate = ref(false)
const openCreate = () => { showCreate.value = true }
const handleCreated = async (id: number) => {
  await load()
  router.push(`/instances/${id}`)
}

onMounted(async () => { await Promise.all([loadTypes(), loadLifecycle()]); await load() })
</script>

<style scoped>
.page-subtitle { color: var(--el-text-color-secondary); margin-top: 6px; font-size: 13px; }
.header-actions { display: flex; gap: 8px; align-items: center; }
</style>
