// frontend/src/composables/useWebSocket.ts
// P0-4 WebSocket 客户端 composable
//   - 自动重连 (指数退避, 1s -> 2s -> 4s -> max 30s)
//   - 自动 JWT 鉴权
//   - 事件订阅: on(event, callback) 返回 unsubscribe
//   - 跨组件共享单例
//   - 延迟检测 (ping/pong)
//   - 事件历史 (最近 50 条)
// Author: 三狗子 | Date: 2026-06-25

import { ref, onUnmounted, Ref } from "vue"

export type WsEventHandler = (payload: any) => void

export interface WsEventRecord {
  id: number
  ts: number
  time: string
  event: string
  payload: any
}

interface WsClient {
  ws: WebSocket | null
  status: Ref<string>
  handlers: Map<string, Set<WsEventHandler>>
  reconnectTimer: any
  reconnectDelay: number
  explicitClose: boolean
  url: string
  // stats
  clientId: Ref<string>
  latency: Ref<number>
  eventCount: Ref<number>
  recentEvents: Ref<WsEventRecord[]>
  connectedAt: Ref<number>
  pingTimer: any
}

let _instance: WsClient | null = null
const MAX_EVENTS = 50
let _seq = 0

function getToken(): string | null {
  return localStorage.getItem("tbm_access_token") || localStorage.getItem("tbm_token")
}

function buildUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:"
  return `${proto}//${location.host}/ws`
}

function createClient(): WsClient {
  const token = getToken()
  if (!token) throw new Error("useWebSocket: 未登录 (无 access_token)")
  return {
    ws: null,
    status: ref("closed"),
    handlers: new Map(),
    reconnectTimer: null,
    reconnectDelay: 1000,
    explicitClose: false,
    url: `${buildUrl()}?token=${encodeURIComponent(token)}`,
    clientId: ref(""),
    latency: ref(-1),
    eventCount: ref(0),
    recentEvents: ref([]),
    connectedAt: ref(0),
    pingTimer: null,
  }
}

function pushEvent(c: WsClient, event: string, payload: any) {
  _seq++
  c.eventCount.value++
  const rec: WsEventRecord = {
    id: _seq,
    ts: Date.now(),
    time: new Date().toLocaleTimeString("zh-CN"),
    event,
    payload,
  }
  const arr = [rec, ...c.recentEvents.value].slice(0, MAX_EVENTS)
  c.recentEvents.value = arr
}

function invokeHandler(handler: WsEventHandler, payload: any, event: string) {
  try {
    handler(payload)
  } catch (error) {
    /* 2026-10-17: 移除前端调试日志（前端统一用 ElMessage 提示） */
  }
}

function startPing(c: WsClient) {
  if (c.pingTimer) clearInterval(c.pingTimer)
  c.pingTimer = setInterval(() => {
    if (!c.ws || c.ws.readyState !== WebSocket.OPEN) return
    const start = Date.now()
    c.ws.send(JSON.stringify({ type: "ping" }))
    const onMsg = (e: MessageEvent) => {
      try {
        const m = JSON.parse(e.data)
        if (m.type === "pong") {
          c.latency.value = Date.now() - start
          c.ws?.removeEventListener("message", onMsg)
        }
      } catch (_error) {
        return
      }
    }
    c.ws?.addEventListener("message", onMsg)
  }, 15000)
}

function connect(c: WsClient) {
  if (c.ws && (c.ws.readyState === WebSocket.OPEN || c.ws.readyState === WebSocket.CONNECTING)) return
  c.status.value = "connecting"
  try { c.ws = new WebSocket(c.url) } catch (_e) { c.status.value = "error"; scheduleReconnect(c); return }
  c.ws.onopen = () => {
    c.status.value = "open"
    c.reconnectDelay = 1000
    c.connectedAt.value = Date.now()
    startPing(c)
  }
  c.ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data)
      if (msg.type === "welcome") {
        c.clientId.value = msg.clientId || ""
      } else if (msg.type === "pong") {
        // handled by ping listener
      } else if (msg.type === "event") {
        pushEvent(c, msg.event, msg.payload)
        const set = c.handlers.get(msg.event)
        if (set) for (const handler of set) invokeHandler(handler, msg.payload, msg.event)
        const prefix = msg.event.split(".").slice(0, -1).join(".") + ".*"
        const set2 = c.handlers.get(prefix)
        if (set2) for (const handler of set2) invokeHandler(handler, msg.payload, prefix)
        const setAll = c.handlers.get("*")
        if (setAll) for (const handler of setAll) invokeHandler(handler, { event: msg.event, payload: msg.payload }, "*")
      }
    } catch (error) {
      /* 2026-10-17: 移除前端调试日志（前端统一用 ElMessage 提示） */
    }
  }
  c.ws.onerror = () => { c.status.value = "error" }
  c.ws.onclose = () => {
    c.status.value = "closed"
    if (c.pingTimer) { clearInterval(c.pingTimer); c.pingTimer = null }
    if (!c.explicitClose) scheduleReconnect(c)
  }
}

function scheduleReconnect(c: WsClient) {
  if (c.reconnectTimer) return
  c.reconnectTimer = setTimeout(() => {
    c.reconnectTimer = null
    const tok = getToken()
    if (tok) c.url = `${buildUrl()}?token=${encodeURIComponent(tok)}`
    c.reconnectDelay = Math.min(c.reconnectDelay * 2, 30000)
    connect(c)
  }, c.reconnectDelay)
}

function ensureClient(): WsClient {
  if (!_instance) {
    _instance = createClient()
    connect(_instance)
  }
  return _instance
}

export function useWebSocket(events: string | string[], handler: WsEventHandler) {
  const c = ensureClient()
  const eventList = Array.isArray(events) ? events : [events]
  for (const ev of eventList) {
    if (!c.handlers.has(ev)) c.handlers.set(ev, new Set())
    c.handlers.get(ev)!.add(handler)
  }
  const off = () => {
    for (const ev of eventList) c.handlers.get(ev)?.delete(handler)
  }
  onUnmounted(off)
  return { status: c.status, clientId: c.clientId, latency: c.latency, eventCount: c.eventCount, recentEvents: c.recentEvents, connectedAt: c.connectedAt, off }
}

export function useWsStats() {
  const c = ensureClient()
  return { status: c.status, clientId: c.clientId, latency: c.latency, eventCount: c.eventCount, recentEvents: c.recentEvents, connectedAt: c.connectedAt }
}

export function closeWebSocket() {
  if (!_instance) return
  _instance.explicitClose = true
  if (_instance.reconnectTimer) { clearTimeout(_instance.reconnectTimer); _instance.reconnectTimer = null }
  if (_instance.pingTimer) { clearInterval(_instance.pingTimer); _instance.pingTimer = null }
  _instance.ws?.close()
  _instance = null
}
