<template>
  <DashboardGrid>
    <DashboardPanel
      v-if="oee.workstations && oee.workstations.length"
      title="产能利用 OEE"
      description="最近 14 天工位负荷与瓶颈识别。"
      compact
    >
      <template #actions>
        <el-tag v-if="oee.summary.bottleneck" type="danger" effect="light">
          瓶颈 {{ oee.summary.bottleneck.name }}
        </el-tag>
      </template>
      <div class="oee-summary">
        <strong>{{ pctText(oee.summary.fleet_utilization_pct) }}</strong>
        <span>{{ numberText(oee.summary.fleet_busy_hours) }}h / {{ numberText(oee.summary.fleet_available_hours) }}h</span>
      </div>
      <el-table :data="oee.workstations" size="small" class="dashboard-dense-table">
        <el-table-column prop="name" label="工位" min-width="120" />
        <el-table-column prop="utilization_pct" label="利用率" min-width="150">
          <template #default="{ row }">
            <el-progress
              :percentage="row.utilization_pct"
              :stroke-width="8"
              :color="progressColor(row.level)"
            />
          </template>
        </el-table-column>
        <el-table-column prop="busy_hours" label="忙碌(h)" width="90" />
        <el-table-column prop="item_count" label="任务" width="80" />
      </el-table>
    </DashboardPanel>

    <DashboardPanel title="现场实时状态" description="设备、工单、工序与最新开工动态。" compact>
      <template #actions>
        <el-tag :type="utilizationTone" effect="light">{{ pctText(live.utilization) }}</el-tag>
      </template>
      <div class="live-grid">
        <div class="live-metric">
          <span>设备总数</span>
          <strong>{{ numberText(live.equipment_total) }}</strong>
        </div>
        <div class="live-metric">
          <span>在加工工单</span>
          <strong>{{ numberText(live.wo_in_progress) }}</strong>
        </div>
        <div class="live-metric">
          <span>在加工工序</span>
          <strong>{{ numberText(live.pn_in_progress) }}</strong>
        </div>
      </div>
      <el-table v-if="live.recent_starts?.length" :data="live.recent_starts" stripe size="small" max-height="238" class="dashboard-dense-table">
        <el-table-column prop="wo_code" label="工单" width="150" />
        <el-table-column prop="instance_code" label="实例" width="120" />
        <el-table-column prop="title" label="标题" min-width="180" />
        <el-table-column prop="actual_start" label="开工时间" width="170" />
      </el-table>
      <PageState state="empty" compact :show-action="false" v-else description="暂无开工动态" />
    </DashboardPanel>
  </DashboardGrid>
</template>

<script setup lang="ts">
import DashboardGrid from './DashboardGrid.vue'
import DashboardPanel from './DashboardPanel.vue'
import { numberText, pctText } from './dashboardFormat'

defineProps<{
  oee: any
  live: any
  utilizationTone: string
}>()

const progressColor = (level: string) => ({
  overload: 'var(--color-danger)',
  busy: 'var(--color-cta)',
  normal: 'var(--color-success)',
  idle: 'var(--color-primary)',
}[level] || 'var(--color-primary)')
</script>

<style scoped>
.oee-summary {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 12px;
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--color-surface-muted);
}

.oee-summary strong {
  color: var(--color-primary);
  font-family: "Fira Code", "Consolas", monospace;
  font-size: 30px;
}

.oee-summary span {
  color: var(--color-text-secondary);
}

.live-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}

.live-metric {
  display: grid;
  gap: 4px;
  padding: 13px;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: var(--color-background);
}

.live-metric span {
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 700;
}

.live-metric strong {
  color: var(--color-text);
  font-family: "Fira Code", "Consolas", monospace;
  font-size: 24px;
}

@media (max-width: 768px) {
  .live-grid {
    grid-template-columns: 1fr;
  }
}
</style>
