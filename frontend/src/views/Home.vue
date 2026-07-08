<template>
  <div style="display: flex; justify-content: center; align-items: center; height: 60vh; flex-direction: column; gap: 16px">
    <el-icon :size="40" class="is-loading"><Loading /></el-icon>
    <span style="color: #909399">{{ msg }}</span>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const auth = useAuthStore()
const msg = ref('加载中...')

const defaultRouteByRole: Record<string, string> = {
  warehouse: '/shopfloor?tab=pick',
  storekeeper: '/shopfloor?tab=pick',
  material: '/shopfloor?tab=pick',
  inventory: '/shopfloor?tab=pick',
  qc: '/shopfloor?tab=qc',
  worker: '/shopfloor?tab=scan',
  welder: '/shopfloor?tab=scan',
}

onMounted(() => {
  // 登录态决定去哪儿
  if (auth.isLoggedIn) {
    const target = defaultRouteByRole[auth.user?.role || ''] || '/dashboard'
    msg.value = target.startsWith('/shopfloor') ? '进入车间工作台...' : '进入仪表盘...'
    router.replace(target)
  } else {
    msg.value = '进入登录...'
    router.replace('/login')
  }
})
</script>
