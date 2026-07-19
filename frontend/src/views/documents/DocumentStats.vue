<template>
  <div class="stat-row">
    <el-card shadow="never" class="stat-card">
      <div class="stat-label">总文档数</div>
      <div class="stat-value">{{ stats.total_bytes !== undefined ? totalCount : '—' }}</div>
    </el-card>
    <el-card shadow="never" class="stat-card">
      <div class="stat-label">已签发</div>
      <div class="stat-value text-success">{{ countByStatus('issued') }}</div>
    </el-card>
    <el-card shadow="never" class="stat-card">
      <div class="stat-label">草稿</div>
      <div class="stat-value text-info">{{ countByStatus('draft') }}</div>
    </el-card>
    <el-card shadow="never" class="stat-card">
      <div class="stat-label">已收回</div>
      <div class="stat-value text-warning">{{ countByStatus('revoked') }}</div>
    </el-card>
    <el-card shadow="never" class="stat-card">
      <div class="stat-label">存储占用</div>
      <div class="stat-value stat-value--small">{{ stats.human_total || '—' }}</div>
    </el-card>
    <el-card shadow="never" class="stat-card stat-card--pending" @click="$emit('pending-click')">
      <div class="stat-label">待签收 <span class="new-flag">NEW</span></div>
      <div class="stat-value text-danger">{{ pendingCount }}</div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  stats: any
  totalCount: number
  pendingCount: number
}>()

defineEmits<{
  'pending-click': []
}>()

const countByStatus = (status: string) => {
  const bucket = props.stats.by_status?.find((item: any) => item.status === status)
  return bucket ? bucket.count : 0
}
</script>

<style scoped>
.stat-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}

.stat-card {
  text-align: center;
  padding: 8px;
}

.stat-card--pending {
  cursor: pointer;
  border-left: 3px solid var(--el-color-danger);
}

.stat-label {
  font-size: 12px;
  color: var(--el-color-info);
  margin-bottom: 4px;
}

.stat-value {
  font-size: 22px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.stat-value--small {
  font-size: 16px;
}

.new-flag,
.text-danger {
  color: var(--el-color-danger);
}

.text-success {
  color: var(--el-color-success);
}

.text-info {
  color: var(--el-color-info);
}

.text-warning {
  color: var(--el-color-warning);
}
</style>
