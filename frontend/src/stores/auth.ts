import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '../api'

// P0-2: 双 token key
const ACCESS_KEY  = 'tbm_access_token'
const REFRESH_KEY = 'tbm_refresh_token'
const USER_KEY    = 'tbm_user'
// 兼容旧 key
const OLD_TOKEN   = 'tbm_token'

export const useAuthStore = defineStore('auth', () => {
  // P0-2: 优先用新 key, fallback 旧 key (老用户登录态保留)
  const token = ref(localStorage.getItem(ACCESS_KEY) || localStorage.getItem(OLD_TOKEN) || '')
  const refreshToken = ref(localStorage.getItem(REFRESH_KEY) || '')
  const user = ref<any>(JSON.parse(localStorage.getItem(USER_KEY) || 'null'))

  const isLoggedIn = computed(() => !!token.value)
  const role = computed(() => user.value?.role || '')
  const permissions = computed<string[]>(() => user.value?.permissions || [])

  // P0-1: permission 检查
  const hasPerm = (code: string): boolean => {
    const perms = permissions.value
    if (perms.includes('*')) return true
    if (perms.includes(code)) return true
    return perms.some(p => p.endsWith(':*') && code.startsWith(p.slice(0, -1)))
  }
  const hasAnyPerm = (...codes: string[]) => codes.some(hasPerm)

  // P0-2: 登录 (api.login 内部已写 localStorage)
  //   关键: 如果启动时的 restore() 还在跑 (带旧 token 拉 /me),
  //   要先等它结束, 否则会 race condition 覆盖新 user
  const _restorePromise: { value: Promise<void> | null } = { value: null }
  const login = async (username: string, password: string) => {
    if (_restorePromise.value) { await _restorePromise.value }
    const r: any = await api.login(username, password)
    token.value = r.access_token
    refreshToken.value = r.refresh_token
    user.value = r.user
    api.defaults.headers.common['Authorization'] = 'Bearer ' + r.access_token
  }

  const logout = () => {
    token.value = ''
    refreshToken.value = ''
    user.value = null
    localStorage.removeItem(ACCESS_KEY)
    localStorage.removeItem(REFRESH_KEY)
    localStorage.removeItem(USER_KEY)
    localStorage.removeItem(OLD_TOKEN)  // 清兼容旧 key
    delete api.defaults.headers.common['Authorization']
  }

  const restore = async () => {
    if (token.value) {
      api.defaults.headers.common['Authorization'] = 'Bearer ' + token.value
      // 旧 token 可能没 permissions, 拉一次 /me 拿最新
      if (!user.value?.permissions || user.value.permissions.length === 0) {
        try {
          const me: any = await api.me()
          user.value = { ...user.value, ...me }
          localStorage.setItem(USER_KEY, JSON.stringify(user.value))
        } catch (_e) { /* 401 时 api 拦截器会跳登录 */ }
      }
    }
  }

  // 启动时恢复 (暴露 promise 给 login 等待)
  _restorePromise.value = restore()

  return { token, refreshToken, user, isLoggedIn, role, permissions, hasPerm, hasAnyPerm, login, logout, restore }
})