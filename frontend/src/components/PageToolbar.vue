<template>
  <header class="page-toolbar" :class="{ 'is-compact': compact, 'is-sticky': sticky }" :aria-label="ariaLabel || title || '页面工具栏'">
    <slot v-if="$slots.default" />
    <div v-else class="page-toolbar__top">
      <div class="page-toolbar__heading">
        <span v-if="$slots.icon" class="page-toolbar__icon" aria-hidden="true">
          <slot name="icon" />
        </span>
        <div class="page-toolbar__copy">
          <h1 v-if="title" class="page-toolbar__title">{{ title }}</h1>
          <p v-if="subtitle" class="page-toolbar__subtitle">{{ subtitle }}</p>
          <slot name="meta" />
        </div>
      </div>

      <div v-if="$slots.actions" class="page-toolbar__actions" aria-label="页面操作">
        <slot name="actions" />
      </div>
    </div>

    <div v-if="$slots.filters" class="page-toolbar__filters" aria-label="筛选条件">
      <slot name="filters" />
    </div>

    <div v-if="$slots.batch" class="page-toolbar__batch" role="status" aria-live="polite">
      <slot name="batch" />
    </div>
  </header>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  title?: string
  subtitle?: string
  ariaLabel?: string
  compact?: boolean
  sticky?: boolean
}>(), {
  title: '',
  subtitle: '',
  ariaLabel: '',
  compact: false,
  sticky: false,
})
</script>

<style scoped>
.page-toolbar.page-header {
  /* 兼容包裹既有 page-header 内容：保持左右布局 */
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-md);
  margin-bottom: 0;
  padding-bottom: var(--space-sm);
}

.page-toolbar {
  display: grid;
  gap: var(--space-md);
  margin-bottom: var(--space-lg);
  padding: var(--space-md);
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--radius-md);
  background: var(--el-bg-color-overlay);
  box-shadow: var(--shadow-sm);
}

.page-toolbar.is-compact {
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
}

.page-toolbar.is-sticky {
  position: sticky;
  top: 0;
  z-index: 10;
}

.page-toolbar__top,
.page-toolbar__heading,
.page-toolbar__actions,
.page-toolbar__filters,
.page-toolbar__batch {
  display: flex;
  align-items: center;
}

.page-toolbar__top {
  justify-content: space-between;
  gap: var(--space-md);
}

.page-toolbar__heading {
  min-width: 0;
  gap: 10px;
}

.page-toolbar__icon {
  display: inline-grid;
  place-items: center;
  flex: 0 0 34px;
  width: 34px;
  height: 34px;
  border-radius: var(--radius-md);
  color: var(--el-color-primary);
  background: var(--color-surface-muted);
  font-size: 18px;
}

.page-toolbar__copy {
  min-width: 0;
}

.page-toolbar__title {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1.25;
}

.page-toolbar__subtitle {
  margin: 4px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.5;
}

.page-toolbar__actions {
  justify-content: flex-end;
  gap: var(--space-sm);
  flex-wrap: wrap;
}

.page-toolbar__filters {
  align-items: flex-start;
  gap: var(--space-sm);
  flex-wrap: wrap;
  padding-top: var(--space-md);
  border-top: 1px solid var(--el-border-color-lighter);
}

.page-toolbar__batch {
  justify-content: space-between;
  gap: var(--space-sm);
  padding: 8px 10px;
  border-radius: var(--radius-md);
  color: var(--el-text-color-regular);
  background: var(--color-surface-muted);
  font-size: 13px;
}

.page-toolbar__filters :deep(.toolbar-form) {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 10px;
}

.page-toolbar__filters :deep(.toolbar-form .el-form-item) {
  margin-bottom: 0;
  margin-right: 0;
}

@media (max-width: 768px) {
  .page-toolbar__top {
    align-items: stretch;
    flex-direction: column;
  }

  .page-toolbar__actions,
  .page-toolbar__filters {
    justify-content: flex-start;
  }
}
</style>
