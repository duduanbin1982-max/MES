import { api } from './client'

export function createDeliveryApi() {
  return {
    shopfloorOverview: () => api.get('/shopfloor/overview'),
    deliveryOverview: () => api.get('/delivery/overview'),
    deliveryWorkflow: () => api.get('/delivery/workflow'),
    deliveryProjects: (params?: any) => api.get('/delivery/projects', { params }),
    deliveryProject: (id: number) => api.get(`/delivery/projects/${id}`),
    deliveryProjectRisks: (id: number) => api.get(`/delivery/projects/${id}/risks`),
    deliveryProjectLineage: (id: number) => api.get(`/delivery/projects/${id}/lineage`),
    exceptions: (params?: any) => api.get('/exceptions', { params }),
    exceptionsSummary: () => api.get('/exceptions/summary'),
    exceptionDetail: (id: string) => api.get(`/exceptions/${id}`),
    assignException: (id: string, data: any) => api.post(`/exceptions/${id}/assign`, data),
    addExceptionAction: (id: string, data: any) => api.post(`/exceptions/${id}/action`, data),
    closeException: (id: string, data: any) => api.post(`/exceptions/${id}/close`, data),
    reopenException: (id: string, data?: any) => api.post(`/exceptions/${id}/reopen`, data || {}),
    notifyException: (id: string, data?: any) => api.post(`/exceptions/${id}/notify`, data || {}),
    escalateException: (id: string, data?: any) => api.post(`/exceptions/${id}/escalate`, data || {}),
    escalateDueExceptions: (data?: any) => api.post('/exceptions/escalate-due', data || {}),
    exceptionEscalationRules: () => api.get('/exceptions/escalation-rules/list'),
    mdmOverview: (params?: any) => api.get('/mdm/overview', { params }),
    mdmIssues: (params?: any) => api.get('/mdm/issues', { params }),
    mdmWaivers: (params?: any) => api.get('/mdm/waivers', { params }),
    mdmWaive: (id: string, reason: string) => api.post('/mdm/issues/' + encodeURIComponent(id) + '/waive', { reason }),
    mdmReopen: (id: string) => api.post('/mdm/issues/' + encodeURIComponent(id) + '/reopen'),
    ecoImpact: (id: number) => api.get(`/instance_eco/${id}/impact`),
  }
}
