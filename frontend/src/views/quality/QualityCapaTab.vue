<template>
  <el-card>
    <div class="toolbar">
      <el-form :inline="true" :model="filters" size="default">
        <el-form-item label="状态">
          <el-select v-model="filters.status" clearable placeholder="全部" class="status-select" @change="$emit('load')">
            <el-option label="进行中" value="open" />
            <el-option label="已完成" value="closed" />
            <el-option label="逾期" value="overdue" />
          </el-select>
        </el-form-item>
        <el-form-item label="负责人">
          <el-select v-model="filters.assignee" clearable placeholder="全部" class="assignee-select" @change="$emit('load')">
            <el-option v-for="user in users" :key="user.id" :label="user.full_name" :value="user.id" />
          </el-select>
        </el-form-item>
        <el-form-item><el-button type="primary" @click="$emit('load')">查询</el-button></el-form-item>
      </el-form>
    </div>
    <el-table :data="rows" stripe v-loading="loading" size="small" :row-class-name="rowClass">
      <el-table-column prop="action_type" label="行动类型" width="120" />
      <el-table-column prop="action_desc" label="行动描述" min-width="200" show-overflow-tooltip />
      <el-table-column prop="assignee_name" label="负责人" width="100" />
      <el-table-column prop="due_date" label="截止日期" width="120" />
      <el-table-column label="状态" width="100">
        <template #default="{ row }"><el-tag :type="row.status === 'closed' ? 'success' : row.overdue ? 'danger' : 'warning'" size="small">{{ row.status === 'closed' ? '已完成' : row.overdue ? '已逾期' : '进行中' }}</el-tag></template>
      </el-table-column>
      <el-table-column prop="ncr_code" label="关联NCR" width="130" />
      <el-table-column label="操作" width="100" align="center" fixed="right">
        <template #default="{ row }"><el-button v-if="row.status !== 'closed'" size="small" type="success" @click="$emit('complete', row)">完成</el-button></template>
      </el-table-column>
    </el-table>
  </el-card>
</template>

<script setup lang="ts">
defineProps<{
  filters: any
  users: any[]
  rows: any[]
  loading: boolean
  rowClass: (scope: any) => string
}>()

defineEmits<{
  (event: 'load'): void
  (event: 'complete', row: any): void
}>()
</script>

<style scoped>
.toolbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.status-select{width:120px}
.assignee-select{width:150px}
:deep(.capa-overdue-row){background-color:#fef0f0!important}
</style>
