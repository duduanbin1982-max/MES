<template>
  <section class="not-found page">
    <header class="page-header">
      <div>
        <div class="page-title">页面不存在</div>
        <div class="page-subtitle">链接可能已失效，或该模块已被调整。</div>
      </div>
    </header>
    <el-card shadow="never">
      <el-result icon="warning" title="404 · 找不到页面" sub-title="请检查地址是否正确，或从左侧菜单重新进入。">
        <template #extra>
          <el-button type="primary" @click="goHome">返回首页</el-button>
          <el-button @click="goBack">返回上一页</el-button>
        </template>
      </el-result>
    </el-card>
  </section>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()
function goHome() { router.push('/') }
function goBack() { if (window.history.length > 1) router.back(); else router.push('/') }
</script>

<style scoped>
.not-found :deep(.el-card__body) { padding: 8px; }
</style>
