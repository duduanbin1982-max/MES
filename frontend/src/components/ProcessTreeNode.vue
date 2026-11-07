<template>
  <div
    class="node-row"
    :class="['level-' + levelClass, { 'is-critical': data.is_critical, 'is-leaf': isLeaf, 'is-dragging': isDragging }]"
    :data-node-id="data.id"
    :draggable="true"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
  >
    <span class="type-bar" :style="{ background: typeColor }"></span>
    <el-tag v-if="data.is_critical" type="danger" size="small" effect="plain" class="ml-1">关键</el-tag>
    <el-tag :type="statusTagType(effectiveStatus)" size="small" effect="plain" class="status-tag">
      {{ statusLabel(effectiveStatus) }}
    </el-tag>
    <span class="node-title">
      <span class="material-name">{{ data.material_name || data.notes || data.operation_name }}</span>
      <span class="op-name">{{ data.operation_name }}</span>
    </span>
    <span v-if="data.bom_is_key" class="key-marker">关键件</span>
    <span class="meta-pill">数量 {{ data.bom_quantity || 1 }}</span>
    <span class="meta-pill">{{ data.estimated_hours || 0 }}h</span>
    <span v-if="data.assigned_to" class="assignee"><el-icon><UserFilled /></el-icon>#{{ data.assigned_to }}</span>
    <span v-if="hasChildren && data.progress && data.progress.total > 1" class="child-progress" :title="progressTooltip">
      子进度 {{ data.progress.completed }}/{{ data.progress.total }}
    </span>
    <el-button v-if="effectiveStatus === 'ready'" size="small" type="primary" class="node-action" @click.stop="$emit('start', data)">开始</el-button>
    <el-button v-else-if="effectiveStatus === 'in_progress'" size="small" type="success" class="node-action" @click.stop="$emit('complete', data)">完成</el-button>
    <el-dropdown @command="(c) => $emit('cmd', c, data)" trigger="click">
      <el-button size="small" text class="more-button" @click.stop>更多</el-button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item command="edit"><el-icon><EditPen /></el-icon> 编辑</el-dropdown-item>
          <el-dropdown-item command="assign"><el-icon><UserFilled /></el-icon> 分配</el-dropdown-item>
          <el-dropdown-item command="addchild"><el-icon><Plus /></el-icon> 加子节点</el-dropdown-item>
          <el-dropdown-item command="hours"><el-icon><Clock /></el-icon> 工时定额</el-dropdown-item>
          <el-dropdown-item command="itp"><el-icon><CircleCheck /></el-icon> 检验点(ITP)</el-dropdown-item>
          <el-dropdown-item command="adddep"><el-icon><Link /></el-icon> 加依赖</el-dropdown-item>
          <el-dropdown-item command="delete" divided><span class="danger-text"><el-icon><Delete /></el-icon> 删除</span></el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { TYPE_COLOR } from '../utils/nodeStatus.js'

const props = defineProps({
  data: { type: Object, required: true },
  node: Object
})
const emit = defineEmits(['start', 'complete', 'cmd', 'dragstart'])

const effectiveStatus = computed(() => props.data.derived_status || props.data.status || 'pending')
const isDragging = ref(false)

function onDragStart(e) {
  const payload = JSON.stringify({
    node_id: props.data.id,
    from_subsystem_id: props.data.subsystem_id == null ? null : props.data.subsystem_id,
    node_name: props.data.operation_name || props.data.material_name || `#${props.data.id}`,
  })
  e.dataTransfer.setData('application/x-process-node', payload)
  e.dataTransfer.setData('text/plain', payload)
  e.dataTransfer.effectAllowed = 'move'
  isDragging.value = true
  emit('dragstart', props.data)
}
function onDragEnd() { isDragging.value = false }

const typeColor = computed(() => TYPE_COLOR[props.data.operation_type] || TYPE_COLOR.default)
const isLeaf = computed(() => !props.data.children || props.data.children.length === 0)
const hasChildren = computed(() => !isLeaf.value)
const levelClass = computed(() => {
  const lv = props.node?.level || 1
  if (lv === 1) return 1
  if (lv === 2) return 2
  return 3
})

const statusLabel = (s) => ({ pending: '待开始', ready: '可开始', in_progress: '进行中', completed: '已完成', blocked: '卡住', paused: '已暂停', skipped: '跳过' }[s] || s)
const statusTagType = (s) => ({ pending: 'info', ready: 'primary', in_progress: 'success', completed: 'success', blocked: 'danger', paused: 'warning', skipped: 'info' }[s] || 'info')
const progressTooltip = computed(() => {
  const p = props.data.progress
  if (!p) return ''
  return `已完成 ${p.completed} / 总 ${p.total}\n进行中 ${p.inProgress} · 可开始 ${p.ready} · 卡住 ${p.blocked}`
})
</script>

<style scoped>
.node-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  width: 100%;
  max-width: 100%;
  gap: 4px 6px;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  color: var(--color-text);
  font-size: 13px;
  line-height: 24px;
  cursor: grab;
  transition: background var(--transition-fast), border-color var(--transition-fast), box-shadow var(--transition-fast);
}
.node-row:hover {
  border-color: var(--color-border);
  background: var(--color-surface-muted);
}
.node-row.is-critical { background: rgba(185, 106, 106, 0.08); }
.node-row.is-leaf { background: var(--color-surface-raised); }
.node-row.is-dragging {
  opacity: 0.45;
  cursor: grabbing;
}
.type-bar {
  display: inline-block;
  width: 3px;
  height: 22px;
  border-radius: 999px;
  flex-shrink: 0;
}
.node-row.level-1 {
  font-size: 14px;
  font-weight: 650;
}
.node-row.level-1 .type-bar { width: 4px; height: 26px; }
.node-row.level-2 { font-weight: 550; }
.node-row.level-3 { font-size: 12px; }
.status-tag { min-width: 58px; text-align: center; }
.node-title {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}
.material-name {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.op-name {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-secondary);
  font-size: 12px;
}
.key-marker,
.meta-pill,
.assignee,
.child-progress {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 0 8px;
  color: var(--color-text-secondary);
  background: var(--color-surface-muted);
  font-size: 11px;
  font-weight: 600;
}
.key-marker {
  color: var(--color-danger);
  border-color: rgba(185, 106, 106, 0.24);
  background: rgba(185, 106, 106, 0.08);
}
.assignee {
  color: var(--color-success);
  border-color: rgba(67, 133, 107, 0.24);
  background: rgba(67, 133, 107, 0.08);
}
.child-progress {
  color: var(--color-primary);
  border-color: rgba(47, 95, 143, 0.22);
  background: var(--color-primary-soft);
  cursor: help;
}
.node-action,
.more-button { margin-left: 2px; }
.danger-text {
  color: var(--color-danger);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.ml-1 { margin-left: 2px; }
@media (max-width: 760px) {
  .node-row {
    display: flex;
    flex-wrap: wrap;
    white-space: normal;
  }
  .material-name,
  .op-name { max-width: 180px; }
}
</style>
