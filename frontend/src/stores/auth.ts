import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '../api'

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('tbm_token') || '')
  const user = ref<any>(JSON.parse(localStorage.getItem('tbm_user') || 'null'))

  const isLoggedIn = computed(() => !!token.value)
  const role = computed(() => user.value?.role || '')

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

  return { token, user, isLoggedIn, role, login, logout, restore }
})
