<template>
  <div class="login-page">
    <main class="login-shell">
      <section class="brand-panel" aria-label="TBM-MES 品牌信息">
        <div class="brand-mark"><el-icon><Tools /></el-icon></div>
        <div>
          <div class="brand-name">TBM-MES</div>
          <div class="brand-subtitle">成套装备生产管理系统</div>
        </div>
        <div class="brand-version">v2.3</div>
      </section>

      <el-card class="login-card" shadow="never">
        <div class="login-header">
          <h1>登录系统</h1>
          <p>使用已分配的 MES 账号继续</p>
        </div>
        <el-form :model="form" @submit.prevent="login" label-position="top" class="login-form">
          <el-form-item label="用户名">
            <el-input v-model="form.username" :prefix-icon="User" autocomplete="username" placeholder="请输入用户名" size="large" />
          </el-form-item>
          <el-form-item label="密码">
            <el-input v-model="form.password" :prefix-icon="Lock" autocomplete="current-password" type="password" placeholder="请输入密码" size="large" show-password @keyup.enter="login" />
          </el-form-item>
          <el-button native-type="submit" type="primary" size="large" :loading="loading" class="login-button">
            登录
          </el-button>
        </el-form>
        <div class="login-footnote">受控生产网络 · 操作全程审计</div>
      </el-card>
    </main>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Lock, User } from '@element-plus/icons-vue'
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
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--color-background);
}

.login-shell {
  display: grid;
  grid-template-columns: minmax(260px, 0.85fr) minmax(360px, 1fr);
  width: min(820px, calc(100vw - 48px));
  min-height: 460px;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: var(--shadow-lg);
}

.brand-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 16px;
  padding: 48px;
  color: var(--color-sidebar-text);
  background: var(--color-sidebar-bg);
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: var(--radius-md);
  background: var(--color-sidebar-bg-soft);
  font-size: 24px;
}

.brand-name {
  font-size: 30px;
  font-weight: 800;
  letter-spacing: 0;
}

.brand-subtitle {
  margin-top: 8px;
  color: var(--color-sidebar-muted);
  font-size: 14px;
}

.brand-version {
  position: absolute;
  left: 48px;
  bottom: 32px;
  color: var(--color-sidebar-muted);
  font-size: 12px;
}

.login-card {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 0;
  background: var(--color-surface);
}

.login-card :deep(.el-card__body) {
  box-sizing: border-box;
  width: min(360px, 100%);
  max-width: 100%;
  padding: 48px 36px;
}

.login-header h1 {
  margin: 0;
  color: var(--color-text);
  font-size: 24px;
  letter-spacing: 0;
}

.login-header p {
  margin: 8px 0 0;
  color: var(--color-text-secondary);
  font-size: 14px;
}

.login-form {
  margin-top: 28px;
}

.login-button {
  width: 100%;
  min-height: 44px;
}

.login-footnote {
  margin-top: 24px;
  color: var(--color-text-tertiary);
  font-size: 12px;
  text-align: center;
}

@media (max-width: 720px) {
  .login-page {
    padding: 12px;
  }

  .login-shell {
    grid-template-columns: 1fr;
    width: calc(100vw - 24px);
    min-height: 0;
  }

  .brand-panel {
    min-height: 150px;
    padding: 24px;
  }

  .brand-panel {
    flex-direction: row;
    align-items: center;
    justify-content: flex-start;
  }

  .brand-version {
    left: auto;
    right: 24px;
    bottom: 20px;
  }

  .login-card :deep(.el-card__body) {
    padding: 32px 24px;
  }
}
</style>
