<template>
  <div
    class="node-row"
    :class="['level-' + levelClass, { 'is-critical': data.is_critical, 'is-leaf': isLeaf, 'is-dragging': isDragging }]"
    :draggable="true"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
  >
    <span class="type-bar" :style="{ background: typeColor }"></span>
    <el-tag v-if="data.is_critical" type="danger" size="small" effect="dark" class="ml-1">⭐</el-tag>
    <el-tag :type="statusTagType(effectiveStatus)" size="small" effect="dark" class="ml-1" style="min-width: 50px; text-align: center">
      {{ statusLabel(effectiveStatus) }}
    </el-tag>
    <span v-if="data.material_name" class="material-name">{{ data.material_name }}</span>
    <span v-else class="material-name">{{ data.notes || data.operation_name }}</span>
    <span class="op-name">{{ data.operation_name }}</span>
    <span v-if="data.bom_is_key" class="key-marker">⭐</span>
    <span class="qty">qty={{ data.bom_quantity || 1 }}</span>
    <span class="hours">{{ data.estimated_hours || 0 }}h</span>
    <span v-if="data.assigned_to" class="assignee">👷#{{ data.assigned_to }}</span>
    <!-- 子进度聚合徽章（只在非叶子节点显示） -->
    <span v-if="hasChildren && data.progress && data.progress.total > 1" class="child-progress" :title="progressTooltip">
      {{ data.progress.completed }}/{{ data.progress.total }} ✓
    </span>
    <el-button v-if="effectiveStatus === 'ready'" size="small" type="primary" class="ml-1" @click.stop="$emit('start', data)">开始</el-button>
    <el-button v-else-if="effectiveStatus === 'in_progress'" size="small" type="success" class="ml-1" @click.stop="$emit('complete', data)">完成</el-button>
    <el-dropdown @command="(c) => $emit('cmd', c, data)" trigger="click">
      <el-button size="small" text class="ml-1" @click.stop>⋯</el-button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item command="edit">✏️ 编辑</el-dropdown-item>
          <el-dropdown-item command="assign">👷 分配</el-dropdown-item>
          <el-dropdown-item command="addchild">➕ 加子节点</el-dropdown-item>
          <el-dropdown-item command="adddep">🔗 加依赖</el-dropdown-item>
          <el-dropdown-item command="delete" divided><span style="color: #f56c6c">🗑 删除</span></el-dropdown-item>
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

// 派生状态
const effectiveStatus = computed(() => props.data.derived_status || props.data.status || 'pending')

// 拖拽态 — 用 ref 切换 visual cue（不影响 props.data 语义）
const isDragging = ref(false)
function onDragStart(e) {
  // payload: node_id + current subsystem_id (target can decide no-op if same)
  const payload = JSON.stringify({
    node_id: props.data.id,
    from_subsystem_id: props.data.subsystem_id == null ? null : props.data.subsystem_id,
    node_name: props.data.operation_name || props.data.material_name || `#${props.data.id}`,
  })
  e.dataTransfer.setData('application/x-process-node', payload)
  e.dataTransfer.setData('text/plain', payload) // fallback for browsers
  e.dataTransfer.effectAllowed = 'move'
  isDragging.value = true
  emit('dragstart', props.data)
}
function onDragEnd() {
  isDragging.value = false
}

// 类型色条
const typeColor = computed(() => TYPE_COLOR[props.data.operation_type] || TYPE_COLOR.default)

// 是否叶子
const isLeaf = computed(() => !props.data.children || props.data.children.length === 0)
const hasChildren = computed(() => !isLeaf.value)

// 层级 class（依据父链深度）
// vue-tree 的 node.level 是 1-based 内部树层级（根=1）
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
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 13px;
  line-height: 24px;
}
.node-row.is-critical {
  background: #fef0f0;
}
.node-row.is-leaf {
  background: #fafbfc;
}
.node-row.is-dragging {
  opacity: 0.4;
  cursor: grabbing;
}
.node-row {
  cursor: grab;
}
.type-bar {
  display: inline-block;
  width: 3px;
  height: 18px;
  border-radius: 1.5px;
  flex-shrink: 0;
}
/* 层级视觉分级 */
.node-row.level-1 {
  font-size: 14px;
  font-weight: 600;
}
.node-row.level-1 .type-bar { width: 4px; height: 22px; }
.node-row.level-2 {
  font-size: 13px;
  font-weight: 500;
}
.node-row.level-3 {
  font-size: 12px;
}
.material-name { font-weight: 500; min-width: 0; }
.op-name { color: #909399; font-size: 12px; }
.key-marker { color: #f56c6c; font-size: 12px; }
.qty, .hours { color: #909399; font-size: 12px; }
.assignee { color: #67c23a; font-size: 12px; }
.child-progress {
  display: inline-block;
  background: #f0f9ff;
  color: #409eff;
  border: 1px solid #d9ecff;
  border-radius: 10px;
  padding: 0 8px;
  font-size: 11px;
  font-weight: 600;
  cursor: help;
}
.ml-1 { margin-left: 2px; }
</style>
