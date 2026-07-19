<template>
  <el-row :gutter="14">
    <el-col :xs="24" :lg="12">
      <el-card shadow="never" class="diag-card">
        <template #header><span>系统与数据库</span></template>
        <pre class="diag-json">{{ compactJson({ health, dbStats }) }}</pre>
      </el-card>
    </el-col>
    <el-col :xs="24" :lg="12">
      <el-card shadow="never" class="diag-card">
        <template #header><span>项目主数据 / 设置兼容</span></template>
        <pre class="diag-json">{{ compactJson({ projectStatus, settingsAllCount }) }}</pre>
      </el-card>
    </el-col>
  </el-row>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  health: any
  dbStats: any
  projectStatus: any
  settingsAll: any
}>()

const settingsAllCount = computed(() => props.settingsAll?.items?.length || 0)

function compactJson(value: any) {
  return JSON.stringify(value || {}, null, 2)
}
</script>

<style scoped>
.diag-card {
  margin-bottom: 14px;
}

.diag-json {
  max-height: 280px;
  overflow: auto;
  padding: 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  background: var(--color-surface-muted);
  color: var(--el-text-color-regular);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
}
</style>
