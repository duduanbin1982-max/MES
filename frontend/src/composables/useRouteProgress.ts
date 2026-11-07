// frontend/src/composables/useRouteProgress.ts
// 2026-11-07 全局 UI/UX：路由懒加载顶部进度条（轻量、无第三方依赖）
import { ref } from 'vue'

export const routeLoading = ref(false)
let startedAt = 0
let guardTimer: ReturnType<typeof setTimeout> | null = null

export function startRouteProgress() {
  startedAt = Date.now()
  routeLoading.value = true
  if (guardTimer) clearTimeout(guardTimer)
  // 兜底：即使 afterEach 未触发，也不会永久卡住进度条
  guardTimer = setTimeout(() => {
    routeLoading.value = false
    guardTimer = null
  }, 10000)
}

export function finishRouteProgress() {
  if (guardTimer) {
    clearTimeout(guardTimer)
    guardTimer = null
  }
  routeLoading.value = false
}

export function routeProgressStartedAt() {
  return startedAt
}
