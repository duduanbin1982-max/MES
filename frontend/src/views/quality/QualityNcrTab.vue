<template>
  <el-card>
    <div class="toolbar">
      <el-form :inline="true" :model="filters" size="default">
        <el-form-item label="严重程度">
          <el-select v-model="filters.severity" clearable placeholder="全部" class="filter-select" @change="$emit('load')">
            <el-option label="轻微" value="minor" />
            <el-option label="严重" value="major" />
            <el-option label="致命" value="critical" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="filters.status" clearable placeholder="全部" class="filter-select" @change="$emit('load')">
            <el-option label="待处置" value="open" />
            <el-option label="已处置" value="disposed" />
            <el-option label="已关闭" value="closed" />
          </el-select>
        </el-form-item>
        <el-form-item><el-button type="primary" @click="$emit('load')">查询</el-button></el-form-item>
      </el-form>
      <el-button type="primary" @click="$emit('create')">+ 新建NCR</el-button>
    </div>
    <el-table :data="rows" stripe v-loading="loading" size="small">
      <el-table-column prop="ncr_code" label="NCR编号" width="140" />
      <el-table-column prop="part_name" label="零件名称" width="140" />
      <el-table-column prop="defect_desc" label="缺陷描述" min-width="180" show-overflow-tooltip />
      <el-table-column label="严重程度" width="100">
        <template #default="{ row }"><el-tag :type="severityColor(row.severity)" size="small">{{ severityLabel(row.severity) }}</el-tag></template>
      </el-table-column>
      <el-table-column label="处置" width="100">
        <template #default="{ row }"><el-tag v-if="row.disposition" :type="dispositionColor(row.disposition)" size="small">{{ dispositionLabel(row.disposition) }}</el-tag><span v-else class="muted">-</span></template>
      </el-table-column>
      <el-table-column prop="created_at" label="创建时间" width="170" />
      <el-table-column label="状态" width="90">
        <template #default="{ row }"><el-tag :type="ncrStatusColor(row.status)" size="small">{{ ncrStatusLabel(row.status) }}</el-tag></template>
      </el-table-column>
      <el-table-column label="操作" width="180" align="center" fixed="right">
        <template #default="{ row }">
          <el-button size="small" type="warning" @click="$emit('disposition', row)" :disabled="row.status === 'closed'">处置</el-button>
          <el-button size="small" type="info" @click="$emit('capa', row)">CAPA</el-button>
          <el-button size="small" type="success" @click="$emit('closure', row)">闭环</el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>
</template>

<script setup lang="ts">
defineProps<{
  filters: any
  rows: any[]
  loading: boolean
  severityLabel: (value: string) => string
  severityColor: (value: string) => string
  dispositionLabel: (value: string) => string
  dispositionColor: (value: string) => string
  ncrStatusLabel: (value: string) => string
  ncrStatusColor: (value: string) => string
}>()

defineEmits<{
  (event: 'load'): void
  (event: 'create'): void
  (event: 'disposition', row: any): void
  (event: 'capa', row: any): void
  (event: 'closure', row: any): void
}>()
</script>

<style scoped>
.toolbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.filter-select{width:120px}
.muted{color:#909399}
</style>
