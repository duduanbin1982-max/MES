/* TBM-MES mobile service worker: app shell + 最近工单缓存 */
const SHELL_CACHE = 'tbm-shell-v1'
const DATA_CACHE = 'tbm-workorders-v1'
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((key) => key !== SHELL_CACHE && key !== DATA_CACHE).map((key) => caches.delete(key)))
    await self.clients.claim()
  })())
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
  if (event.data === 'CLEAR_DATA_CACHE') event.waitUntil(caches.delete(DATA_CACHE))
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request)
        const cache = await caches.open(SHELL_CACHE)
        cache.put('/index.html', response.clone())
        return response
      } catch {
        return (await caches.match('/index.html')) || (await caches.match('/')) || Response.error()
      }
    })())
    return
  }

  if (url.pathname === '/api/work_orders') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request)
        if (response.ok) {
          const cache = await caches.open(DATA_CACHE)
          cache.put(request, response.clone())
        }
        return response
      } catch {
        return (await caches.match(request)) || Response.error()
      }
    })())
    return
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest') {
    event.respondWith((async () => {
      const cached = await caches.match(request)
      const network = fetch(request).then(async (response) => {
        if (response.ok) {
          const cache = await caches.open(SHELL_CACHE)
          cache.put(request, response.clone())
        }
        return response
      }).catch(() => cached)
      return cached || network
    })())
  }
})


self.addEventListener('push', (event) => {
  let data = { title: 'TBM-MES', body: '您有一条新的移动端消息' }
  try { if (event.data) data = { ...data, ...event.data.json() } } catch { /* text payload */ }
  event.waitUntil(self.registration.showNotification(data.title || 'TBM-MES', {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.url || '/mobile-center' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/mobile-center'
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      if ('focus' in client) { client.navigate(url); return client.focus() }
    }
    return self.clients.openWindow(url)
  }))
})
