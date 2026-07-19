<template>
  <el-header class="top-header">
    <div class="top-title">
      <span>当前位置</span>
      <strong>{{ title }}</strong>
    </div>
    <div class="top-actions">
      <span
        :title="`WebSocket: ${wsStatus}`"
        class="ws-indicator"
        :class="`ws-indicator--${wsStatus}`"
        aria-label="WebSocket 连接状态"
      ></span>
      <el-button :icon="isDark ? Sunny : Moon" circle size="small" @click="emit('toggle-theme')" :title="isDark ? '切换亮色' : '切换暗色'" />
      <router-link to="/help/manual" class="manual-link">操作手册</router-link>
      <router-link to="/scan" class="scan-link">扫码报工</router-link>
      <span class="clock">{{ now }}</span>
      <el-dropdown @command="emit('command', $event)" trigger="click">
        <span class="user-trigger" tabindex="0">
          <el-avatar :size="28" class="user-avatar">{{ user?.full_name?.[0] || '?' }}</el-avatar>
          <span class="user-name">{{ user?.full_name || '未登录' }}</span>
          <el-tag size="small">{{ user?.role || '-' }}</el-tag>
        </span>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="logout" divided>
              <el-icon><SwitchButton /></el-icon>登出
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
  </el-header>
</template>

<script setup>
import { Moon, Sunny, SwitchButton } from '@element-plus/icons-vue'

defineProps({
  isDark: { type: Boolean, default: false },
  now: { type: String, default: '' },
  title: { type: String, default: 'TBM-MES' },
  user: { type: Object, default: null },
  wsStatus: { type: String, default: 'closed' },
})

const emit = defineEmits(['command', 'toggle-theme'])
</script>

<style scoped>
.top-header {
  background: var(--el-bg-color-overlay);
  border-bottom: 1px solid var(--el-border-color-lighter);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.035);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-lg);
  height: 60px;
}

.top-title {
  display: grid;
  gap: 2px;
}

.top-title span {
  color: var(--color-text-tertiary);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.top-title strong {
  color: var(--el-text-color-primary);
  font-size: 17px;
  font-weight: 760;
  letter-spacing: -0.015em;
}

.top-actions,
.user-trigger {
  display: flex;
  align-items: center;
}

.top-actions {
  gap: 12px;
}

.ws-indicator {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--el-color-danger);
  box-shadow: 0 0 0 4px rgba(185, 106, 106, 0.12);
}

.ws-indicator--open {
  background: var(--el-color-success);
  box-shadow: 0 0 0 4px rgba(67, 133, 107, 0.14);
}

.ws-indicator--connecting {
  background: var(--el-color-warning);
  box-shadow: 0 0 0 4px rgba(197, 138, 58, 0.14);
}

.user-trigger {
  cursor: pointer;
  gap: 6px;
}

.user-avatar {
  background: linear-gradient(135deg, var(--el-color-primary), var(--chart-cyan));
}

.user-name {
  font-size: 13px;
}

.manual-link,
.scan-link {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 999px;
  color: var(--el-color-primary);
  background: var(--color-surface-muted);
  text-decoration: none;
  font-size: 13px;
  font-weight: 600;
  transition: background-color var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
}

.manual-link:hover,
.scan-link:hover {
  border-color: var(--el-color-primary-light-7);
  background: var(--color-primary-soft);
}

.clock {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
