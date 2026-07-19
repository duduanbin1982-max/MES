<template>
  <section class="dashboard-hero">
    <div class="hero-copy">
      <div class="eyebrow">
        <span class="eyebrow-dot"></span>
        TBM-MES Command Center
      </div>
      <h1>首页驾驶舱</h1>
      <p>聚合项目交付、产能利用、延误风险、关键物料与现场状态，帮助生产主管第一眼看到“卡在哪”。</p>
    </div>
    <div class="hero-actions">
      <div class="refresh-meta">
        <span>最近刷新</span>
        <strong>{{ updatedAt || '尚未刷新' }}</strong>
      </div>
      <el-button type="primary" :icon="Refresh" :loading="loading" @click="$emit('refresh')">刷新数据</el-button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { Refresh } from '@element-plus/icons-vue'

defineProps<{
  updatedAt?: string
  loading?: boolean
}>()

defineEmits<{
  refresh: []
}>()
</script>

<style scoped>
.dashboard-hero {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  align-items: stretch;
  margin-bottom: 18px;
  padding: 22px 24px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 18px;
  background:
    linear-gradient(120deg, var(--el-bg-color-overlay), var(--color-surface-muted)),
    radial-gradient(circle at right, rgba(197, 138, 58, 0.10), transparent 30%);
  color: var(--el-text-color-primary);
  box-shadow: var(--shadow-md);
  position: relative;
  overflow: hidden;
}

.dashboard-hero::before {
  position: absolute;
  inset: 0 auto 0 0;
  width: 4px;
  background: linear-gradient(180deg, var(--el-color-primary), var(--color-cta));
  content: "";
}

.hero-copy {
  max-width: 760px;
  position: relative;
}

.eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  color: var(--el-color-primary);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.eyebrow-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--color-cta);
  box-shadow: 0 0 0 6px rgba(197, 138, 58, 0.12);
}

.dashboard-hero h1 {
  margin: 0;
  font-size: clamp(26px, 2.5vw, 36px);
  line-height: 1.1;
  font-weight: 780;
  letter-spacing: -0.035em;
}

.dashboard-hero p {
  max-width: 760px;
  margin: 12px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 15px;
  line-height: 1.7;
}

.hero-actions {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: flex-end;
  min-width: 180px;
  position: relative;
}

.refresh-meta {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  text-align: right;
  background: var(--color-surface-raised);
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.refresh-meta strong {
  color: var(--el-text-color-primary);
  font-size: 13px;
}

@media (max-width: 768px) {
  .dashboard-hero {
    flex-direction: column;
  }

  .hero-actions,
  .refresh-meta {
    align-items: flex-start;
    text-align: left;
  }
}
</style>
