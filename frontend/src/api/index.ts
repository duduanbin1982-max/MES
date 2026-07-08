// frontend/src/api/index.ts - compatibility API facade.
import { api } from './client'
import { createAuthApi } from './auth'
import { createDeliveryApi } from './delivery'
import { createDocumentsApi } from './documents'
import { createEquipmentApi } from './equipment'
import { createMaterialsApi } from './materials'
import { createPurchaseApi } from './purchase'
import { createSystemApi } from './system'

const Api: any = {
  ...createAuthApi(),
  ...createDeliveryApi(),
  ...createEquipmentApi(),
  ...createMaterialsApi(),
  ...createPurchaseApi(),
  ...createDocumentsApi(),
  ...createSystemApi(),

  get: (url: string, config?: any) => api.get(url, config),
  post: (url: string, data?: any, config?: any) => api.post(url, data, config),
  put: (url: string, data?: any) => api.put(url, data),
  patch: (url: string, data?: any) => api.patch(url, data),
  del: (url: string) => api.delete(url),
  delete: (url: string) => api.delete(url)
}

Api.defaults = api.defaults
Api.interceptors = api.interceptors

export { Api }
export default Api
