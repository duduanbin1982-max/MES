// frontend/src/services/processRouteUpgradeApi.js
// 2026-11-07 工艺树升级 API 客户端（路线模板/健康度/排程/版本/ECN/ITP/KPI）
const authToken = () => localStorage.getItem('tbm_access_token') || localStorage.getItem('tbm_token') || ''
const authHeader = (): Record<string, string> => {
  const token = authToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}
const jsonHeaders = (): Record<string, string> => ({ 'Content-Type': 'application/json', ...authHeader() })

async function request(url: string, options: RequestInit = {}) {
  const response = await fetch(url, options)
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const message = body?.message || body?.error || `HTTP ${response.status}`
    const error: any = new Error(message)
    error.status = response.status
    error.body = body
    throw error
  }
  return body
}

const base = (instanceId: number | string) => `/api/process-route/instances/${instanceId}`

export const processRouteUpgradeApi = {
  templates: () => request('/api/process-route/templates', { headers: authHeader() }),
  template: (id: number) => request(`/api/process-route/templates/${id}`, { headers: authHeader() }),
  generateFromTemplate: (instanceId: number, payload: any = {}) => request(`${base(instanceId)}/generate-from-template`, {
    method: 'POST', headers: jsonHeaders(), body: JSON.stringify(payload || {}),
  }),
  health: (instanceId: number) => request(`${base(instanceId)}/health`, { headers: authHeader() }),
  schedulePreview: (instanceId: number, payload: any = {}) => request(`${base(instanceId)}/schedule/preview`, {
    method: 'POST', headers: jsonHeaders(), body: JSON.stringify(payload || {}),
  }),
  scheduleApply: (instanceId: number, payload: any = {}) => request(`${base(instanceId)}/schedule/apply`, {
    method: 'POST', headers: jsonHeaders(), body: JSON.stringify(payload || {}),
  }),
  versions: (instanceId: number) => request(`${base(instanceId)}/versions`, { headers: authHeader() }),
  createVersion: (instanceId: number, payload: any = {}) => request(`${base(instanceId)}/versions`, {
    method: 'POST', headers: jsonHeaders(), body: JSON.stringify(payload || {}),
  }),
  releaseVersion: (versionId: number) => request(`/api/process-route/versions/${versionId}/release`, {
    method: 'POST', headers: jsonHeaders(), body: '{}',
  }),
  changes: (instanceId: number) => request(`${base(instanceId)}/changes`, { headers: authHeader() }),
  createChange: (instanceId: number, payload: any = {}) => request(`${base(instanceId)}/changes`, {
    method: 'POST', headers: jsonHeaders(), body: JSON.stringify(payload || {}),
  }),
  reviewChange: (changeId: number, payload: any = {}) => request(`/api/process-route/changes/${changeId}/review`, {
    method: 'POST', headers: jsonHeaders(), body: JSON.stringify(payload || {}),
  }),
  phases: (instanceId: number) => request(`${base(instanceId)}/phases`, { headers: authHeader() }),
  cost: (instanceId: number) => request(`${base(instanceId)}/cost`, { headers: authHeader() }),
  kpi: (instanceId: number) => request(`${base(instanceId)}/kpi`, { headers: authHeader() }),
  similar: (instanceId: number) => request(`${base(instanceId)}/similar`, { headers: authHeader() }),
}

export const processItpApi = {
  get: (nodeId: number) => request(`/api/process_nodes/${nodeId}/itp`, { headers: authHeader() }),
  seed: (nodeId: number, points: any[] = []) => request(`/api/process_nodes/${nodeId}/itp/seed`, {
    method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ points: points || [] }),
  }),
  check: (pointId: number, status: string, remark = '') => request(`/api/process_itp_points/${pointId}/check`, {
    method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ status, remark }),
  }),
}
