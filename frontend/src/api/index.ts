// frontend/src/api/index.ts - API client
import axios from 'axios'
import { ElMessage } from 'element-plus'

const api = axios.create({ baseURL: '/api' })

api.interceptors.request.use((config) => {
  const t = localStorage.getItem('tbm_token')
  if (t) config.headers.Authorization = `Bearer ${t}`
  return config
})

api.interceptors.response.use(
  (r) => r.data,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('tbm_token')
      localStorage.removeItem('tbm_user')
      if (location.pathname !== '/login') location.href = '/login'
    }
    const msg = err.response?.data?.error || err.message
    if (err.response?.status !== 401) ElMessage.error(msg)
    return Promise.reject(err)
  }
)

const Api: any = {
  // auth
  login: (username: string, password: string) => api.post('/auth/login', { username, password }),
  me: () => api.get('/auth/me'),
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
  keyComponents: () => api.get('/key_components'),
  longLeadtime: () => api.get('/key_components/long_leadtime'),

  // work orders
  workOrders: (params?: any) => api.get('/work_orders', { params }),

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
