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
// 根据角色过滤菜单
const role = computed(() => auth.user?.role || '')

// 每个角色能看的菜单 (空数组 = 全部)
const roleAccess: any = {
  admin: [],                                          // 管理员全看
  foreman: [],                                        // 车间主任全看
  engineer: [],                                       // 工程师全看
  worker: ['/scan'],                                  // 工人只看扫码
  qc: ['/quality', '/work-orders', '/scan'],          // 质检员
  welder: ['/scan', '/work-orders'],                  // 焊工
  sales: ['/dashboard', '/instances']                 // 销售
}

const visibleRoutes = computed(() => {
  // routes[0] = /login, routes[1] = / (Layout), routes[2] = /scan — 找有 children 的根路由
  const layoutRoute = router.options.routes.find((r: any) => r.children && r.children.length > 0)
  const all = layoutRoute?.children?.filter((r: any) => !r.meta?.hidden) || []
  const allowed = roleAccess[role.value]
  // undefined (未登录) 或空数组 (admin/foreman/engineer) → 全显示
  if (allowed === undefined || allowed.length === 0) return all
  return all.filter((r: any) => allowed.includes(r.path))
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
