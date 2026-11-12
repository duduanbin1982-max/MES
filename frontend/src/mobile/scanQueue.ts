export type ScanQueueItem = {
  id: string
  userId: number | null
  kind?: 'scan' | 'work_report_create' | 'work_report_approve' | 'work_report_reject'
  payload: any
  status: 'pending' | 'syncing' | 'failed'
  attempts: number
  createdAt: number
  lastError?: string
}

const DB_NAME = 'tbm_mobile'
const DB_VERSION = 1
const STORE = 'scan_queue'

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('status', 'status')
        store.createIndex('createdAt', 'createdAt')
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export function newScanActionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'scan-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10)
}

export function getDeviceId(): string {
  const key = 'tbm_device_id'
  let value = localStorage.getItem(key)
  if (!value) {
    value = 'dev-' + newScanActionId()
    localStorage.setItem(key, value)
  }
  return value
}

export async function enqueueScanAction(userId: number | null, payload: any, kind: ScanQueueItem['kind'] = 'scan'): Promise<ScanQueueItem> {
  const item: ScanQueueItem = {
    id: newScanActionId(),
    userId: userId || null,
    kind,
    payload,
    status: 'pending',
    attempts: 0,
    createdAt: Date.now(),
  }
  const db = await openDb()
  if (!db) throw new Error('当前浏览器不支持离线队列')
  const tx = db.transaction(STORE, 'readwrite')
  tx.objectStore(STORE).put(item)
  await txDone(tx)
  db.close()
  return item
}

export async function listScanQueue(): Promise<ScanQueueItem[]> {
  const db = await openDb()
  if (!db) return []
  const rows = await new Promise<ScanQueueItem[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const request = tx.objectStore(STORE).getAll()
    request.onsuccess = () => resolve(request.result || [])
    request.onerror = () => reject(request.error)
  })
  db.close()
  return rows.sort((a, b) => a.createdAt - b.createdAt)
}

export async function updateScanQueueItem(id: string, patch: Partial<ScanQueueItem>): Promise<void> {
  const db = await openDb()
  if (!db) return
  const current = await new Promise<ScanQueueItem | undefined>((resolve) => {
    const tx = db.transaction(STORE, 'readonly')
    const request = tx.objectStore(STORE).get(id)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(undefined)
  })
  if (current) {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put({ ...current, ...patch })
    await txDone(tx)
  }
  db.close()
}

export async function removeScanQueueItem(id: string): Promise<void> {
  const db = await openDb()
  if (!db) return
  const tx = db.transaction(STORE, 'readwrite')
  tx.objectStore(STORE).delete(id)
  await txDone(tx)
  db.close()
}

export async function clearScanQueue(status?: ScanQueueItem['status']): Promise<void> {
  const rows = await listScanQueue()
  const db = await openDb()
  if (!db) return
  const tx = db.transaction(STORE, 'readwrite')
  for (const row of rows) {
    if (!status || row.status === status) tx.objectStore(STORE).delete(row.id)
  }
  await txDone(tx)
  db.close()
}
