import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios'
import { ElMessage } from 'element-plus'

export const api = axios.create({ baseURL: '/api' })
export const ACCESS_KEY = 'tbm_access_token'
export const REFRESH_KEY = 'tbm_refresh_token'
export const USER_KEY = 'tbm_user'

let refreshing: Promise<string | null> | null = null

async function doRefresh(): Promise<string | null> {
  const refreshToken = localStorage.getItem(REFRESH_KEY)
  if (!refreshToken) return null
  try {
    const response = await axios.post('/api/auth/refresh', { refresh_token: refreshToken })
    const newAccess = response.data.access_token
    localStorage.setItem(ACCESS_KEY, newAccess)
    return newAccess
  } catch (_error) {
    return null
  }
}

function clearSession() {
  localStorage.removeItem(ACCESS_KEY)
  localStorage.removeItem(REFRESH_KEY)
  localStorage.removeItem(USER_KEY)
  if (location.pathname !== '/login') location.href = '/login'
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(ACCESS_KEY) || localStorage.getItem('tbm_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (response) => response.data,
  async (error: AxiosError<any>) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean }
    const status = error.response?.status

    if (status === 401 && !original._retry &&
        !original.url?.includes('/auth/login') &&
        !original.url?.includes('/auth/refresh')) {
      original._retry = true
      refreshing = refreshing || doRefresh()
      const newAccess = await refreshing
      refreshing = null
      if (newAccess) {
        original.headers!.Authorization = `Bearer ${newAccess}`
        return api.request(original)
      }
      clearSession()
    } else if (status === 401) {
      clearSession()
    }

    const message = error.response?.data?.error || error.response?.data?.message || error.message
    if (status !== 401) ElMessage.error(message)
    return Promise.reject(error)
  }
)
