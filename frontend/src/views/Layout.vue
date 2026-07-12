<template>
  <el-container style="height: 100vh">
    <el-aside width="260px" class="sidebar">
      <div class="logo">
        <span class="logo-title">TBM-MES</span>
        <div class="logo-sub">成套装备生产管理 v2.3</div>
      </div>
      <el-menu
        :default-active="activeMenuIndex"
        :default-openeds="openedSections"
        :collapse-transition="false"
        background-color="#001529"
        text-color="#cfd3dc"
        active-text-color="var(--el-color-primary)"
        router
      >
        <el-sub-menu v-for="section in visibleSections" :key="section.key" :index="section.key">
          <template #title>
            <el-icon><component :is="section.icon" /></el-icon>
            <span>{{ section.title }}</span>
          </template>
          <el-menu-item v-for="item in section.items" :key="item.key" :index="item.to">
            <el-icon><component :is="item.icon" /></el-icon>
            <span>{{ item.title }}</span>
          </el-menu-item>
        </el-sub-menu>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="top-header">
        <div style="font-size: 16px; font-weight: 500">{{ $route.meta?.title || 'TBM-MES' }}</div>
        <div style="display: flex; align-items: center; gap: 16px">
          <span :title="`WebSocket: ${wsStatus}`" :style="{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: wsStatus === 'open' ? 'var(--el-color-success)' : wsStatus === 'connecting' ? 'var(--el-color-warning)' : 'var(--el-color-danger)' }"></span>
          <el-button :icon="isDark ? Sunny : Moon" circle size="small" @click="toggleTheme" :title="isDark ? '切换亮色' : '切换暗色'" />
          <router-link to="/help/manual" class="manual-link">操作手册</router-link>
          <router-link to="/scan" class="scan-link">扫码报工</router-link>
          <span class="clock">{{ now }}</span>
          <el-dropdown @command="onCmd" trigger="click">
            <span style="cursor: pointer; display: flex; align-items: center; gap: 6px">
              <el-avatar :size="28" style="background: var(--el-color-primary)">{{ auth.user?.full_name?.[0] || '?' }}</el-avatar>
              <span style="font-size: 13px">{{ auth.user?.full_name || '未登录' }}</span>
              <el-tag size="small">{{ auth.user?.role || '-' }}</el-tag>
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

      <el-main style="padding: 0; background: #f0f2f5">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
  <WsPanel />
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Moon, Sunny, SwitchButton } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import WsPanel from '../components/WsPanel.vue'
import { MENU_SECTIONS } from '../config/menuCatalog'
import { filterMenuSections } from '../config/menuPolicy'
import { useShellNotifications } from '../composables/useShellNotifications'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const now = ref('')
const isDark = ref(false)
let timer: ReturnType<typeof setInterval> | null = null

const onCmd = (cmd: string) => {
  if (cmd === 'logout') {
    auth.logout()
    ElMessage.success('已登出')
    router.push('/login')
  }
}

const visibleSections = computed(() => filterMenuSections(MENU_SECTIONS, {
  role: auth.user?.role || '',
  hasAnyPerm: (...needs: string[]) => auth.hasAnyPerm(...needs),
}))

const openedSections = computed(() => visibleSections.value.map((section) => section.key))
const activeMenuIndex = computed(() => {
  const items = visibleSections.value.flatMap((section) => section.items)
  const tabOnly = route.query.tab ? `${route.path}?tab=${route.query.tab}` : route.path
  return items.find((item) => item.to === route.fullPath)?.to
    || items.find((item) => item.to === tabOnly)?.to
    || items.find((item) => item.to.split('?')[0] === route.path)?.to
    || route.path
})

watch(visibleSections, (sections) => {
  console.log(
    '[Layout] visible menu sections=',
    sections.map((section) => ({ key: section.key, items: section.items.map((item) => item.to) })),
    'permissions=' + JSON.stringify(auth.permissions),
    'role=' + auth.user?.role,
  )
}, { immediate: true })

watch(() => route.path, (path) => {
  console.log('[Layout] active route=', path)
}, { immediate: true })

const toggleTheme = () => {
  isDark.value = !isDark.value
  localStorage.setItem('tbm-theme', isDark.value ? 'dark' : 'light')
  applyTheme()
}

const update = () => {
  now.value = new Date().toLocaleString('zh-CN')
}

const { status: wsStatus } = useShellNotifications()

onMounted(() => {
  const saved = localStorage.getItem('tbm-theme')
  if (saved === 'light' || saved === 'dark') {
    // 用户已显式选择, 尊重
    isDark.value = saved === 'dark'
  } else {
    // 跟随系统偏好 (P1-3 Hermes ui-ux-pro-max)
    isDark.value = window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  applyTheme()
  update()
  timer = setInterval(update, 1000)

  // 监听系统偏好变化 (用户没显式设置过)
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', e => {
    if (!localStorage.getItem('tbm-theme')) {
      isDark.value = e.matches
      applyTheme()
    }
  })
})

function applyTheme() {
  if (isDark.value) document.documentElement.setAttribute('data-theme', 'dark')
  else document.documentElement.removeAttribute('data-theme')
}

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<style scoped>
.el-menu { border-right: 0; }

.sidebar {
  background: var(--el-menu-bg-color);
  color: var(--el-menu-text-color);
  border-right: 1px solid var(--el-border-color);
}

.logo {
  padding: 20px 16px 12px;
  border-bottom: 1px solid var(--el-border-color-light);
}

.logo-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--el-menu-text-color);
}

.logo-sub {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}

.top-header {
  background: var(--el-bg-color-overlay);
  box-shadow: var(--shadow-sm);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-lg);
  height: 56px;
}

.manual-link,
.scan-link {
  color: var(--el-color-primary);
  text-decoration: none;
  font-size: 14px;
}

.clock {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
