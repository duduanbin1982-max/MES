<template>
  <el-container style="height: 100vh">
    <el-aside width="220px" style="background: #001529; color: #fff">
      <div class="logo">
        <span style="font-size: 18px; font-weight: 600">🛠️ TBM-MES</span>
        <div style="font-size: 11px; color: #8c8c8c; margin-top: 4px">成套装备生产管理 v2.1</div>
      </div>
      <el-menu
        :default-active="$route.path"
        background-color="#001529"
        text-color="#cfd3dc"
        active-text-color="#409eff"
        router
      >
        <el-menu-item v-for="r in visibleRoutes" :key="r.path" :index="r.path">
          <el-icon><component :is="r.meta?.icon" /></el-icon>
          <span>{{ r.meta?.title }}</span>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header style="background: #fff; box-shadow: 0 1px 4px rgba(0,21,41,.08); display: flex; align-items: center; justify-content: space-between">
        <div style="font-size: 16px; font-weight: 500">{{ $route.meta?.title || 'TBM-MES' }}</div>
        <div style="display: flex; align-items: center; gap: 16px">
          <router-link to="/scan" style="color: #409eff; text-decoration: none; font-size: 14px">📱 扫码报工</router-link>
          <span style="color: #909399; font-size: 13px">{{ now }}</span>
          <el-dropdown @command="onCmd" trigger="click">
            <span style="cursor: pointer; display: flex; align-items: center; gap: 6px">
              <el-avatar :size="28" style="background: #409eff">{{ auth.user?.full_name?.[0] || '?' }}</el-avatar>
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
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { ElMessage } from 'element-plus'

const router = useRouter()
const auth = useAuthStore()
const onCmd = (cmd: string) => { if (cmd === 'logout') { auth.logout(); ElMessage.success('已登出'); router.push('/login') } }
// frontend/src/views/Layout.vue (P0-1 改用 permission 过滤菜单)
// 菜单可见性 = 该路由对应资源有 read 权限即可
// 例如 /materials 需 material:read, /work-orders 需 work_order:read
const PERM_BY_PATH: Record<string, string> = {
  '/dashboard': 'report:read',
  '/instances': 'equipment:read',
  '/materials': 'material:read',
  '/reports': 'report:read',
  '/eco': 'settings:read',
  '/gantt': 'work_order:read',
  '/multi-schedule': 'work_order:read',
  '/oee': 'equipment:read',
  '/settings': 'settings:read',
  '/inventory': 'material:read',
  '/quality': 'quality:read',
  '/schedule': 'work_order:read',
  '/process-tree': 'process:read',
  '/work-orders': 'work_order:read',
  '/field-service': 'equipment:read',
  '/audit': 'audit:read',
}

const visibleRoutes = computed(() => {
  const layoutRoute = router.options.routes.find((r: any) => r.children && r.children.length > 0)
  const all = layoutRoute?.children?.filter((r: any) => !r.meta?.hidden) || []
  // P0-1: 按 permission 过滤
  return all.filter((r: any) => {
    const need = PERM_BY_PATH[r.path]
    if (!need) return true   // 未登记的路由 (首页等) 默认可见
    return auth.hasPerm(need)
  })
})

const now = ref('')
let timer: any
const update = () => { now.value = new Date().toLocaleString('zh-CN') }
onMounted(() => { update(); timer = setInterval(update, 1000) })
onUnmounted(() => clearInterval(timer))
</script>

<style scoped>
.logo {
  padding: 16px;
  color: #fff;
  border-bottom: 1px solid #1f2d3d;
}
.el-menu { border-right: 0; }
</style>
