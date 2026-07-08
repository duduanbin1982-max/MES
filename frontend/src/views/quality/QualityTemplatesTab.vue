<template>
  <el-card>
    <div class="actions"><el-button type="primary" @click="$emit('create')">+ 新建模板</el-button></div>
    <el-table :data="rows" stripe v-loading="loading" size="small">
      <el-table-column prop="template_name" label="模板名称" width="180" />
      <el-table-column prop="equipment_type" label="设备类型" width="140" />
      <el-table-column prop="category" label="分类" width="120" />
      <el-table-column prop="created_at" label="创建时间" width="170" />
      <el-table-column label="操作" width="100" align="center">
        <template #default="{ row }"><el-button size="small" type="primary" link @click="$emit('view-items', row)">查看项目</el-button></template>
      </el-table-column>
    </el-table>
  </el-card>
</template>

<script setup lang="ts">
defineProps<{
  rows: any[]
  loading: boolean
}>()

defineEmits<{
  (event: 'create'): void
  (event: 'view-items', row: any): void
}>()
</script>

<style scoped>
.actions{display:flex;justify-content:flex-end;margin-bottom:12px}
</style>
