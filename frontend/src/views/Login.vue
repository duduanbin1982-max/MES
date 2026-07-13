<template>
  <div class="login-page">
    <el-card class="login-card" shadow="always">
      <div class="login-header">
        <h2 style="margin: 0"><el-icon><Tools /></el-icon> TBM-MES</h2>
        <div style="color: var(--el-color-info); font-size: 13px; margin-top: 4px">成套装备生产管理系统 v2.1</div>
      </div>
      <el-form :model="form" @submit.prevent="login" label-width="80px" style="margin-top: 24px">
        <el-form-item label="用户名">
          <el-input v-model="form.username" placeholder="请输入用户名" size="large" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" type="password" placeholder="请输入密码" size="large" show-password @keyup.enter="login" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" size="large" :loading="loading" @click="login" style="width: 100%">
            登录
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const auth = useAuthStore()
const loading = ref(false)
const form = reactive({ username: '', password: '' })

const defaultRouteByRole: Record<string, string> = {
  warehouse: '/shopfloor?tab=pick',
  storekeeper: '/shopfloor?tab=pick',
  material: '/shopfloor?tab=pick',
  inventory: '/shopfloor?tab=pick',
  qc: '/shopfloor?tab=qc',
  worker: '/shopfloor?tab=scan',
  welder: '/shopfloor?tab=scan',
}

const getDefaultRoute = () => defaultRouteByRole[auth.user?.role || ''] || '/dashboard'

const login = async () => {
  if (!form.username || !form.password) { ElMessage.warning('请输入用户名和密码'); return }
  loading.value = true
  try {
    await auth.login(form.username, form.password)
    ElMessage.success(`欢迎, ${auth.user?.full_name || form.username}!`)
    const target = getDefaultRoute()
    try {
      await router.push(target)
      console.log(`[login] 跳 ${target} OK`)
    } catch (e) {
      console.warn(`[login] ${target} 跳失败, 兜底 /`, e)
      await router.push('/')
    }
  } catch (e: any) {
    console.error('[login] 失败:', e)
    const msg = e?.response?.data?.message || e?.response?.data?.error || e?.message || '登录失败'
    ElMessage.error(msg)
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}
.login-card { width: 400px; }
.login-header { text-align: center; }
</style>
