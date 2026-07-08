import { api } from './client'

export function createEquipmentApi() {
  return {
    dashboard: () => api.get('/dashboard'),
    dashboardAlerts: () => api.get('/dashboard/alerts'),
    delays: (params?: any) => api.get('/dashboard/delays', { params }),
    delaysSummary: () => api.get('/dashboard/delays/summary'),
    liveStatus: () => api.get('/equipment/live_status'),
    equipmentTypes: () => api.get('/equipment_types'),
    equipmentModels: (type_id?: number) => api.get('/equipment_models', { params: type_id ? { equipment_type_id: type_id } : {} }),
    equipmentSubsystems: (type_id?: number) => api.get('/equipment_subsystems', { params: type_id ? { equipment_type_id: type_id } : {} }),
    instances: (params?: any) => api.get('/equipment_instances', { params }),
    instance: (id: number) => api.get(`/equipment_instances/${id}`),
    instanceDashboard: (id: number) => api.get(`/equipment_instances/${id}/dashboard`),
    instanceOverview: (id: number) => api.get(`/equipment_instances/${id}/overview`),
    instanceCodePreview: (params?: any) => api.get('/equipment_instances/code-preview', { params }),
    instanceLifecycleOptions: () => api.get('/equipment_instances/lifecycle-options'),
    updateInstanceLifecycle: (id: number, data: any) => api.post(`/equipment_instances/${id}/lifecycle`, data),
    freezeInstance: (id: number, data?: any) => api.post(`/equipment_instances/${id}/freeze`, data || {}),
    archiveInstance: (id: number, data?: any) => api.post(`/equipment_instances/${id}/archive`, data || {}),
    instanceGantt: (id: number) => api.get(`/equipment_instances/${id}/gantt`),
    instanceBomTree: (id: number) => api.get(`/equipment_instances/${id}/process_tree`),
    scheduleInstance: (id: number) => api.post(`/equipment_instances/${id}/schedule`),
    workOrders: (params?: any) => api.get('/work_orders', { params }),
    workstations: () => api.get('/workstations'),
    oee: (params?: any) => api.get('/equipment/oee', { params }),
  }
}
