<template>
  <div class="diag-toolbar">
    <div>
      <div class="diag-title">运维诊断中心</div>
      <div class="diag-subtitle">覆盖健康检查、数据库性能、项目主数据、飞书与 ANDON 通知链路。</div>
    </div>
    <div class="diag-actions">
      <el-button @click="$emit('refresh')" :loading="loading">刷新诊断</el-button>
      <el-button type="primary" @click="$emit('probe-feishu')" :loading="actionLoading === 'probe'">探测飞书</el-button>
      <el-button @click="$emit('scan-andon')" :loading="actionLoading === 'andon'">扫描 ANDON</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  loading: boolean
  actionLoading: string
}>()

defineEmits<{
  refresh: []
  'probe-feishu': []
  'scan-andon': []
}>()
</script>

<style scoped>
.diag-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.diag-title {
  color: var(--el-text-color-primary);
  font-size: 16px;
  font-weight: 760;
}

.diag-subtitle {
  margin-top: 4px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.diag-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

@media (max-width: 768px) {
  .diag-toolbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .diag-actions {
    justify-content: flex-start;
  }
}
</style>
