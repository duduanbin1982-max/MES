<template>
  <el-card
    class="subsystem-card"
    :class="{ collapsed, 'drop-active': dropActive, 'drop-same': dropSame }"
    @dragover.prevent="onDragOver"
    @dragenter.prevent="onDragEnter"
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <div class="card-header" @click="collapsed = !collapsed">
      <div class="color-bar" :style="{ background: subsystem.color }"></div>
      <div class="title-block">
        <div class="title">
          <span class="seq">#{{ subsystem.sequence || '?' }}</span>
          <span class="name-zh">{{ subsystem.name_zh }}</span>
          <span class="name-en">{{ subsystem.name_en }}</span>
          <el-tag v-if="isCritical" size="small" type="danger" effect="dark">⭐ 关键路径</el-tag>
        </div>
        <div class="subtitle">
          <span>{{ totalNodes }} 节点</span>
          <span v-if="completedNodes > 0" class="ok">· {{ completedNodes }} 已完成</span>
          <span v-if="blockedNodes > 0" class="bad">· {{ blockedNodes }} 卡住</span>
          <span v-if="readyNodes > 0" class="warn">· {{ readyNodes }} 可开始</span>
        </div>
      </div>
      <div class="progress-ring">
        <el-progress
          type="circle"
          :percentage="progressPct"
          :stroke-width="6"
          :width="48"
          :color="subsystem.color"
        />
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
import { ref, computed } from 'vue'
import { filterTree, decorateNodesWithDerivedAndProgress } from '../utils/nodeStatus.js'
import ProcessTreeNode from './ProcessTreeNode.vue'

const props = defineProps({
  subsystem: { type: Object, required: true },
  criticalSet: { type: Set, default: () => new Set() },
  searchKey: { type: String, default: '' },
  onlyCritical: { type: Boolean, default: false },
  onlyMine: { type: [Number, null], default: null },
  workstationId: { type: [Number, null], default: null },
  currentUserId: { type: [Number, null], default: null }
})
const emit = defineEmits(['start', 'complete', 'cmd', 'node-dropped'])

const collapsed = ref(false)

// 拖放态：dropActive = 当前有 drag 在上方；dropSame = 拖到自己的当前 subsystem（no-op）
const dropActive = ref(false)
const dropSame = ref(false)

function readPayload(e) {
  const raw = e.dataTransfer.getData('application/x-process-node')
    || e.dataTransfer.getData('text/plain')
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}
function onDragOver(e) {
  const p = readPayload(e)
  if (!p) return
  // 从本卡 → 本卡 = no-op (visual: 灰色边框提示不可放下)
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
  // 仅当离开 card 自身（不是进入子元素）才清
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
    return  // 同 subsystem = no-op
  }
  emit('node-dropped', { node_id: p.node_id, node_name: p.node_name, to_subsystem_id: targetSubId, to_subsystem_name: props.subsystem.name_zh || props.subsystem.name })
}

// 装饰：derived_status + 子进度聚合
const decoratedTree = computed(() => {
  const flatById = new Map()  // 当前 subsystem 内每个节点的 self info（用于 derived 状态）
  const flat = (nodes) => {
    for (const n of nodes) {
      flatById.set(n.id, { id: n.id, status: n.status })
      if (n.children) flat(n.children)
    }
  }
  flat(props.subsystem.nodes || [])
  // dependencies 在 subsystem 卡片内暂不传（每个 subsystem 内 nodes 的依赖基本是父子的关系，不跨 subsystem）
  // 如果需要跨 subsystem blocked 判定，由 useProcessTree 提供 deps
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
  margin-bottom: 12px;
  border-left: 4px solid var(--card-border, #409eff);
}
.subsystem-card .card-header {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  padding: 4px 0;
  user-select: none;
}
.color-bar {
  width: 4px;
  height: 36px;
  border-radius: 2px;
  flex-shrink: 0;
}
.title-block { flex: 1; min-width: 0; }
.title {
  font-size: 15px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}
.title .seq {
  color: #909399;
  font-weight: 400;
  font-size: 12px;
}
.title .name-en {
  color: #909399;
  font-size: 12px;
  font-weight: 400;
}
.subtitle {
  color: #909399;
  font-size: 12px;
  margin-top: 4px;
}
.subtitle .ok { color: #67c23a; }
.subtitle .bad { color: #f56c6c; }
.subtitle .warn { color: #e6a23c; }
.collapse-icon {
  color: #c0c4cc;
  font-size: 16px;
}
.card-body { padding-top: 12px; }
.subsystem-card.drop-active {
  outline: 2px dashed #67c23a;
  outline-offset: -2px;
  background: #f0f9eb;
  transition: background 0.1s ease;
}
.subsystem-card.drop-same {
  outline: 2px dashed #c0c4cc;
  outline-offset: -2px;
  cursor: not-allowed;
}
.empty-tip {
  text-align: center;
  color: #c0c4cc;
  padding: 16px;
  font-size: 13px;
}
</style>
