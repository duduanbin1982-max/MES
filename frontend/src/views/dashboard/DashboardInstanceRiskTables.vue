<template>
  <DashboardGrid bottom>
    <DashboardPanel title="最近项目装备" description="点击项目装备进入项目详情，继续钻取 BOM、齐套、工单、质检与成本。">
      <el-table :data="recentInstances" stripe size="small" class="dashboard-dense-table clickable-table" @row-click="$emit('instance-click', $event)">
        <el-table-column prop="instance_code" label="编号" width="130" />
        <el-table-column prop="instance_name" label="名称" min-width="180" />
        <el-table-column prop="type_name" label="类型" width="110" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="计划周期" min-width="190">
          <template #default="{ row }">{{ row.planned_start || '-' }} → {{ row.planned_end || '-' }}</template>
        </el-table-column>
      </el-table>
    </DashboardPanel>

    <DashboardPanel title="长交期关键件" description="采购风险前置预警，默认关注 ≥12 周。" compact>
      <el-table :data="longLeadtime" stripe size="small" class="dashboard-dense-table">
        <el-table-column prop="material_name" label="物料" min-width="150" />
        <el-table-column prop="supplier" label="供应商" width="100" />
        <el-table-column label="交期" width="120">
          <template #default="{ row }">
            <el-tag :type="row.is_urgent ? 'danger' : 'warning'" size="small">{{ row.lead_time_weeks }}w</el-tag>
            <el-tag v-if="row.is_urgent" type="danger" size="small" effect="dark" style="margin-left: 4px">紧急</el-tag>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!longLeadtime.length" description="暂无长交期关键件" :image-size="72" />
    </DashboardPanel>
  </DashboardGrid>

  <section v-if="delaysSummary.total > 0" class="delay-strip">
    <div class="delay-title">
      <el-icon><Timer /></el-icon>
      <div>
        <strong>延误预警</strong>
        <span>执行中超期 {{ numberText(delaysSummary.started) }} / 未开工过期 {{ numberText(delaysSummary.not_started) }}</span>
      </div>
    </div>
    <el-table :data="delaysTop" size="small" class="dashboard-dense-table delay-table">
      <el-table-column prop="severity" label="等级" width="82">
        <template #default="{ row }">
          <el-tag :type="row.severity === 'critical' ? 'danger' : row.severity === 'high' ? 'warning' : 'info'" size="small">
            {{ row.severity === 'critical' ? '严重' : row.severity === 'high' ? '高' : '警告' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="阶段" width="92">
        <template #default="{ row }">
          <el-tag :type="row.phase === 'started' ? 'danger' : row.phase === 'blocked' ? 'warning' : 'info'" size="small">
            {{ row.phase === 'started' ? '执行中' : row.phase === 'blocked' ? '受阻' : '未开工' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="name" label="延误项" min-width="170" />
      <el-table-column prop="instance_code" label="项目" width="130" />
      <el-table-column prop="days_overdue" label="延期" width="90">
        <template #default="{ row }">
          <span class="overdue-days">{{ row.days_overdue }}d</span>
        </template>
      </el-table-column>
    </el-table>
  </section>
</template>

<script setup lang="ts">
import { Timer } from '@element-plus/icons-vue'
import DashboardGrid from './DashboardGrid.vue'
import DashboardPanel from './DashboardPanel.vue'
import { numberText, statusLabel, statusTagType } from './dashboardFormat'

defineProps<{
  recentInstances: any[]
  longLeadtime: any[]
  delaysSummary: any
  delaysTop: any[]
}>()

defineEmits<{
  'instance-click': [row: any]
}>()
</script>

<style scoped>
.clickable-table :deep(.el-table__row) {
  cursor: pointer;
}

.clickable-table :deep(.el-table__row:hover td) {
  background: var(--el-table-row-hover-bg-color) !important;
}

.delay-strip {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 16px;
  padding: 16px;
  border: 1px solid rgba(215, 154, 69, 0.28);
  border-radius: 18px;
  background: rgba(215, 154, 69, 0.10);
}

.delay-title {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  color: var(--color-warning);
}

.delay-title .el-icon {
  margin-top: 2px;
  font-size: 22px;
}

.delay-title div {
  display: grid;
  gap: 5px;
}

.delay-title strong {
  font-size: 16px;
}

.delay-title span {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.overdue-days {
  color: var(--color-danger);
  font-family: "Fira Code", "Consolas", monospace;
  font-weight: 800;
}

@media (max-width: 768px) {
  .delay-strip {
    grid-template-columns: 1fr;
  }
}
</style>
