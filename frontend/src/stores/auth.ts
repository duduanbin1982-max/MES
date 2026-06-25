import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '../api'

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('tbm_token') || '')
  const user = ref<any>(JSON.parse(localStorage.getItem('tbm_user') || 'null'))

  const isLoggedIn = computed(() => !!token.value)
  const role = computed(() => user.value?.role || '')
  // P0-1: permissions 数组持久化, 启动恢复
  const permissions = computed<string[]>(() => user.value?.permissions || [])

  // P0-1: 检查是否有某 permission
  //  - '*' 拥有所有
  //  - 'material:write' 精确匹配
  //  - 'material:*' 资源级通配
  const hasPerm = (code: string): boolean => {
    const perms = permissions.value
    if (perms.includes('*')) return true
    if (perms.includes(code)) return true
    return perms.some(p => p.endsWith(':*') && code.startsWith(p.slice(0, -1)))
  }
  // 多个 permission 任一满足即可
  const hasAnyPerm = (...codes: string[]) => codes.some(hasPerm)

  const login = async (username: string, password: string) => {
    const r: any = await api.post('/auth/login', { username, password })
    token.value = r.token
    user.value = r.user
    localStorage.setItem('tbm_token', r.token)
    localStorage.setItem('tbm_user', JSON.stringify(r.user))
    api.defaults.headers.common['Authorization'] = 'Bearer ' + r.token
  }

  const logout = () => {
    token.value = ''
    user.value = null
    localStorage.removeItem('tbm_token')
    localStorage.removeItem('tbm_user')
    delete api.defaults.headers.common['Authorization']
  }

  const restore = () => {
    if (token.value) {
      api.defaults.headers.common['Authorization'] = 'Bearer ' + token.value
    }
  }

  // 启动时恢复
  restore()

  return { token, user, isLoggedIn, role, permissions, hasPerm, hasAnyPerm, login, logout, restore }
})