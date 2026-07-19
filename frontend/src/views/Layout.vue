<template>
  <a class="skip-link" href="#main-content">跳到主内容</a>
  <el-container class="app-shell">
    <AppSidebar
      v-model:menu-keyword="menuKeyword"
      :active-menu-index="activeMenuIndex"
      :favorite-items="favoriteItems"
      :filtered-sections="filteredSections"
      :is-favorite="isFavorite"
      :is-menu-item-active="isMenuItemActive"
      :menu-key="menuKey"
      :opened-sections="openedSections"
      :recent-items="recentItems"
      :show-quick-nav="showQuickNav"
      :toggle-favorite="toggleFavorite"
    />

    <el-container>
      <AppHeader
        :is-dark="isDark"
        :now="now"
        :title="$route.meta?.title || 'TBM-MES'"
        :user="auth.user"
        :ws-status="wsStatus"
        @command="onCmd"
        @toggle-theme="toggleTheme"
      />

      <el-main id="main-content" class="layout-main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
  <WsPanel />
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import AppHeader from '../components/layout/AppHeader.vue'
import AppSidebar from '../components/layout/AppSidebar.vue'
import WsPanel from '../components/WsPanel.vue'
import { MENU_SECTIONS, type MenuItem } from '../config/menuCatalog'
import { filterMenuSections } from '../config/menuPolicy'
import { useShellNotifications } from '../composables/useShellNotifications'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const now = ref('')
const isDark = ref(false)
const menuKeyword = ref('')
const favoriteKeys = ref<string[]>([])
const recentKeys = ref<string[]>([])
const storageReady = ref(false)
let timer: ReturnType<typeof setInterval> | null = null

const FAVORITE_STORAGE_KEY = 'tbm-menu-favorites'
const RECENT_STORAGE_KEY = 'tbm-menu-recent'
const MAX_FAVORITES = 8
const MAX_RECENT = 8

type NavMenuItem = MenuItem & {
  sectionKey: string
  sectionTitle: string
}

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

const visibleItems = computed<NavMenuItem[]>(() =>
  visibleSections.value.flatMap((section) =>
    section.items.map((item) => ({
      ...item,
      sectionKey: section.key,
      sectionTitle: section.title,
    })),
  ),
)

const normalizedMenuKeyword = computed(() => menuKeyword.value.trim().toLowerCase())

const filteredSections = computed(() => {
  const keyword = normalizedMenuKeyword.value
  if (!keyword) return visibleSections.value

  return visibleSections.value
    .map((section) => {
      const sectionText = `${section.title} ${section.key}`.toLowerCase()
      const sectionMatched = sectionText.includes(keyword)
      const items = sectionMatched
        ? section.items
        : section.items.filter((item) => `${item.title} ${item.key} ${item.to}`.toLowerCase().includes(keyword))
      return { ...section, items }
    })
    .filter((section) => section.items.length > 0)
})

const activeMenuIndex = computed(() => {
  const items = visibleItems.value
  const tabOnly = route.query.tab ? `${route.path}?tab=${route.query.tab}` : route.path
  return items.find((item) => item.to === route.fullPath)?.to
    || items.find((item) => item.to === tabOnly)?.to
    || items.find((item) => item.to.split('?')[0] === route.path)?.to
    || route.path
})

const favoriteItems = computed(() => resolveMenuKeys(favoriteKeys.value).slice(0, MAX_FAVORITES))
const recentItems = computed(() => resolveMenuKeys(recentKeys.value).slice(0, MAX_RECENT))
const showQuickNav = computed(() => !normalizedMenuKeyword.value)

const currentSectionKey = computed(() => {
  const active = activeMenuIndex.value
  return visibleSections.value.find((section) =>
    section.items.some((item) => item.to === active || item.to.split('?')[0] === route.path),
  )?.key
})

const openedSections = computed(() => {
  if (normalizedMenuKeyword.value) return filteredSections.value.map((section) => section.key)
  if (currentSectionKey.value) return [currentSectionKey.value]
  return filteredSections.value.slice(0, 1).map((section) => section.key)
})

const menuKey = computed(() => `${normalizedMenuKeyword.value ? 'search' : 'route'}:${openedSections.value.join(',')}`)

function resolveMenuKeys(keys: string[]) {
  return keys
    .map((key) => visibleItems.value.find((item) => item.key === key))
    .filter((item): item is NavMenuItem => Boolean(item))
}

function isFavorite(key: string) {
  return favoriteKeys.value.includes(key)
}

function toggleFavorite(key: string) {
  favoriteKeys.value = isFavorite(key)
    ? favoriteKeys.value.filter((itemKey) => itemKey !== key)
    : [key, ...favoriteKeys.value.filter((itemKey) => itemKey !== key)].slice(0, MAX_FAVORITES)
  persistMenuList(FAVORITE_STORAGE_KEY, favoriteKeys.value)
}

function isMenuItemActive(item: Pick<NavMenuItem, 'to'>) {
  const tabOnly = route.query.tab ? `${route.path}?tab=${route.query.tab}` : route.path
  return item.to === route.fullPath || item.to === tabOnly || item.to.split('?')[0] === route.path
}

function findCurrentMenuItem() {
  return visibleItems.value.find((item) => isMenuItemActive(item))
}

function recordRecent(item = findCurrentMenuItem()) {
  if (!item || !storageReady.value) return
  recentKeys.value = [item.key, ...recentKeys.value.filter((itemKey) => itemKey !== item.key)].slice(0, MAX_RECENT)
  persistMenuList(RECENT_STORAGE_KEY, recentKeys.value)
}

function readMenuList(key: string) {
  try {
    const rawValue = localStorage.getItem(key)
    const parsedValue = rawValue ? JSON.parse(rawValue) : []
    return Array.isArray(parsedValue)
      ? parsedValue.filter((itemKey): itemKey is string => typeof itemKey === 'string')
      : []
  } catch {
    return []
  }
}

function persistMenuList(key: string, value: string[]) {
  if (!storageReady.value) return
  localStorage.setItem(key, JSON.stringify(value))
}

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
  favoriteKeys.value = readMenuList(FAVORITE_STORAGE_KEY)
  recentKeys.value = readMenuList(RECENT_STORAGE_KEY)
  storageReady.value = true
  recordRecent()

  const saved = localStorage.getItem('tbm-theme')
  if (saved === 'light' || saved === 'dark') {
    isDark.value = saved === 'dark'
  } else {
    isDark.value = false
  }
  applyTheme()
  update()
  timer = setInterval(update, 1000)
})

watch(
  () => [route.fullPath, visibleItems.value.map((item) => item.key).join('|')],
  () => recordRecent(),
)

function applyTheme() {
  if (isDark.value) document.documentElement.setAttribute('data-theme', 'dark')
  else document.documentElement.removeAttribute('data-theme')
}

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<style scoped>
.app-shell {
  height: 100vh;
  background: var(--el-bg-color-page);
}

.layout-main {
  padding: 0;
  background: var(--el-bg-color-page);
  overflow: auto;
}

.skip-link {
  position: fixed;
  left: 12px;
  top: 12px;
  z-index: 3000;
  transform: translateY(-140%);
  padding: 8px 12px;
  border-radius: var(--radius-md);
  background: var(--el-bg-color-overlay);
  color: var(--el-text-color-primary);
  box-shadow: var(--shadow-md);
  transition: transform var(--transition-fast);
}

.skip-link:focus {
  transform: translateY(0);
}
</style>
