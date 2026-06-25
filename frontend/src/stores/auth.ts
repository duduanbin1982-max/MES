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
  const login = async (username: string, password: string) => {
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

  const restore = () => {
    if (token.value) {
      api.defaults.headers.common['Authorization'] = 'Bearer ' + token.value
    }
  }

  // 启动时恢复
  restore()

  return { token, refreshToken, user, isLoggedIn, role, permissions, hasPerm, hasAnyPerm, login, logout, restore }
})