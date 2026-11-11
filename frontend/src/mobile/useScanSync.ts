import { reactive } from 'vue'
import { Api } from '../api'
import { useAuthStore } from '../stores/auth'
import { getDeviceId, listScanQueue, updateScanQueueItem, removeScanQueueItem, enqueueScanAction, type ScanQueueItem } from '../mobile/scanQueue'
import { addMobileMessage, showMobileNotification } from './notifications'

export const scanSyncState = reactive({
  pending: 0,
  failed: 0,
  syncing: false,
  lastSyncedAt: null as string | null,
  lastError: '',
  failedItems: [] as ScanQueueItem[],
})

let autoStarted = false
let timer: any = null

function changed() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('scan-queue-changed'))
}

async function refreshState() {
  try {
    const rows = await listScanQueue()
    scanSyncState.pending = rows.filter((row) => row.status === 'pending' || row.status === 'syncing').length
    scanSyncState.failed = rows.filter((row) => row.status === 'failed').length
    scanSyncState.failedItems = rows.filter((row) => row.status === 'failed')
  } catch (_error) {
    scanSyncState.pending = 0
    scanSyncState.failed = 0
  }
  changed()
}

export async function enqueueScan(payload: any): Promise<ScanQueueItem> {
  const auth = useAuthStore()
  const userId = Number(auth.user?.id || auth.user?.uid || 0) || null
  const item = await enqueueScanAction(userId, payload)
  addMobileMessage('info', '扫码动作已离线暂存', `${payload?.code || ''} · ${payload?.action || ''}，联网后自动补传`)
  await refreshState()
  return item
}

export async function syncScanQueue(): Promise<{ synced: number; failed: number; remaining: number }> {
  const auth = useAuthStore()
  if (scanSyncState.syncing || (typeof navigator !== 'undefined' && !navigator.onLine)) {
    return { synced: 0, failed: 0, remaining: scanSyncState.pending }
  }
  const userId = Number(auth.user?.id || auth.user?.uid || 0) || null
  scanSyncState.syncing = true
  scanSyncState.lastError = ''
  let synced = 0
  let failed = 0
  try {
    const rows = (await listScanQueue()).filter((row) => row.status === 'pending')
    for (const item of rows) {
      if (item.userId && userId && Number(item.userId) !== Number(userId)) {
        await updateScanQueueItem(item.id, { status: 'failed', lastError: '登录用户已变化，不能代其他用户补传' })
        failed += 1
        continue
      }
      await updateScanQueueItem(item.id, { status: 'syncing', attempts: item.attempts + 1 })
      await refreshState()
      try {
        await Api.post('/scan/execute', item.payload, {
          headers: { 'Idempotency-Key': item.id, 'X-Device-Id': getDeviceId() },
        })
        await removeScanQueueItem(item.id)
        synced += 1
        scanSyncState.lastSyncedAt = new Date().toISOString()
      } catch (error: any) {
        const status = Number(error?.response?.status || 0)
        const message = error?.response?.data?.error || error?.response?.data?.message || error?.message || String(error)
        const permanent = status >= 400 && status < 500
        await updateScanQueueItem(item.id, { status: permanent ? 'failed' : 'pending', lastError: message })
        failed += 1
      }
      await refreshState()
    }
  } catch (error: any) {
    scanSyncState.lastError = error?.message || String(error)
  } finally {
    scanSyncState.syncing = false
    await refreshState()
  }
  const remaining = scanSyncState.pending
  if (synced || failed) {
    addMobileMessage(failed ? 'failed' : 'sync', failed ? '扫码补传存在失败' : '扫码补传完成', `成功 ${synced} 条，失败 ${failed} 条，待同步 ${remaining} 条`)
    showMobileNotification(failed ? '扫码补传存在失败' : '扫码补传完成', `成功 ${synced} 条，失败 ${failed} 条`)
    window.dispatchEvent(new CustomEvent('scan-sync-result', { detail: { synced, failed, remaining } }))
  }
  return { synced, failed, remaining }
}

export async function retryFailedScanActions(): Promise<void> {
  const rows = await listScanQueue()
  for (const row of rows) {
    if (row.status === 'failed') await updateScanQueueItem(row.id, { status: 'pending', lastError: '' })
  }
  await refreshState()
  await syncScanQueue()
}

export async function clearFailedScanActions(): Promise<void> {
  const rows = await listScanQueue()
  for (const row of rows) {
    if (row.status === 'failed') {
      await removeScanQueueItem(row.id)
    }
  }
  await refreshState()
}

export function startScanSync(): void {
  if (autoStarted || typeof window === 'undefined') return
  autoStarted = true
  refreshState()
  syncScanQueue()
  window.addEventListener('online', () => { syncScanQueue() })
  timer = setInterval(() => { if (navigator.onLine) syncScanQueue() }, 30000)
}

export function stopScanSync(): void {
  if (timer) { clearInterval(timer); timer = null }
  autoStarted = false
}
