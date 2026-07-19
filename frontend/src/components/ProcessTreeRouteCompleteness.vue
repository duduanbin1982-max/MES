<template>
  <el-card class="overview-card route-card">
    <template #header>
      <div class="route-card-header">
        <div>
          <div class="section-title">部件工艺路线完整性</div>
          <div class="section-subtitle">检查每个 1 级部件是否具备工序、标准工时、工位与技能要求。</div>
        </div>
        <div class="route-actions">
          <el-button size="small" :loading="routeFixing" @click="$emit('generate-missing-routes')">生成缺失工序</el-button>
          <el-button size="small" :loading="autoBinding" @click="$emit('auto-bind-routes')">自动绑定工位/技能</el-button>
          <el-button size="small" :icon="Refresh" @click="$emit('load-component-routes')">刷新</el-button>
        </div>
      </div>
    </template>

    <div class="route-summary-grid">
      <div class="route-score">
        <el-progress type="dashboard" :percentage="routeCompletenessPct" :width="108" :stroke-width="8" color="var(--color-success)" />
        <div>
          <div class="route-score-title">路线完整率</div>
          <div class="route-score-subtitle">{{ componentRouteSummary.complete_count || 0 }} / {{ componentRouteSummary.component_count || 0 }} 个部件完整 · 标准人时 {{ componentRouteSummary.total_standard_man_hours || 0 }}h</div>
        </div>
      </div>
      <button class="metric-chip" :class="{ active: routeGapFilter === 'all' }" @click="setFilter('all')">
        <span>部件数</span><strong>{{ componentRouteSummary.component_count || 0 }}</strong>
      </button>
      <button class="metric-chip" :class="{ active: routeGapFilter === 'missing_route' }" @click="setFilter('missing_route')">
        <span>缺工序</span><strong>{{ componentRouteSummary.missing_route_count || 0 }}</strong>
      </button>
      <button class="metric-chip" :class="{ active: routeGapFilter === 'missing_hours' }" @click="setFilter('missing_hours')">
        <span>缺工时</span><strong>{{ componentRouteSummary.missing_hours_count || 0 }}</strong>
      </button>
      <button class="metric-chip" :class="{ active: routeGapFilter === 'missing_workstation' }" @click="setFilter('missing_workstation')">
        <span>缺工位</span><strong>{{ componentRouteSummary.missing_workstation_count || 0 }}</strong>
      </button>
      <button class="metric-chip" :class="{ active: routeGapFilter === 'complete' }" @click="setFilter('complete')">
        <span>完整部件</span><strong>{{ componentRouteSummary.complete_count || 0 }}</strong>
      </button>
    </div>

    <el-alert
      v-if="hasRouteGaps"
      class="route-alert"
      type="warning"
      :closable="false"
      show-icon
      title="存在工艺路线缺口：建议先生成缺失工序，再自动绑定工位/技能，最后逐项补齐标准工时。"
    />

    <el-table :data="filteredComponentRoutes" size="small" max-height="300" class="route-table" row-key="component.id">
      <el-table-column label="部件" min-width="190">
        <template #default="{ row }">
          <strong>{{ row.component.name }}</strong>
          <div class="muted-line">{{ row.component.part_number || row.component.material_code || '-' }}</div>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="104">
        <template #default="{ row }">
          <el-tag :type="row.ok ? 'success' : 'warning'" size="small" effect="plain">{{ row.ok ? '完整' : '待完善' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="operation_count" label="工序" width="72" />
      <el-table-column prop="estimated_hours" label="工时" width="80" />
      <el-table-column prop="standard_man_hours" label="人时" width="80" />
      <el-table-column prop="workstation_count" label="工位" width="72" />
      <el-table-column label="缺口" min-width="210">
        <template #default="{ row }">
          <div v-if="row.missing.length" class="gap-tags">
            <el-tag v-for="m in row.missing" :key="m" size="small" type="warning" effect="plain">{{ m }}</el-tag>
          </div>
          <span v-else class="ok-text">已配置工序/工时/工位</span>
        </template>
      </el-table-column>
      <el-table-column label="工序路线" min-width="300">
        <template #default="{ row }">
          <span v-if="!row.operations.length" class="muted-line">尚未生成工序</span>
          <div v-else class="operation-tags">
            <button v-for="op in row.operations" :key="op.id" class="operation-chip" @click="$emit('focus-process-node', op.id)">
              {{ op.sequence }}.{{ op.operation_name }} · {{ op.estimated_hours || 0 }}h · {{ op.workstation_name || '未设工位' }}
            </button>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="96" fixed="right">
        <template #default="{ row }">
          <el-button size="small" link type="primary" @click="$emit('focus-component-route', row)">定位</el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>
</template>

<script setup lang="ts">
import { Refresh } from '@element-plus/icons-vue'

defineProps({
  routeCompletenessPct: { type: Number, default: 0 },
  componentRouteSummary: { type: Object, required: true },
  routeGapFilter: { type: String, default: 'all' },
  routeFixing: { type: Boolean, default: false },
  autoBinding: { type: Boolean, default: false },
  hasRouteGaps: { type: Boolean, default: false },
  filteredComponentRoutes: { type: Array, default: () => [] },
})

const emit = defineEmits([
  'update:routeGapFilter',
  'generate-missing-routes',
  'auto-bind-routes',
  'load-component-routes',
  'focus-process-node',
  'focus-component-route',
])

const setFilter = (value: string) => {
  emit('update:routeGapFilter', value)
}
</script>

<style scoped>
.overview-card {
  margin-bottom: var(--space-md);
  border-color: var(--color-border);
  box-shadow: var(--shadow-xs);
}
.route-card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-md);
}
.section-title {
  color: var(--color-text);
  font-size: 16px;
  font-weight: 700;
}
.section-subtitle,
.muted-line {
  color: var(--color-text-secondary);
  font-size: 12px;
}
.route-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: var(--space-sm);
}
.route-summary-grid {
  display: grid;
  grid-template-columns: minmax(320px, 1.5fr) repeat(5, minmax(128px, 1fr));
  gap: var(--space-sm);
  align-items: stretch;
  margin-bottom: var(--space-md);
}
.route-score {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-md);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface-raised);
}
.route-score-title {
  color: var(--color-text);
  font-weight: 700;
}
.route-score-subtitle {
  color: var(--color-text-secondary);
  font-size: 12px;
}
.metric-chip {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface-raised);
  color: var(--color-text-secondary);
  padding: 12px;
  text-align: left;
  cursor: pointer;
  transition: border-color var(--transition-fast), background var(--transition-fast), box-shadow var(--transition-fast);
}
.metric-chip span {
  display: block;
  font-size: 12px;
}
.metric-chip strong {
  display: block;
  margin-top: 4px;
  color: var(--color-text);
  font-size: 20px;
}
.metric-chip:hover,
.metric-chip.active {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
  box-shadow: var(--shadow-xs);
}
.route-alert { margin-bottom: var(--space-md); }
.route-table { width: 100%; }
.gap-tags,
.operation-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.operation-chip {
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-surface-muted);
  color: var(--color-text-secondary);
  padding: 2px 8px;
  font-size: 12px;
  cursor: pointer;
  transition: color var(--transition-fast), border-color var(--transition-fast), background var(--transition-fast);
}
.operation-chip:hover {
  color: var(--color-primary);
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
}
.ok-text { color: var(--color-success); font-size: 12px; }

@media (max-width: 1024px) {
  .route-card-header {
    flex-direction: column;
  }
  .route-summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .route-score { grid-column: 1 / -1; }
}
@media (max-width: 640px) {
  .route-summary-grid { grid-template-columns: 1fr; }
  .route-actions { justify-content: stretch; }
  .route-actions .el-button { flex: 1; }
}
</style>
