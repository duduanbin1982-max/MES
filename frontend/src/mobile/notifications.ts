export type MobileMessage = { id: string; type: 'sync' | 'failed' | 'info'; title: string; body: string; at: number }

const KEY = 'tbm_mobile_messages'

export function listMobileMessages(): MobileMessage[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
}

export function addMobileMessage(type: MobileMessage['type'], title: string, body: string): MobileMessage {
  const item: MobileMessage = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 8), type, title, body, at: Date.now() }
  const rows = [item, ...listMobileMessages()].slice(0, 100)
  localStorage.setItem(KEY, JSON.stringify(rows))
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('mobile-messages-changed'))
  return item
}

export function clearMobileMessages(): void {
  localStorage.removeItem(KEY)
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('mobile-messages-changed'))
}

export function notificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function notificationPermission(): string {
  return notificationSupported() ? Notification.permission : 'unsupported'
}

export async function requestNotificationPermission(): Promise<string> {
  if (!notificationSupported()) return 'unsupported'
  return Notification.requestPermission()
}

export async function showMobileNotification(title: string, body: string): Promise<void> {
  if (!notificationSupported() || Notification.permission !== 'granted') return
  try {
    const registration = await navigator.serviceWorker?.getRegistration()
    if (registration?.showNotification) {
      await registration.showNotification(title, { body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png' })
      return
    }
    new Notification(title, { body, icon: '/icons/icon-192.png' })
  } catch (_error) { /* 通知失败不影响业务 */ }
}
