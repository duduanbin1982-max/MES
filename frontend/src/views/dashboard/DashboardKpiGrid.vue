<template>
  <section class="kpi-grid">
    <article class="kpi-card kpi-card--blue">
      <div class="kpi-icon">
        <el-icon><Box /></el-icon>
      </div>
      <div class="kpi-body">
        <span class="kpi-label">装备实例总数</span>
        <strong>{{ numberText(stats.instances?.total) }}</strong>
        <small>{{ numberText(stats.equipment_types) }} 类 / {{ numberText(stats.equipment_models) }} 型号</small>
      </div>
    </article>
    <article class="kpi-card kpi-card--slate">
      <div class="kpi-icon">
        <el-icon><DocumentChecked /></el-icon>
      </div>
      <div class="kpi-body">
        <span class="kpi-label">工单执行</span>
        <strong>{{ numberText(stats.work_orders?.total) }}</strong>
        <small>{{ numberText(inProgress) }} 进行中 / {{ numberText(completed) }} 已完成</small>
      </div>
    </article>
    <article class="kpi-card kpi-card--orange">
      <div class="kpi-icon">
        <el-icon><WarningFilled /></el-icon>
      </div>
      <div class="kpi-body">
        <span class="kpi-label">风险待办</span>
        <strong>{{ numberText(riskTotal) }}</strong>
        <small class="kpi-sub">{{ numberText(executionDelays) }} 执行中超期 · {{ numberText(planOverdue) }} 未开工过期</small>
        <small class="kpi-sub">{{ numberText(stats.open_eco) }} ECO · {{ numberText(stats.open_field_service) }} 服务</small>
      </div>
    </article>
    <article class="kpi-card kpi-card--green">
      <div class="kpi-icon">
        <el-icon><Cpu /></el-icon>
      </div>
      <div class="kpi-body">
        <span class="kpi-label">设备利用率</span>
        <strong>{{ pctText(fleetUtilization) }}</strong>
        <small>{{ numberText(live.equipment_busy) }} 忙 / {{ numberText(live.equipment_idle) }} 闲 / {{ numberText(live.equipment_total) }} 总</small>
      </div>
    </article>
  </section>
</template>

<script setup lang="ts">
import { Box, Cpu, DocumentChecked, WarningFilled } from '@element-plus/icons-vue'
import { numberText, pctText } from './dashboardFormat'

defineProps<{
  stats: any
  live: any
  inProgress: number
  completed: number
  riskTotal: number
  delaysTotal: number
  executionDelays?: number
  planOverdue?: number
  fleetUtilization: number
}>()
</script>

<style scoped>
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 16px;
}

.kpi-card {
  display: flex;
  gap: 14px;
  min-height: 118px;
  padding: 18px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 16px;
  background:
    linear-gradient(180deg, var(--color-surface-raised), var(--el-bg-color-overlay));
  box-shadow: var(--shadow-sm);
  transition: border-color 200ms ease, box-shadow 200ms ease;
}

.kpi-card:hover {
  border-color: var(--el-color-primary-light-8);
  box-shadow: var(--shadow-md);
}

.kpi-icon {
  display: grid;
  place-items: center;
  flex: 0 0 42px;
  width: 42px;
  height: 42px;
  border-radius: 14px;
  color: var(--el-color-primary);
  font-size: 20px;
}

.kpi-card--blue .kpi-icon { color: var(--chart-blue); background: rgba(79, 127, 168, 0.12); }
.kpi-card--slate .kpi-icon { color: var(--color-secondary); background: rgba(100, 116, 139, 0.12); }
.kpi-card--orange .kpi-icon { color: var(--color-cta); background: rgba(197, 138, 58, 0.14); }
.kpi-card--green .kpi-icon { color: var(--color-success); background: rgba(67, 133, 107, 0.13); }

.kpi-body {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.kpi-label {
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 700;
}

.kpi-body strong {
  color: var(--color-text);
  font-family: "Fira Code", "Consolas", monospace;
  font-size: 28px;
  line-height: 1;
  letter-spacing: -0.04em;
}

.kpi-body small {
  color: var(--color-text-secondary);
  line-height: 1.5;
}

@media (max-width: 1200px) {
  .kpi-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .kpi-grid {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .kpi-card {
    transition: none;
  }
}
.kpi-sub {
  display: block;
  line-height: 1.5;
}
</style>
