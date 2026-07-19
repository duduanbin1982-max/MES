<template>
  <el-card class="dashboard-panel" shadow="never">
    <template #header>
      <div class="dashboard-panel__header" :class="{ 'dashboard-panel__header--compact': compact }">
        <slot name="header">
          <div>
            <h2>{{ title }}</h2>
            <p v-if="description">{{ description }}</p>
          </div>
          <slot name="actions" />
        </slot>
      </div>
    </template>
    <slot />
  </el-card>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  title?: string
  description?: string
  compact?: boolean
}>(), {
  title: '',
  description: '',
  compact: false,
})
</script>

<style scoped>
.dashboard-panel {
  border: 1px solid var(--el-border-color-light);
  border-radius: 18px;
  background: var(--el-bg-color-overlay);
  box-shadow: var(--shadow-sm);
}

.dashboard-panel :deep(.el-card__header) {
  padding: 16px 18px;
  border-bottom: 1px solid var(--color-border);
}

.dashboard-panel :deep(.el-card__body) {
  padding: 16px 18px 18px;
}

.dashboard-panel__header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
}

.dashboard-panel__header--compact {
  align-items: flex-start;
}

.dashboard-panel__header h2 {
  margin: 0;
  color: var(--color-text);
  font-size: 16px;
  font-weight: 800;
}

.dashboard-panel__header p {
  margin: 5px 0 0;
  color: var(--color-text-secondary);
  font-size: 12px;
  line-height: 1.5;
}

@media (max-width: 768px) {
  .dashboard-panel__header {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
