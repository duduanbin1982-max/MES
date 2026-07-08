import { api } from './client'

export function createMaterialsApi() {
  return {
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
    syncKit: (workOrderId: number) => api.post(`/work_orders/${workOrderId}/kit-sync`),
    shortages: (params?: any) => api.get('/shortages', { params }),
    shortageDetail: (id: number) => api.get(`/shortages/${id}`),
    assignShortage: (id: number, data: any) => api.post(`/shortages/${id}/assign`, data),
    followShortage: (id: number, data: any) => api.post(`/shortages/${id}/follow-up`, data),
    closeShortage: (id: number, data: any) => api.post(`/shortages/${id}/close`, data),
    purchaseRequestShortage: (id: number, data: any) => api.post(`/shortages/${id}/purchase-request`, data),
  }
}
