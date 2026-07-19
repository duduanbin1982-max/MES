<template>
  <el-row :gutter="16" class="summary-row">
    <el-col :span="6">
      <el-card class="kpi-card kpi-green">
        <div class="stat-card">
          <div class="stat-label">可用人员</div>
          <div class="stat-value">{{ overview.workers?.available ?? 0 }} / {{ overview.workers?.total ?? 0 }}</div>
          <div class="stat-sub">空闲/在线可分配</div>
        </div>
      </el-card>
    </el-col>
    <el-col :span="6">
      <el-card class="kpi-card kpi-orange">
        <div class="stat-card">
          <div class="stat-label">忙碌人员</div>
          <div class="stat-value">{{ overview.workers?.busy ?? 0 }}</div>
          <div class="stat-sub">正在作业</div>
        </div>
      </el-card>
    </el-col>
    <el-col :span="6">
      <el-card class="kpi-card kpi-blue">
        <div class="stat-card">
          <div class="stat-label">工位可用</div>
          <div class="stat-value">{{ overview.workstations?.available ?? 0 }} / {{ overview.workstations?.total ?? 0 }}</div>
          <div class="stat-sub">可用 / 总数</div>
        </div>
      </el-card>
    </el-col>
    <el-col :span="6">
      <el-card class="kpi-card kpi-purple">
        <div class="stat-card">
          <div class="stat-label">工位占用</div>
          <div class="stat-value">{{ overview.workstations?.occupied ?? 0 }}</div>
          <div class="stat-sub">已分配人员的工位</div>
        </div>
      </el-card>
    </el-col>
  </el-row>

  <el-row :gutter="16" class="summary-row">
    <el-col v-for="type in coreTypes" :key="type.value" :span="6">
      <el-card shadow="hover" class="type-card">
        <div class="type-title">{{ type.label }}</div>
        <div class="type-value">{{ typeCount(type.value)?.total || 0 }}</div>
        <div class="type-sub">可用 {{ typeCount(type.value)?.available || 0 }}</div>
      </el-card>
    </el-col>
  </el-row>
</template>

<script setup lang="ts">
const props = defineProps<{
  overview: any
  coreTypes: any[]
}>()

function typeCount(type: string) {
  return (props.overview.workstations?.by_type || []).find((row: any) => row.station_type === type) || { total: 0, available: 0 }
}
</script>

<style scoped>
.summary-row {
  margin-bottom: 16px;
}

.stat-card {
  text-align: center;
  padding: 8px 0;
}

.stat-label,
.type-title {
  font-size: 13px;
  color: var(--el-color-info);
  margin-bottom: 6px;
}

.stat-value,
.type-value {
  font-size: 28px;
  font-weight: bold;
  line-height: 1.3;
}

.stat-sub,
.type-sub {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
  margin-top: 4px;
}

.kpi-card,
.type-card {
  border-top: 3px solid;
}

.kpi-green { border-top-color: var(--el-color-success); }
.kpi-orange { border-top-color: var(--el-color-warning); }
.kpi-blue { border-top-color: var(--el-color-primary); }
.kpi-purple { border-top-color: var(--color-purple); }
.type-card { border-top-color: var(--el-color-primary); text-align: center; }
</style>
