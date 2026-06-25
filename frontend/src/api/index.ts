// frontend/src/api/index.ts - API client (P0-2: 双 token + 自动 refresh)
import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios'
import { ElMessage } from 'element-plus'

const api = axios.create({ baseURL: '/api' })

// P0-2: 双 token 存储
const ACCESS_KEY  = 'tbm_access_token'
const REFRESH_KEY = 'tbm_refresh_token'
const USER_KEY    = 'tbm_user'

// P0-2: 防止多个请求同时触发 refresh
let refreshing: Promise<string | null> | null = null

async function doRefresh(): Promise<string | null> {
  const rt = localStorage.getItem(REFRESH_KEY)
  if (!rt) return null
  try {
    // 用一个干净实例 (不带 auth header)
    const r = await axios.post('/api/auth/refresh', { refresh_token: rt })
    const newAccess = r.data.access_token
    localStorage.setItem(ACCESS_KEY, newAccess)
    return newAccess
  } catch (_e) {
    return null
  }
}

api.interceptors.request.use((config) => {
  // P0-2: 用 access_token 键
  const t = localStorage.getItem(ACCESS_KEY) || localStorage.getItem('tbm_token')
  if (t) config.headers.Authorization = `Bearer ${t}`
  return config
})

api.interceptors.response.use(
  (r) => r.data,
  async (err: AxiosError<any>) => {
    const original = err.config as InternalAxiosRequestConfig & { _retry?: boolean }
    const status = err.response?.status

    // P0-2: 401 自动 refresh (除登录/刷新本身)
    if (status === 401 && !original._retry &&
        !original.url?.includes('/auth/login') &&
        !original.url?.includes('/auth/refresh')) {
      original._retry = true
      // 单一 refresh 共享
      refreshing = refreshing || doRefresh()
      const newAccess = await refreshing
      refreshing = null
      if (newAccess) {
        original.headers!.Authorization = `Bearer ${newAccess}`
        return api.request(original)
      }
      // refresh 失败 → 清空 + 跳登录
      localStorage.removeItem(ACCESS_KEY)
      localStorage.removeItem(REFRESH_KEY)
      localStorage.removeItem(USER_KEY)
      if (location.pathname !== '/login') location.href = '/login'
    } else if (status === 401) {
      // 登录/refresh 本身 401 → 直接清
      localStorage.removeItem(ACCESS_KEY)
      localStorage.removeItem(REFRESH_KEY)
      localStorage.removeItem(USER_KEY)
      if (location.pathname !== '/login') location.href = '/login'
    }

    const msg = err.response?.data?.error || err.message
    if (status !== 401) ElMessage.error(msg)
    return Promise.reject(err)
  }
)

const Api: any = {
  // auth
  login: async (username: string, password: string) => {
    const r: any = await api.post('/auth/login', { username, password })
    // P0-2: 存双 token
    localStorage.setItem(ACCESS_KEY,  r.access_token)
    localStorage.setItem(REFRESH_KEY, r.refresh_token)
    localStorage.setItem(USER_KEY,    JSON.stringify(r.user))
    return r
  },
  me: () => api.get('/auth/me'),
  refresh: () => api.post('/auth/refresh', { refresh_token: localStorage.getItem(REFRESH_KEY) }),
  logout: () => api.post('/auth/logout'),

  // dashboard
  dashboard: () => api.get('/dashboard'),
  dashboardAlerts: () => api.get('/dashboard/alerts'),
  delays: (params?: any) => api.get('/dashboard/delays', { params }),
  delaysSummary: () => api.get('/dashboard/delays/summary'),
  liveStatus: () => api.get('/equipment/live_status'),

  // equipment / instance
  equipmentTypes: () => api.get('/equipment_types'),
  equipmentModels: (type_id?: number) => api.get('/equipment_models', { params: type_id ? { equipment_type_id: type_id } : {} }),
  equipmentSubsystems: (type_id?: number) => api.get('/equipment_subsystems', { params: type_id ? { equipment_type_id: type_id } : {} }),
  instances: (params?: any) => api.get('/equipment_instances', { params }),
  instance: (id: number) => api.get(`/equipment_instances/${id}`),
  instanceDashboard: (id: number) => api.get(`/equipment_instances/${id}/dashboard`),
  instanceGantt: (id: number) => api.get(`/equipment_instances/${id}/gantt`),
  instanceBomTree: (id: number) => api.get(`/equipment_instances/${id}/process_tree`),
  scheduleInstance: (id: number) => api.post(`/equipment_instances/${id}/schedule`),

  // materials
  materials: () => api.get('/materials'),
  inventory: () => api.get('/inventory'),
  inventoryAlerts: () => api.get('/inventory/alerts'),
  materialLots: () => api.get('/material_lots'),
  receiveLot: (data: any) => api.post('/material_lots/receive', data),
  createMovement: (data: any) => api.post('/material_movements', data),
  allocate: (data: any) => api.post('/inventory/allocate', data),
  release: (data: any) => api.post('/inventory/release', data),
  lotTrace: (params?: any) => api.get('/inventory/lot_trace', { params }),
  materialMovement: (id: number) => api.get(`/material_movements/${id}`),
  materialLot: (id: number) => api.get(`/material_lots/${id}`),
  splitLot: (id: number, data: any) => api.post(`/material_lots/${id}/split`, data),
  mergeLot: (id: number, data: any) => api.post(`/material_lots/${id}/merge`, data),
  batchMovements: (movements: any[], atomic = false) => api.post('/material_movements/batch', { movements, atomic }),
  // purchase
  suppliers: () => api.get('/suppliers'),
  purchaseOrders: (params?: any) => api.get('/purchase_orders', { params }),
  createPurchaseOrder: (data: any) => api.post('/purchase_orders', data),
  receivePurchaseOrder: (id: number, data: any) => api.post(`/purchase_orders/${id}/receive`, data),
  keyComponents: () => api.get('/key_components'),
  longLeadtime: () => api.get('/key_components/long_leadtime'),

  // work orders
  workOrders: (params?: any) => api.get('/work_orders', { params }),

  // roles & audit (P0-1 / P1-4)
  roles: () => api.get('/roles'),
  updateRolePermissions: (code: string, permissions: string[]) => api.put(`/roles/${code}/permissions`, { permissions }),
  auditLogs: (params?: any) => api.get('/audit/logs', { params }),

  // settings
  settings: {
    getAll: () => api.get('/settings').then((r: any) => r.items),
    get: (key: string) => api.get(`/settings/${key}`),
    set: (key: string, value: any) => api.put(`/settings/${key}`, { value }),
    testFeishu: (title: string, content: string) => api.post('/settings/test-feishu', { title, content })
  },
  // users
  users: () => api.get('/users'),

  // oee
  oee: (params?: any) => api.get('/equipment/oee', { params }),

  // generic fallback
  get: (url: string, config?: any) => api.get(url, config),
  post: (url: string, data?: any, config?: any) => api.post(url, data, config),
  put: (url: string, data?: any) => api.put(url, data),
  patch: (url: string, data?: any) => api.patch(url, data),
  del: (url: string) => api.delete(url)
}

// 代理 axios 实例属性（auth.ts 用 api.defaults.headers.common[...]）
Api.defaults = api.defaults
Api.interceptors = api.interceptors

export { Api }
export default Api