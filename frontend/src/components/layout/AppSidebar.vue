<template>
  <el-aside width="260px" class="sidebar">
    <div class="logo">
      <div class="logo-brand">
        <span class="logo-mark">MES</span>
        <div>
          <span class="logo-title">TBM-MES</span>
          <div class="logo-sub">成套装备生产管理 v2.3</div>
        </div>
      </div>
      <div class="logo-status">
        <span class="status-dot"></span>
        <span>生产在线</span>
      </div>
    </div>
    <div class="menu-search">
      <el-input
        :model-value="menuKeyword"
        :prefix-icon="Search"
        size="small"
        clearable
        placeholder="搜索菜单 / 业务入口"
        aria-label="搜索菜单"
        @update:model-value="emit('update:menuKeyword', $event)"
      />
    </div>
    <section v-if="showQuickNav" class="quick-nav" aria-label="快捷导航">
      <div class="quick-nav-row">
        <div class="quick-nav-title">
          <el-icon><StarFilled /></el-icon>
          <span>收藏</span>
        </div>
        <div v-if="favoriteItems.length" class="quick-list">
          <router-link
            v-for="item in favoriteItems"
            :key="`fav-${item.key}`"
            :to="item.to"
            class="quick-link"
            :class="{ 'is-active': isMenuItemActive(item) }"
            :title="`${item.sectionTitle} / ${item.title}`"
          >
            <el-icon><component :is="item.icon" /></el-icon>
            <span>{{ item.title }}</span>
          </router-link>
        </div>
        <div v-else class="quick-empty">点击菜单右侧星标收藏常用模块</div>
      </div>

      <div class="quick-nav-row">
        <div class="quick-nav-title">
          <el-icon><Clock /></el-icon>
          <span>最近访问</span>
        </div>
        <div v-if="recentItems.length" class="quick-list">
          <router-link
            v-for="item in recentItems"
            :key="`recent-${item.key}`"
            :to="item.to"
            class="quick-link"
            :class="{ 'is-active': isMenuItemActive(item) }"
            :title="`${item.sectionTitle} / ${item.title}`"
          >
            <el-icon><component :is="item.icon" /></el-icon>
            <span>{{ item.title }}</span>
          </router-link>
        </div>
        <div v-else class="quick-empty">访问过的模块会显示在这里</div>
      </div>
    </section>
    <el-menu
      :key="menuKey"
      class="app-menu"
      :default-active="activeMenuIndex"
      :default-openeds="openedSections"
      :collapse-transition="false"
      background-color="var(--color-sidebar-bg)"
      text-color="var(--color-sidebar-text)"
      active-text-color="var(--color-sidebar-active)"
      unique-opened
      router
      aria-label="主导航"
    >
      <el-sub-menu v-for="section in filteredSections" :key="section.key" :index="section.key">
        <template #title>
          <el-icon><component :is="section.icon" /></el-icon>
          <span>{{ section.title }}</span>
        </template>
        <el-menu-item v-for="item in section.items" :key="item.key" :index="item.to" class="nav-menu-item">
          <div class="menu-item-content">
            <span class="menu-item-main">
              <el-icon><component :is="item.icon" /></el-icon>
              <span>{{ item.title }}</span>
            </span>
            <button
              type="button"
              class="favorite-toggle"
              :class="{ 'is-favorite': isFavorite(item.key) }"
              :aria-label="isFavorite(item.key) ? `取消收藏 ${item.title}` : `收藏 ${item.title}`"
              :title="isFavorite(item.key) ? '取消收藏' : '收藏'"
              @click.stop.prevent="toggleFavorite(item.key)"
            >
              <el-icon><component :is="isFavorite(item.key) ? StarFilled : Star" /></el-icon>
            </button>
          </div>
        </el-menu-item>
      </el-sub-menu>
    </el-menu>
    <div v-if="filteredSections.length === 0" class="menu-empty" role="status">
      未找到匹配菜单
    </div>
  </el-aside>
</template>

<script setup>
import { Clock, Search, Star, StarFilled } from '@element-plus/icons-vue'

defineProps({
  activeMenuIndex: { type: String, required: true },
  favoriteItems: { type: Array, default: () => [] },
  filteredSections: { type: Array, default: () => [] },
  isFavorite: { type: Function, required: true },
  isMenuItemActive: { type: Function, required: true },
  menuKey: { type: String, required: true },
  menuKeyword: { type: String, default: '' },
  openedSections: { type: Array, default: () => [] },
  recentItems: { type: Array, default: () => [] },
  showQuickNav: { type: Boolean, default: true },
  toggleFavorite: { type: Function, required: true },
})

const emit = defineEmits(['update:menuKeyword'])
</script>

<style scoped>
.el-menu { border-right: 0; }

.sidebar {
  background: var(--color-sidebar-bg);
  color: var(--color-sidebar-text);
  border-right: 1px solid rgba(15, 23, 42, 0.18);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 8px 0 24px rgba(15, 23, 42, 0.08);
}

.logo {
  padding: 18px 16px 14px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
  background:
    radial-gradient(circle at top right, rgba(214, 164, 91, 0.16), transparent 45%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.06), transparent);
}

.logo-brand {
  display: flex;
  gap: 12px;
  align-items: center;
}

.logo-mark {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 14px;
  color: #F8FAFC;
  background:
    linear-gradient(135deg, rgba(79, 127, 168, 0.72), rgba(214, 164, 91, 0.62)),
    var(--color-sidebar-bg-soft);
  font-family: "Fira Code", "Cascadia Code", monospace;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.05em;
}

.logo-title {
  font-size: 18px;
  font-weight: 750;
  color: var(--color-sidebar-text);
  letter-spacing: 0.02em;
}

.logo-sub {
  font-size: 11px;
  color: var(--color-sidebar-muted);
  margin-top: 4px;
}

.logo-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  padding: 5px 9px;
  border: 1px solid rgba(255, 255, 255, 0.10);
  border-radius: 999px;
  color: rgba(231, 237, 245, 0.78);
  background: rgba(255, 255, 255, 0.05);
  font-size: 11px;
  line-height: 1;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-success);
  box-shadow: 0 0 0 4px rgba(67, 133, 107, 0.18);
}

.menu-search {
  padding: 14px 12px 8px;
}

.menu-search :deep(.el-input__wrapper) {
  background: rgba(255, 255, 255, 0.075);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 11px;
  box-shadow: none;
}

.menu-search :deep(.el-input__inner),
.menu-search :deep(.el-input__prefix) {
  color: var(--color-sidebar-text);
}

.menu-search :deep(.el-input__inner::placeholder) {
  color: rgba(226, 232, 240, 0.58);
}

.quick-nav {
  padding: 2px 12px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.quick-nav-row + .quick-nav-row {
  margin-top: 8px;
}

.quick-nav-title {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 5px;
  color: var(--color-sidebar-muted);
  font-size: 11px;
  font-weight: 600;
}

.quick-list {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.quick-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  max-width: 124px;
  padding: 6px 9px;
  border: 1px solid rgba(255, 255, 255, 0.10);
  border-radius: 10px;
  color: rgba(231, 237, 245, 0.84);
  background: rgba(255, 255, 255, 0.05);
  font-size: 12px;
  line-height: 1;
  text-decoration: none;
  transition: background-color var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast);
}

.quick-link span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quick-link:hover,
.quick-link:focus-visible,
.quick-link.is-active {
  color: var(--color-sidebar-active);
  border-color: rgba(214, 164, 91, 0.34);
  background: rgba(214, 164, 91, 0.10);
}

.quick-empty {
  color: rgba(226, 232, 240, 0.54);
  font-size: 11px;
  line-height: 1.5;
}

.app-menu {
  flex: 1;
  overflow-y: auto;
  padding: 8px 8px 14px;
}

.app-menu :deep(.el-sub-menu__title),
.app-menu :deep(.el-menu-item) {
  height: 40px;
  border-radius: 10px;
  margin: 2px 0;
}

.app-menu :deep(.el-sub-menu__title) {
  color: rgba(231, 237, 245, 0.84);
  font-weight: 700;
}

.app-menu :deep(.el-sub-menu__title:hover),
.app-menu :deep(.el-menu-item:hover) {
  background: rgba(255, 255, 255, 0.07) !important;
}

.app-menu :deep(.el-sub-menu.is-opened > .el-sub-menu__title) {
  color: #F8FAFC;
}

.app-menu :deep(.el-menu) {
  padding: 2px 0 6px;
  background: transparent;
}

.app-menu :deep(.el-menu-item) {
  color: rgba(231, 237, 245, 0.76);
  font-size: 13px;
}

.app-menu :deep(.el-menu-item.is-active) {
  position: relative;
  color: #F8FAFC !important;
  background: rgba(214, 164, 91, 0.14) !important;
}

.app-menu :deep(.el-menu-item.is-active)::before {
  position: absolute;
  left: 0;
  top: 9px;
  width: 3px;
  height: 22px;
  border-radius: 0 999px 999px 0;
  background: var(--color-sidebar-active);
  content: "";
}

.nav-menu-item :deep(.el-tooltip__trigger),
.menu-item-content {
  width: 100%;
}

.menu-item-content,
.menu-item-main {
  display: flex;
  align-items: center;
}

.menu-item-content {
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.menu-item-main {
  gap: 8px;
  min-width: 0;
}

.menu-item-main span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.favorite-toggle {
  display: inline-grid;
  place-items: center;
  flex: 0 0 24px;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  color: rgba(231, 237, 245, 0.50);
  background: transparent;
  cursor: pointer;
  opacity: 0.58;
  transition: background-color var(--transition-fast), color var(--transition-fast), opacity var(--transition-fast);
}

.favorite-toggle:hover,
.favorite-toggle:focus-visible,
.favorite-toggle.is-favorite {
  color: var(--color-sidebar-active);
  background: rgba(214, 164, 91, 0.12);
  opacity: 1;
}

.menu-empty {
  margin: 12px;
  padding: 12px;
  border-radius: var(--radius-md);
  color: rgba(226, 232, 240, 0.72);
  background: rgba(255, 255, 255, 0.06);
  font-size: 13px;
  text-align: center;
}
</style>
