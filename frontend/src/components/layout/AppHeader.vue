<template>
  <el-header class="top-header">
    <div class="header-leading">
      <el-button
        v-if="showMenuButton"
        class="menu-toggle"
        :icon="Menu"
        circle
        aria-label="打开主导航"
        title="打开主导航"
        @click="emit('toggle-menu')"
      />
      <div class="top-title">
        <span>{{ sectionTitle }}</span>
        <strong>{{ title }}</strong>
      </div>
    </div>
    <div class="top-actions">
      <span
        :title="`WebSocket: ${wsStatus}`"
        class="ws-indicator"
        :class="`ws-indicator--${wsStatus}`"
        aria-label="WebSocket 连接状态"
      ></span>
      <el-button class="theme-toggle" :icon="isDark ? Sunny : Moon" circle @click="emit('toggle-theme')" :title="isDark ? '切换亮色' : '切换暗色'" :aria-label="isDark ? '切换亮色主题' : '切换暗色主题'" />
      <router-link to="/help/manual" class="manual-link">操作手册</router-link>
      <router-link to="/scan" class="scan-link">扫码报工</router-link>
      <span class="clock">{{ now }}</span>
      <el-dropdown @command="emit('command', $event)" trigger="click">
        <button type="button" class="user-trigger">
          <el-avatar :size="28" class="user-avatar">{{ user?.full_name?.[0] || '?' }}</el-avatar>
          <span class="user-name">{{ user?.full_name || '未登录' }}</span>
          <el-tag class="role-tag" size="small">{{ user?.role || '-' }}</el-tag>
        </button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="manual">
              <el-icon><Document /></el-icon>操作手册
            </el-dropdown-item>
            <el-dropdown-item command="scan">
              <el-icon><Operation /></el-icon>扫码报工
            </el-dropdown-item>
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
import { Document, Menu, Moon, Operation, Sunny, SwitchButton } from '@element-plus/icons-vue'

defineProps({
  isDark: { type: Boolean, default: false },
  now: { type: String, default: '' },
  sectionTitle: { type: String, default: '当前位置' },
  showMenuButton: { type: Boolean, default: false },
  title: { type: String, default: 'TBM-MES' },
  user: { type: Object, default: null },
  wsStatus: { type: String, default: 'closed' },
})

const emit = defineEmits(['command', 'toggle-menu', 'toggle-theme'])
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
  flex: 0 0 60px;
  min-width: 0;
}

.header-leading {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.menu-toggle {
  display: none;
  flex: 0 0 40px;
}

.top-title {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.top-title span {
  color: var(--color-text-tertiary);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0;
}

.top-title strong {
  color: var(--el-text-color-primary);
  font-size: 17px;
  font-weight: 760;
  letter-spacing: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.top-actions,
.user-trigger {
  display: flex;
  align-items: center;
}

.top-actions {
  gap: 12px;
  min-width: 0;
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
  min-height: 40px;
  padding: 4px;
  border: 0;
  color: inherit;
  background: transparent;
  font: inherit;
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

@media (max-width: 1024px) {
  .menu-toggle {
    display: inline-flex;
  }

  .top-header {
    padding: 0 var(--space-md);
  }
}

@media (max-width: 820px) {
  .clock {
    display: none;
  }

  .top-actions {
    gap: 8px;
  }
}

@media (max-width: 680px) {
  .manual-link,
  .scan-link,
  .user-name,
  .role-tag {
    display: none;
  }

  .top-header {
    height: 56px;
    flex-basis: 56px;
    padding: 0 10px;
  }

  .menu-toggle,
  .theme-toggle,
  .user-trigger {
    min-width: 44px;
    min-height: 44px;
  }

  .top-title span {
    display: none;
  }

  .top-title strong {
    font-size: 15px;
  }
}
</style>
