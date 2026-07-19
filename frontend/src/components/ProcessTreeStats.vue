<template>
  <div class="stats-grid">
    <div class="stat-card primary">
      <div class="stat-label">总节点</div>
      <div class="stat-value">{{ progress.total_nodes || 0 }}</div>
      <div class="stat-hint">当前装备工艺节点</div>
    </div>
    <div class="stat-card success">
      <div class="stat-label">已完成</div>
      <div class="stat-value">{{ progress.completed_nodes || 0 }}<small>{{ progress.progress_pct || 0 }}%</small></div>
      <el-progress :percentage="progress.progress_pct || 0" :show-text="false" :stroke-width="6" color="var(--color-success)" />
    </div>
    <div class="stat-card">
      <div class="stat-label">进行中 / 可开始</div>
      <div class="split-value"><strong>{{ progress.by_status?.in_progress || 0 }}</strong><span>{{ progress.by_status?.ready || 0 }}</span></div>
      <div class="stat-hint">班组今日执行池</div>
    </div>
    <div class="stat-card danger">
      <div class="stat-label">卡住节点</div>
      <div class="stat-value">{{ progress.by_status?.blocked || 0 }}</div>
      <div class="stat-hint">需协调物料/工位/前置</div>
    </div>
    <div class="stat-card timeline">
      <div class="stat-label">总工期（含交期）</div>
      <div class="stat-value">{{ formatWeeks(cpm.total_weeks) }}<small>周</small></div>
      <div class="stat-hint">{{ cpm.total_days || 0 }} 天 / {{ cpm.total_hours || 0 }}h</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">关键路径 / 浮动</div>
      <div class="split-value"><strong>{{ cpm.critical_path?.length || 0 }}</strong><span>{{ cpm.nodes_with_slack || 0 }}</span></div>
      <div class="stat-hint">关键节点越少越易控</div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  progress: { type: Object, required: true },
  cpm: { type: Object, required: true }
})
const formatWeeks = (w) => (w == null || isNaN(w)) ? '0.0' : Number(w).toFixed(1)
</script>

<style scoped>
.stats-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: var(--space-sm);
  margin-bottom: var(--space-md);
}
.stat-card {
  min-height: 112px;
  padding: 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: var(--shadow-xs);
}
.stat-card.primary { background: linear-gradient(180deg, var(--color-primary-soft), var(--color-surface)); }
.stat-card.success { border-color: rgba(67, 133, 107, 0.28); }
.stat-card.danger { border-color: rgba(185, 106, 106, 0.28); }
.stat-card.timeline { background: linear-gradient(180deg, rgba(197, 138, 58, 0.12), var(--color-surface)); }
.stat-label {
  color: var(--color-text-secondary);
  font-size: 12px;
}
.stat-value {
  margin-top: 6px;
  color: var(--color-text);
  font-size: 28px;
  font-weight: 800;
  line-height: 1.15;
}
.stat-value small {
  margin-left: 4px;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 600;
}
.stat-hint {
  margin-top: 8px;
  color: var(--color-text-secondary);
  font-size: 12px;
}
.split-value {
  display: flex;
  align-items: baseline;
  gap: var(--space-sm);
  margin-top: 6px;
}
.split-value strong {
  color: var(--color-primary);
  font-size: 28px;
}
.split-value span {
  color: var(--color-warning);
  font-size: 22px;
  font-weight: 700;
}
@media (max-width: 1200px) {
  .stats-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 680px) {
  .stats-grid { grid-template-columns: 1fr; }
}
</style>
