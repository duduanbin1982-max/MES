// frontend/src/composables/useShellNotifications.ts
import { ElMessage } from 'element-plus'
import { useWebSocket } from './useWebSocket'

export function useShellNotifications() {
  return useWebSocket(['document.*', 'bom.updated', 'inventory.low_stock', 'system.notice'], (payload) => {
    if (payload?.event === 'document.uploaded') ElMessage.info(`新文档上传: ${payload.title || payload.doc_code}`)
    else if (payload?.event === 'document.issued') ElMessage.success(`签发: ${payload.title || payload.doc_code} → ${payload.issued_to}`)
    else if (payload?.event === 'document.revoked') ElMessage.warning(`收回: ${payload.title || payload.doc_code}`)
    else if (payload?.event === 'bom.updated') ElMessage.info(`BOM 更新: ${payload.part_number || payload.id || ''}`)
    else if (payload?.event === 'inventory.low_stock') ElMessage.warning(`库存预警: ${payload.material_code || ''}`)
    else if (payload?.event === 'system.notice') ElMessage.info(payload.msg || '系统通知')
  })
}
