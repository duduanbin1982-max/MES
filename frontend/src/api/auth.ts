import { api, ACCESS_KEY, REFRESH_KEY, USER_KEY } from './client'

export function createAuthApi() {
  return {
    login: async (username: string, password: string) => {
      const result: any = await api.post('/auth/login', { username, password })
      localStorage.setItem(ACCESS_KEY, result.access_token)
      localStorage.setItem(REFRESH_KEY, result.refresh_token)
      localStorage.setItem(USER_KEY, JSON.stringify(result.user))
      return result
    },
    me: () => api.get('/auth/me'),
    refresh: () => api.post('/auth/refresh', { refresh_token: localStorage.getItem(REFRESH_KEY) }),
    logout: () => api.post('/auth/logout'),
  }
}
