import { ref } from 'vue'

export function useWakeLock() {
  const active = ref(false)
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator
  let sentinel: any = null
  let wanted = false

  async function acquire() {
    if (!supported) return false
    try {
      sentinel = await (navigator as any).wakeLock.request('screen')
      active.value = true
      sentinel.addEventListener('release', () => { active.value = false; sentinel = null })
      return true
    } catch (_error) {
      active.value = false
      return false
    }
  }

  async function request() {
    wanted = true
    if (document.visibilityState === 'visible') await acquire()
  }

  async function release() {
    wanted = false
    try { await sentinel?.release?.() } catch (_error) { /* ignore */ }
    sentinel = null
    active.value = false
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && wanted) acquire()
    })
  }

  return { active, supported, request, release }
}
