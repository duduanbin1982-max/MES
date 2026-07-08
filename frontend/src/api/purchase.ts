import { api } from './client'

export function createPurchaseApi() {
  return {
    suppliers: () => api.get('/suppliers'),
    purchaseOrders: (params?: any) => api.get('/purchase_orders', { params }),
    purchaseFollowUp: (params?: any) => api.get('/purchase/follow-up', { params }),
    updatePurchaseFollowUp: (id: number, data: any) => api.put(`/purchase/follow-up/${id}`, data),
    createPurchaseOrder: (data: any) => api.post('/purchase_orders', data),
    receivePurchaseOrder: (id: number, data: any) => api.post(`/purchase_orders/${id}/receive`, data),
    keyComponents: () => api.get('/key_components'),
    longLeadtime: () => api.get('/key_components/long_leadtime'),
  }
}
