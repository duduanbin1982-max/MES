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

onMounted(() => {
  // 登录态决定去哪儿
  if (auth.isLoggedIn) {
    msg.value = '进入仪表盘...'
    router.replace('/dashboard')
  } else {
    msg.value = '进入登录...'
    router.replace('/login')
  }
})
</script>
