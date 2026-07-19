<template>
  <slot v-if="resolvedState === 'ready'" />

  <section
    v-else
    class="page-state"
    :class="[`page-state--${resolvedState}`, { 'is-compact': compact }]"
    :role="resolvedState === 'error' ? 'alert' : 'status'"
    aria-live="polite"
  >
    <template v-if="resolvedState === 'loading'">
      <div class="page-state__icon is-loading">
        <el-icon><Loading /></el-icon>
      </div>
      <div class="page-state__content">
        <h3>{{ title || '正在加载数据' }}</h3>
        <p>{{ description || '正在从 MES 服务获取最新数据，请稍候。' }}</p>
        <el-skeleton :rows="rows" animated class="page-state__skeleton" />
      </div>
    </template>

    <template v-else>
      <div class="page-state__icon">
        <el-icon><component :is="stateIcon" /></el-icon>
      </div>
      <div class="page-state__content">
        <h3>{{ resolvedTitle }}</h3>
        <p>{{ resolvedDescription }}</p>
        <div v-if="showAction || $slots.actions" class="page-state__actions">
          <el-button v-if="showAction" type="primary" :icon="Refresh" @click="emit('retry')">
            {{ actionText || (resolvedState === 'error' ? '重试' : '刷新') }}
          </el-button>
          <slot name="actions" />
        </div>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Box, CircleCloseFilled, Loading, Refresh } from '@element-plus/icons-vue'

const props = withDefaults(defineProps<{
  state?: 'ready' | 'loading' | 'empty' | 'error'
  loading?: boolean
  error?: string | null
  empty?: boolean
  title?: string
  description?: string
  actionText?: string
  rows?: number
  compact?: boolean
  showAction?: boolean
}>(), {
  state: undefined,
  loading: false,
  error: '',
  empty: false,
  title: '',
  description: '',
  actionText: '',
  rows: 3,
  compact: false,
  showAction: true,
})

const emit = defineEmits<{
  (event: 'retry'): void
}>()

const resolvedState = computed(() => {
  if (props.state) return props.state
  if (props.error) return 'error'
  if (props.loading) return 'loading'
  if (props.empty) return 'empty'
  return 'ready'
})

const stateIcon = computed(() => resolvedState.value === 'error' ? CircleCloseFilled : Box)

const resolvedTitle = computed(() => {
  if (props.title) return props.title
  if (resolvedState.value === 'error') return '数据加载失败'
  return '暂无数据'
})

const resolvedDescription = computed(() => {
  if (props.description) return props.description
  if (resolvedState.value === 'error') return '请检查网络或服务状态，然后点击重试。'
  return '当前条件下没有可展示的数据，可以调整筛选条件或稍后刷新。'
})
</script>

<style scoped>
.page-state {
  display: grid;
  place-items: center;
  min-height: 280px;
  padding: var(--space-xl);
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--radius-lg);
  background: var(--el-bg-color-overlay);
  color: var(--el-text-color-primary);
  text-align: center;
}

.page-state.is-compact {
  min-height: 168px;
  padding: var(--space-lg);
}

.page-state__icon {
  display: inline-grid;
  place-items: center;
  width: 44px;
  height: 44px;
  margin: 0 auto var(--space-md);
  border-radius: 999px;
  color: var(--el-color-primary);
  background: var(--color-surface-muted);
  font-size: 22px;
}

.page-state--error .page-state__icon {
  color: var(--el-color-danger);
}

.page-state__icon.is-loading {
  color: var(--el-color-primary);
  animation: state-spin 1.2s linear infinite;
}

.page-state__content {
  width: min(100%, 520px);
}

.page-state__content h3 {
  margin: 0 0 6px;
  font-size: 16px;
  font-weight: 700;
}

.page-state__content p {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.page-state__skeleton {
  margin-top: var(--space-lg);
  text-align: left;
}

.page-state__actions {
  display: flex;
  justify-content: center;
  gap: var(--space-sm);
  margin-top: var(--space-md);
  flex-wrap: wrap;
}

@keyframes state-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .page-state__icon.is-loading {
    animation: none;
  }
}
</style>
