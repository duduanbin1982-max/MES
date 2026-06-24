<template>
  <div class="login-page">
    <el-card class="login-card" shadow="always">
      <div class="login-header">
        <h2 style="margin: 0">🛠️ TBM-MES</h2>
        <div style="color: #909399; font-size: 13px; margin-top: 4px">成套装备生产管理系统 v2.1</div>
      </div>
      <el-form :model="form" @submit.prevent="login" label-width="80px" style="margin-top: 24px">
        <el-form-item label="用户名">
          <el-input v-model="form.username" placeholder="admin / foreman01 / engineer01 / worker01 / qc01 / welder01" size="large" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" type="password" placeholder="默认密码 = 用户名" size="large" show-password @keyup.enter="login" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" size="large" :loading="loading" @click="login" style="width: 100%">
            登录
          </el-button>
        </el-form-item>
      </el-form>
      <div style="margin-top: 16px; padding: 12px; background: #f5f7fa; border-radius: 4px; font-size: 12px; color: #606266">
        <div style="font-weight: 500; margin-bottom: 6px">演示账号（密码 = 用户名）：</div>
        <div>• <strong>admin</strong> (系统管理员)</div>
        <div>• <strong>foreman01</strong> (张主任, 车间主任)</div>
        <div>• <strong>engineer01</strong> (李工, 工程师)</div>
        <div>• <strong>worker01</strong> (王师傅, 工人)</div>
        <div>• <strong>qc01</strong> (赵质检, 质检员)</div>
        <div>• <strong>welder01</strong> (孙焊工, 焊工)</div>
      </div>
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
const form = reactive({ username: 'admin', password: 'admin' })

const login = async () => {
  if (!form.username || !form.password) { ElMessage.warning('请输入用户名和密码'); return }
  loading.value = true
  try {
    await auth.login(form.username, form.password)
    ElMessage.success(`欢迎, ${auth.user?.full_name}!`)
    router.push('/dashboard')
  } catch (e: any) {
    ElMessage.error(e.message || '登录失败')
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
