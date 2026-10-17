<template>
  <div class="ws-panel-container">
    <!-- 悬浮触发按钮 -->
    <div class="ws-trigger" role="button" tabindex="0" :aria-expanded="open" :title="`WebSocket: ${stats.status.value}`" @click="open = !open" @keydown.enter.prevent="open = !open" @keydown.space.prevent="open = !open">
      <span class="ws-dot" :class="dotClass"></span>
      <span class="ws-label">实时</span>
      <span v-if="stats.eventCount.value > 0" class="ws-badge">{{ stats.eventCount.value }}</span>
    </div>

    <!-- 展开面板 -->
    <transition name="ws-slide">
      <div v-if="open" class="ws-panel">
        <div class="ws-panel-header">
          <span><el-icon><Link /></el-icon> 实时事件</span>
          <el-button size="small" text @click="open = false"><el-icon><CloseBold /></el-icon></el-button>
        </div>

        <div class="ws-stats">
          <div class="ws-stat-row">
            <span class="ws-stat-label">状态</span>
            <span :class="['ws-stat-val', `ws-${stats.status.value}`]">{{ statusText }}</span>
          </div>
          <div class="ws-stat-row">
            <span class="ws-stat-label">延迟</span>
            <span class="ws-stat-val">{{ stats.latency.value >= 0 ? stats.latency.value + 'ms' : '—' }}</span>
          </div>
          <div class="ws-stat-row">
            <span class="ws-stat-label">事件数</span>
            <span class="ws-stat-val">{{ stats.eventCount.value }}</span>
          </div>
          <div class="ws-stat-row">
            <span class="ws-stat-label">连接时长</span>
            <span class="ws-stat-val">{{ uptime }}</span>
          </div>
        </div>

        <div class="ws-divider"></div>

        <div class="ws-events">
          <div v-if="stats.recentEvents.value.length === 0" class="ws-empty">暂无事件</div>
          <div v-for="ev in stats.recentEvents.value" :key="ev.id" class="ws-event">
            <span class="ws-event-time">{{ ev.time }}</span>
            <span :class="['ws-event-tag', eventTagClass(ev.event)]">{{ ev.event }}</span>
            <span class="ws-event-payload">{{ formatPayload(ev.payload) }}</span>
          </div>
        </div>

        <div class="ws-panel-footer">
          <el-button size="small" text type="danger" @click="clearEvents">清空记录</el-button>
          <el-button size="small" text @click="reconnect">重连</el-button>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { useWsStats, closeWebSocket } from '../composables/useWebSocket'

const open = ref(false)
const stats = useWsStats()

const dotClass = computed(() => ({
  'ws-open': stats.status.value === 'open',
  'ws-connecting': stats.status.value === 'connecting',
  'ws-closed': stats.status.value === 'closed' || stats.status.value === 'error',
}))

const statusText = computed(() => {
  const map: Record<string, string> = { open: '已连接', connecting: '连接中', closed: '断开', error: '错误' }
  return map[stats.status.value] || stats.status.value
})

const uptime = computed(() => {
  if (stats.connectedAt.value <= 0) return '—'
  const sec = Math.floor((Date.now() - stats.connectedAt.value) / 1000)
  if (sec < 60) return sec + 's'
  if (sec < 3600) return Math.floor(sec / 60) + 'm ' + (sec % 60) + 's'
  return Math.floor(sec / 3600) + 'h ' + Math.floor((sec % 3600) / 60) + 'm'
})

function eventTagClass(event: string) {
  if (event.startsWith('document.')) return 'ws-tag-doc'
  if (event.startsWith('bom.')) return 'ws-tag-bom'
  if (event.startsWith('inventory.')) return 'ws-tag-inv'
  if (event.startsWith('workorder.')) return 'ws-tag-wo'
  if (event.startsWith('system.')) return 'ws-tag-sys'
  return ''
}

function formatPayload(p: any): string {
  if (!p) return ''
  const short = p.doc_code || p.material_code || p.node_name || p.wo_id || p.msg || ''
  const id = p.id || p.node_id || p.material_lot_id || ''
  return short || (id ? '#' + id : JSON.stringify(p).slice(0, 60))
}

function clearEvents() {
  stats.recentEvents.value = []
  stats.eventCount.value = 0
}

function reconnect() {
  closeWebSocket()
  setTimeout(() => location.reload(), 500)
}

// auto-refresh uptime
const timer = setInterval(() => { /* trigger reactivity */ }, 1000)
onUnmounted(() => clearInterval(timer))
</script>

<style scoped>
.ws-panel-container { position: fixed; bottom: 24px; right: 24px; z-index: 3000; }

.ws-trigger {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 20px;
  background: var(--el-color-white); box-shadow: 0 2px 12px rgba(0,0,0,.12);
  cursor: pointer; user-select: none; font-size: 13px;
  transition: box-shadow .2s;
}
.ws-trigger:hover { box-shadow: 0 4px 16px rgba(0,0,0,.18); }

.ws-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.ws-dot.ws-open { background: var(--el-color-success); }
.ws-dot.ws-connecting { background: var(--el-color-warning); animation: ws-pulse 1s infinite; }
.ws-dot.ws-closed { background: var(--el-color-danger); }

.ws-label { color: var(--el-text-color-regular); font-weight: 500; }

.ws-badge {
  background: var(--el-color-primary); color: var(--el-color-white); font-size: 11px;
  border-radius: 10px; padding: 1px 7px; min-width: 18px; text-align: center;
}

.ws-panel {
  position: absolute; bottom: 52px; right: 0;
  width: 360px; max-height: 520px;
  background: var(--el-color-white); border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0,0,0,.15);
  display: flex; flex-direction: column;
  overflow: hidden;
}

.ws-panel-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 16px; border-bottom: 1px solid var(--el-border-color-lighter);
  font-size: 14px; font-weight: 600;
}

.ws-stats { padding: 12px 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.ws-stat-row { display: flex; flex-direction: column; gap: 2px; }
.ws-stat-label { font-size: 11px; color: var(--el-color-info); }
.ws-stat-val { font-size: 13px; font-weight: 500; color: var(--el-text-color-primary); }
.ws-stat-val.ws-open { color: var(--el-color-success); }
.ws-stat-val.ws-connecting { color: var(--el-color-warning); }
.ws-stat-val.ws-closed, .ws-stat-val.ws-error { color: var(--el-color-danger); }

.ws-divider { height: 1px; background: var(--el-border-color-lighter); margin: 0 16px; }

.ws-events {
  flex: 1; overflow-y: auto; padding: 8px 16px;
  max-height: 260px;
}
.ws-empty { text-align: center; color: var(--el-text-color-placeholder); padding: 24px 0; font-size: 13px; }

.ws-event {
  display: flex; align-items: flex-start; gap: 8px; padding: 5px 0;
  border-bottom: 1px solid #f2f3f5; font-size: 12px;
}
.ws-event-time { color: var(--el-color-info); white-space: nowrap; min-width: 52px; }
.ws-event-tag {
  padding: 0 5px; border-radius: 3px; font-size: 11px;
  white-space: nowrap; font-weight: 500; line-height: 18px;
}
.ws-tag-doc { background: var(--el-color-success-light-8); color: var(--el-color-success); }
.ws-tag-bom { background: var(--color-info-soft); color: var(--el-color-primary); }
.ws-tag-inv { background: var(--el-color-warning-light-9); color: var(--el-color-warning); }
.ws-tag-wo { background: var(--color-cta-soft); color: var(--color-purple); }
.ws-tag-sys { background: var(--el-color-danger-light-9); color: var(--el-color-danger); }

.ws-event-payload { color: var(--el-text-color-regular); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.ws-panel-footer {
  display: flex; justify-content: flex-end; gap: 4px;
  padding: 8px 16px; border-top: 1px solid var(--el-border-color-lighter);
}

/* transitions */
.ws-slide-enter-active, .ws-slide-leave-active { transition: all .25s ease; }
.ws-slide-enter-from, .ws-slide-leave-to { opacity: 0; transform: translateY(12px); }

@keyframes ws-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .4; }
}
</style>
