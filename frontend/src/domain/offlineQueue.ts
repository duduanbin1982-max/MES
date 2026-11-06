// frontend/src/domain/offlineQueue.ts
// 2026-11-06（车间工作台审计 P3）：断网/服务异常时的离线待补报队列（纯函数，便于单测）

export type OfflineActionType = 'scan' | 'work_report' | 'andon'

export interface OfflineAction {
  id: string
  type: OfflineActionType
  payload: Record<string, unknown>
  createdAt: string
  retries: number
}

export const OFFLINE_QUEUE_LIMIT = 200
export const OFFLINE_MAX_RETRIES = 5

export function createAction(
  type: OfflineActionType,
  payload: Record<string, unknown>,
  now: number = Date.now(),
  idFactory: () => string = () => `${type}-${now}-${Math.random().toString(36).slice(2, 8)}`,
): OfflineAction {
  return {
    id: idFactory(),
    type,
    payload,
    createdAt: new Date(now).toISOString(),
    retries: 0,
  }
}

export function enqueue(queue: OfflineAction[], action: OfflineAction): OfflineAction[] {
  const next = [...queue, action]
  return next.length > OFFLINE_QUEUE_LIMIT ? next.slice(next.length - OFFLINE_QUEUE_LIMIT) : next
}

export function dequeue(queue: OfflineAction[], id: string): OfflineAction[] {
  return queue.filter((item) => item.id !== id)
}

export function incrementRetry(queue: OfflineAction[], id: string, maxRetries: number = OFFLINE_MAX_RETRIES): OfflineAction[] {
  return queue
    .filter((item) => {
      if (item.id !== id) return true
      return item.retries + 1 < maxRetries
    })
    .map((item) => (item.id === id ? { ...item, retries: item.retries + 1 } : item))
}

export function nextBatch(queue: OfflineAction[], limit: number = 5): OfflineAction[] {
  return queue.slice(0, Math.max(1, limit))
}

export function shouldQueueRequest(status: number | undefined, isNetworkError: boolean): boolean {
  if (isNetworkError) return true
  if (status === undefined || status === null || status === 0) return true
  return status === 408 || status === 425 || status === 429 || status >= 500
}

export function parseStoredQueue(raw: string | null): OfflineAction[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item) =>
      item && typeof item.id === 'string' && ['scan', 'work_report', 'andon'].includes(item.type) && typeof item.payload === 'object' && item.payload !== null,
    ).map((item) => ({
      id: String(item.id),
      type: item.type as OfflineActionType,
      payload: item.payload as Record<string, unknown>,
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date(0).toISOString(),
      retries: Number.isInteger(item.retries) ? item.retries : 0,
    }))
  } catch {
    return []
  }
}

export function serializeQueue(queue: OfflineAction[]): string {
  return JSON.stringify(queue)
}

export function pendingCount(queue: OfflineAction[]): number {
  return queue.length
}
