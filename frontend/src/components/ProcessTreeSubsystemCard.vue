<template>
  <el-card
    class="subsystem-card"
    :class="{ collapsed, 'drop-active': dropActive, 'drop-same': dropSame }"
    :data-subsystem-id="subsystemDomId"
    :style="{ '--subsystem-color': subsystem.color || 'var(--color-primary)' }"
    @dragover.prevent="onDragOver"
    @dragenter.prevent="onDragEnter"
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <div class="card-header" role="button" tabindex="0" :aria-expanded="!collapsed" @click="collapsed = !collapsed" @keydown.enter.prevent="collapsed = !collapsed" @keydown.space.prevent="collapsed = !collapsed">
      <div class="color-bar"></div>
      <div class="title-block">
        <div class="title">
          <span class="seq">#{{ subsystem.sequence ?? '-' }}</span>
          <span class="name-zh">{{ subsystem.name_zh }}</span>
          <span class="name-en">{{ subsystem.name_en }}</span>
          <el-tag v-if="isCritical" size="small" type="danger" effect="plain">关键路径</el-tag>
        </div>
        <div class="subtitle">
          <span>{{ totalNodes }} 节点</span>
          <span v-if="completedNodes > 0" class="ok">{{ completedNodes }} 已完成</span>
          <span v-if="blockedNodes > 0" class="bad">{{ blockedNodes }} 卡住</span>
          <span v-if="readyNodes > 0" class="warn">{{ readyNodes }} 可开始</span>
        </div>
      </div>
      <div class="progress-ring">
        <el-progress type="circle" :percentage="progressPct" :stroke-width="6" :width="50" :color="subsystem.color" />
      </div>
      <div class="collapse-icon">
        <el-icon><component :is="collapsed ? 'ArrowDown' : 'ArrowUp'" /></el-icon>
      </div>
    </div>

    <div v-show="!collapsed" class="card-body">
      <div v-if="!filteredTree.length" class="empty-tip">无匹配节点</div>
      <el-tree
        v-else
        :data="filteredTree"
        :props="{ label: 'label', children: 'children' }"
        node-key="id"
        :default-expand-all="!collapsed"
        :expand-on-click-node="false"
        empty-text="无节点"
      >
        <template #default="{ node, data }">
          <ProcessTreeNode :data="data" :node="node" @start="$emit('start', $event)" @complete="$emit('complete', $event)" @cmd="(c, d) => $emit('cmd', c, d)" />
        </template>
      </el-tree>
    </div>
  </el-card>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { filterTree, decorateNodesWithDerivedAndProgress } from '../utils/nodeStatus.js'
import ProcessTreeNode from './ProcessTreeNode.vue'

const props = defineProps({
  subsystem: { type: Object, required: true },
  criticalSet: { type: Set, default: () => new Set() },
  searchKey: { type: String, default: '' },
  onlyCritical: { type: Boolean, default: false },
  onlyMine: { type: Boolean, default: false },
  workstationId: { type: [Number, null], default: null },
  currentUserId: { type: [Number, null], default: null },
  forceCollapsed: { type: Boolean, default: false }
})
const emit = defineEmits(['start', 'complete', 'cmd', 'node-dropped'])

const collapsed = ref(props.forceCollapsed)
watch(() => props.forceCollapsed, (value) => { collapsed.value = value })

const dropActive = ref(false)
const dropSame = ref(false)

const subsystemDomId = computed(() => props.subsystem.id == null ? 'uncategorized' : String(props.subsystem.id))

function readPayload(e) {
  const raw = e.dataTransfer.getData('application/x-process-node')
    || e.dataTransfer.getData('text/plain')
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}
function onDragOver(e) {
  const p = readPayload(e)
  if (!p) return
  const targetSubId = props.subsystem.id == null ? null : props.subsystem.id
  dropSame.value = p.from_subsystem_id === targetSubId
  e.dataTransfer.dropEffect = dropSame.value ? 'none' : 'move'
  dropActive.value = !dropSame.value
}
function onDragEnter(e) {
  const p = readPayload(e)
  if (!p) return
  const targetSubId = props.subsystem.id == null ? null : props.subsystem.id
  dropSame.value = p.from_subsystem_id === targetSubId
  dropActive.value = !dropSame.value
}
function onDragLeave(e) {
  if (e.currentTarget.contains(e.relatedTarget)) return
  dropActive.value = false
  dropSame.value = false
}
function onDrop(e) {
  dropActive.value = false
  const p = readPayload(e)
  if (!p) return
  const targetSubId = props.subsystem.id == null ? null : props.subsystem.id
  if (p.from_subsystem_id === targetSubId) {
    dropSame.value = false
    return
  }
  emit('node-dropped', { node_id: p.node_id, node_name: p.node_name, to_subsystem_id: targetSubId, to_subsystem_name: props.subsystem.name_zh || props.subsystem.name })
}

const decoratedTree = computed(() => {
  const flatById = new Map()
  const flat = (nodes) => {
    for (const n of nodes) {
      flatById.set(n.id, { id: n.id, status: n.status })
      if (n.children) flat(n.children)
    }
  }
  flat(props.subsystem.nodes || [])
  return decorateNodesWithDerivedAndProgress(props.subsystem.nodes || [], [], flatById)
})

const filteredTree = computed(() => filterTree(decoratedTree.value, {
  searchKey: props.searchKey,
  onlyCritical: props.onlyCritical,
  onlyMine: props.onlyMine ? props.currentUserId : null,
  workstationId: props.workstationId,
  criticalSet: props.criticalSet
}))

const isCritical = computed(() => (props.subsystem.critical_count || 0) > 0)
const totalNodes = computed(() => props.subsystem.total || 0)
const completedNodes = computed(() => props.subsystem.completed || 0)
const blockedNodes = computed(() => props.subsystem.by_status?.blocked || 0)
const readyNodes = computed(() => props.subsystem.by_status?.ready || 0)
const progressPct = computed(() => props.subsystem.progress_pct || 0)
</script>

<style scoped>
.subsystem-card {
  margin-bottom: var(--space-md);
  border: 1px solid var(--color-border);
  border-left: 4px solid var(--subsystem-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast), background var(--transition-fast);
}
.subsystem-card:hover { box-shadow: var(--shadow-sm); }
.card-header {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  cursor: pointer;
  padding: 2px 0;
  user-select: none;
}
.color-bar {
  width: 5px;
  height: 42px;
  border-radius: 999px;
  flex-shrink: 0;
  background: var(--subsystem-color);
}
.title-block { flex: 1; min-width: 0; }
.title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-sm);
  color: var(--color-text);
  font-size: 15px;
  font-weight: 700;
}
.seq {
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 600;
}
.name-en {
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 500;
}
.subtitle {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
  margin-top: 5px;
  color: var(--color-text-secondary);
  font-size: 12px;
}
.subtitle .ok { color: var(--color-success); }
.subtitle .bad { color: var(--color-danger); }
.subtitle .warn { color: var(--color-warning); }
.collapse-icon {
  color: var(--color-text-secondary);
  font-size: 16px;
}
.card-body {
  padding-top: var(--space-md);
  border-top: 1px solid var(--color-border);
  margin-top: var(--space-md);
}
.subsystem-card.drop-active {
  outline: 2px dashed var(--color-success);
  outline-offset: -2px;
  background: rgba(67, 133, 107, 0.08);
}
.subsystem-card.drop-same {
  outline: 2px dashed var(--color-text-tertiary);
  outline-offset: -2px;
  cursor: not-allowed;
}
.empty-tip {
  text-align: center;
  color: var(--color-text-secondary);
  padding: var(--space-md);
  font-size: 13px;
}
@media (max-width: 640px) {
  .progress-ring { display: none; }
  .card-header { align-items: flex-start; }
}
</style>
