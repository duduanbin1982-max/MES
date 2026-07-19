<template>
  <el-row :gutter="14" class="diag-kpis" v-loading="loading">
    <el-col :xs="24" :sm="12" :lg="6">
      <div class="diag-kpi">
        <span>系统健康</span>
        <strong :class="{ ok: health?.status === 'ok' }">{{ health?.status || 'unknown' }}</strong>
        <small>{{ health?.tables || 0 }} 张表 / {{ health?.instances || 0 }} 台实例</small>
      </div>
    </el-col>
    <el-col :xs="24" :sm="12" :lg="6">
      <div class="diag-kpi">
        <span>接口性能</span>
        <strong>{{ dbStats?.totalQueries || dbStats?.count || 0 }}</strong>
        <small>慢查询 / QPS 由后端 profileStats 提供</small>
      </div>
    </el-col>
    <el-col :xs="24" :sm="12" :lg="6">
      <div class="diag-kpi">
        <span>项目主数据</span>
        <strong>{{ projectStatus?.ok === false ? '异常' : '就绪' }}</strong>
        <small>{{ projectStatusText }}</small>
      </div>
    </el-col>
    <el-col :xs="24" :sm="12" :lg="6">
      <div class="diag-kpi">
        <span>通知链路</span>
        <strong>{{ andonDiag?.open_alerts || 0 }}</strong>
        <small>ANDON 未关闭告警</small>
      </div>
    </el-col>
  </el-row>
</template>

<script setup lang="ts">
defineProps<{
  loading: boolean
  health: any
  dbStats: any
  projectStatus: any
  projectStatusText: string
  andonDiag: any
}>()
</script>

<style scoped>
.diag-kpis {
  margin-bottom: 2px;
}

.diag-kpi {
  display: grid;
  gap: 5px;
  min-height: 104px;
  padding: 16px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 14px;
  background: linear-gradient(180deg, var(--color-surface-raised), var(--el-bg-color-overlay));
  box-shadow: var(--shadow-sm);
}

.diag-kpi span,
.diag-kpi small {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.diag-kpi strong {
  color: var(--el-color-primary);
  font-family: "Fira Code", "Cascadia Code", monospace;
  font-size: 24px;
  line-height: 1.1;
}

.diag-kpi strong.ok {
  color: var(--el-color-success);
}
</style>
