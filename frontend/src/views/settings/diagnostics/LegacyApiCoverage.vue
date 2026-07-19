<template>
  <el-row :gutter="14">
    <el-col :xs="24">
      <el-card shadow="never" class="diag-card">
        <template #header>
          <div class="card-header">
            <span>现场服务兼容端点</span>
            <el-tag type="info" effect="light">legacy API coverage</el-tag>
          </div>
        </template>
        <el-row :gutter="10" class="mini-metrics">
          <el-col :xs="24" :sm="8">
            <div>
              <strong>{{ fieldServiceCount }}</strong>
              <span>旧版服务单</span>
            </div>
          </el-col>
          <el-col :xs="24" :sm="8">
            <div>
              <strong>{{ maintenanceCount }}</strong>
              <span>旧版维保计划</span>
            </div>
          </el-col>
          <el-col :xs="24" :sm="8">
            <div>
              <strong>{{ spareAlertCount }}</strong>
              <span>旧版备件预警</span>
            </div>
          </el-col>
        </el-row>
        <el-alert
          title="这些端点由旧 reportService/fieldService.js 兼容层提供；正式业务入口已迁移到“现场服务/维保计划/备件库”页面，这里用于运维确认兼容接口仍可用。"
          type="info"
          :closable="false"
          show-icon
        />
      </el-card>
    </el-col>
  </el-row>
</template>

<script setup lang="ts">
defineProps<{
  fieldServiceCount: number
  maintenanceCount: number
  spareAlertCount: number
}>()
</script>

<style scoped>
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.diag-card {
  margin-bottom: 14px;
}

.mini-metrics {
  margin-bottom: 12px;
}

.mini-metrics div {
  display: grid;
  gap: 3px;
  padding: 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  background: var(--color-surface-muted);
}

.mini-metrics strong {
  color: var(--el-color-primary);
  font-family: "Fira Code", "Cascadia Code", monospace;
  font-size: 20px;
}

.mini-metrics span {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

@media (max-width: 768px) {
  .card-header {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
