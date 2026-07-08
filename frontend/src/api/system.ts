import { api } from './client'

export function createSystemApi() {
  return {
    roles: () => api.get('/roles'),
    updateRolePermissions: (code: string, permissions: string[]) => api.put(`/roles/${code}/permissions`, { permissions }),
    auditLogs: (params?: any) => api.get('/audit/logs', { params }),
    users: () => api.get('/users'),
    settings: {
      getAll: () => api.get('/settings').then((result: any) => result.items),
      get: (key: string) => api.get(`/settings/${key}`),
      set: (key: string, value: any) => api.put(`/settings/${key}`, { value }),
      testFeishu: (title: string, content: string) => api.post('/settings/test-feishu', { title, content })
    },
  }
}
