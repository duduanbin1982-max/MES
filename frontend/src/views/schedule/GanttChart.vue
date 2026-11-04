<template>
  <div class="gantt-wrap" v-loading="loading">
    <!-- 2026-11-04：选中节点后只看它的上下游依赖，其余淡出 -->
    <div v-if="selectedNode" class="gantt-select-bar">
      <span class="select-label">已选：</span>
      <strong>{{ selectedNode.operation_name || '（未命名工序）' }}</strong>
      <el-tag size="small" type="primary" effect="plain">上游 {{ chain.upstreamIds.length }}</el-tag>
      <el-tag size="small" type="success" effect="plain">下游 {{ chain.downstreamIds.length }}</el-tag>
      <span class="select-label">展开</span>
      <el-radio-group v-model="hopDepth" size="small">
        <el-radio-button :value="1">1 跳</el-radio-button>
        <el-radio-button :value="2">2 跳</el-radio-button>
        <el-radio-button :value="3">3 跳</el-radio-button>
        <el-radio-button :value="0">全部</el-radio-button>
      </el-radio-group>
      <span class="select-label">方向</span>
      <el-radio-group v-model="direction" size="small">
        <el-radio-button value="both">双向</el-radio-button>
        <el-radio-button value="upstream">只看上游</el-radio-button>
        <el-radio-button value="downstream">只看下游</el-radio-button>
      </el-radio-group>
      <el-tag v-if="chain.truncated" size="small" type="warning">链条过长，已截断</el-tag>
      <span class="select-hint">其余工序与依赖已淡出；按 Esc 或点空白处清除</span>
      <el-button link type="primary" size="small" @click="clearSelection">清除选中</el-button>
    </div>

    <div class="gantt-scroll">
      <div
      ref="containerRef"
      class="gantt"
      :style="{ '--gantt-day-width': scale.dayWidth + 'px', '--gantt-total-width': scale.totalWidth + 'px' }"
    >
        <!-- 表头 -->
        <div class="gantt-header">
          <div class="gantt-header-left">项目 / 工序</div>
          <div class="gantt-header-timeline" :style="{ width: scale.totalWidth + 'px' }">
            <div class="gantt-month-row">
              <div
                v-for="segment in months"
                :key="segment.label + segment.days"
                class="gantt-month"
                :style="{ width: segment.width + 'px' }"
              >{{ segment.label }}</div>
            </div>
            <div class="gantt-day-row">
              <div
                v-for="(day, index) in scale.days"
                :key="day.date"
                class="gantt-day"
                :class="{ 'is-weekend': day.is_weekend, 'is-today': day.date === todayString, 'is-month-start': day.is_month_start }"
                :style="{ width: scale.dayWidth + 'px' }"
              >{{ tickLabel(day, zoom, index) }}</div>
            </div>
          </div>
        </div>

        <!-- 主体 -->
        <div class="gantt-body">
          <template v-for="group in groups" :key="group.instance_id || group.instance_code">
            <div class="gantt-group-row">
              <div class="gantt-row-left">
                <span class="group-code">{{ group.instance_code }}</span>
                <span class="group-name">{{ group.instance_name }}</span>
                <el-tag size="small" type="info">{{ group.nodes.length }} 个工序</el-tag>
              </div>
              <div class="gantt-row-track gantt-group-track" :style="{ width: scale.totalWidth + 'px' }" @click="clearSelection">
                <div class="gantt-month-separators">
                  <span
                    v-for="day in scale.days.filter((item) => item.is_month_start)"
                    :key="'sep-' + day.date"
                    class="month-separator"
                    :style="{ left: dayOffset(day.date) + 'px' }"
                  />
                </div>
              </div>
            </div>

            <div
              v-for="node in group.nodes"
              :key="node.id"
              class="gantt-row"
              :class="rowClass(node)"
            >
              <div class="gantt-row-left" :title="`${node.operation_name || ''} ${node.planned_start || ''} ~ ${node.planned_end || ''}`">
                <span class="node-dot" :class="'dot-' + nodePhase(node)"></span>
                <span class="node-title">{{ node.operation_name || '（未命名工序）' }}</span>
                <span v-if="hopBadge(node)" class="hop-badge" :class="'hop-' + hopBadge(node)!.relation">{{ hopBadge(node)!.label }}</span>
                <span v-if="node.assigned_name" class="node-meta">{{ node.assigned_name }}</span>
              </div>
              <div
                class="gantt-row-track"
                :style="{ width: scale.totalWidth + 'px' }"
                @click="clearSelection"
              >
                <div
                  v-if="geometry(node)"
                  class="gantt-bar"
                  :class="['bar-' + nodePhase(node), { 'is-dragging': drag && drag.id === node.id }]"
                  :style="barStyle(node)"
                  :title="barTooltip(node)"
                  :data-node-id="node.id"
                  @pointerenter="hoveredId = node.id"
                  @pointerleave="hoveredId = null"
                  @pointerdown="startDrag($event, node)"
                  @click.stop="onBarClick(node)"
                  @dblclick.stop="selectNode(node)"
                >
                  <span class="gantt-bar-label">{{ node.operation_name }}</span>
                </div>
              </div>
            </div>
          </template>
        </div>

        <!-- 依赖箭头层（2026-11-04） -->
        <svg
          v-if="showDependencies && arrows.length"
          class="gantt-arrows"
          :width="svgSize.width"
          :height="svgSize.height"
          aria-hidden="true"
        >
          <defs>
            <marker id="gantt-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--el-color-info)" />
            </marker>
            <marker id="gantt-arrow-danger" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--el-color-danger)" />
            </marker>
            <marker id="gantt-arrow-upstream" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--el-color-primary)" />
            </marker>
            <marker id="gantt-arrow-downstream" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--el-color-success)" />
            </marker>
          </defs>
          <path
            v-for="arrow in arrows"
            :key="arrow.id"
            :d="arrow.path"
            class="gantt-arrow"
            :class="[arrowClass(arrow), { 'is-lagged': arrow.lagged }]"
            :marker-end="arrowMarker(arrow)"
          >
            <title>{{ arrowTooltip(arrow) }}</title>
          </path>
        </svg>

        <!-- 今天标线 -->
        <div v-if="todayOffsetValue !== null" class="gantt-today-line" :style="{ left: `calc(var(--gantt-left-width) + ${todayOffsetValue}px)` }">
          <span class="gantt-today-label">今天</span>
        </div>
      </div>
    </div>

    <div class="gantt-legend">
      <span class="legend-item"><span class="legend-dot dot-done"></span>已完成</span>
      <span class="legend-item"><span class="legend-dot dot-running"></span>执行中</span>
      <span class="legend-item"><span class="legend-dot dot-overdue"></span>超期</span>
      <span class="legend-item"><span class="legend-dot dot-blocked"></span>受阻</span>
      <span class="legend-item"><span class="legend-dot dot-upcoming"></span>待开始</span>
      <span class="legend-item"><span class="legend-line"></span>前置依赖（红=链条有超期/受阻）</span>
      <span class="legend-item"><span class="legend-line legend-line--dashed"></span>FS 有间隔（虚线=lag 小时数）</span>
      <span class="legend-hint">单击条形只看它的上下游依赖（Esc 清除）· 拖动可直接改期 · 双击看详情</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { nodePhase } from '../../domain/scheduleBoard'
import {
  barGeometry,
  arrowGeometry,
  arrowHop,
  expandChain,
  nodeHop,
  buildScale,
  dependencyPath,
  dependencyTone,
  diffDays,
  monthSegments,
  parseDay,
  shiftDates,
  tickLabel,
  toDayString,
  todayOffset,
  type DependencyLike,
  type GanttNodeLike,
} from '../../domain/gantt'

const props = defineProps<{
  groups: Array<{ instance_id?: number | null; instance_code?: string; instance_name?: string; nodes: GanttNodeLike[] }>
  from: string
  to: string
  zoom: 'day' | 'week' | 'month'
  loading?: boolean
  dependencies?: DependencyLike[]
  showDependencies?: boolean
}>()

const emit = defineEmits<{
  move: [payload: { node: GanttNodeLike; planned_start: string | null; planned_end: string | null; delta_days: number }]
  select: [node: GanttNodeLike]
}>()

const scale = computed(() => buildScale(props.from, props.to, props.zoom))
const months = computed(() => monthSegments(scale.value))
const todayString = toDayString(new Date())
const todayOffsetValue = computed(() => todayOffset(scale.value))

const geometry = (node: GanttNodeLike) => barGeometry(node, scale.value)
const barStyle = (node: GanttNodeLike) => {
  const geo = geometry(node)
  if (!geo) return {}
  const dragging = drag.value && drag.value.id === node.id ? drag.value.deltaDays * scale.value.dayWidth : 0
  return { left: geo.left + dragging + 'px', width: geo.width + 'px' }
}
const dayOffset = (date: string) => {
  const from = parseDay(scale.value.from)
  const target = parseDay(date)
  if (!from || !target) return 0
  return diffDays(from, target) * scale.value.dayWidth
}
const barTooltip = (node: GanttNodeLike) => [
  node.operation_name || '工序',
  `${node.planned_start || '—'} ~ ${node.planned_end || '—'}`,
  node.workstation_name ? `工位：${node.workstation_name}` : '',
  node.assigned_name ? `负责人：${node.assigned_name}` : '',
  node.estimated_hours ? `工时：${node.estimated_hours}h` : '',
].filter(Boolean).join('\n')

// ---------------- 拖拽改期 ----------------
const drag = ref<null | { id: number; startX: number; deltaDays: number }>(null)
const selectedId = ref<number | null>(null)

// ---------------- 只看选中节点依赖（2026-11-04） ----------------
const selectedNode = computed(() => {
  if (selectedId.value === null) return null
  for (const group of props.groups) {
    const found = group.nodes.find((node) => node.id === selectedId.value)
    if (found) return found
  }
  return null
})

// 2026-11-04：N 跳展开（0 = 全部）
const hopDepth = ref<number>(1)
const direction = ref<'both' | 'upstream' | 'downstream'>('both')
const chain = computed(() =>
  expandChain(
    props.dependencies || [],
    selectedId.value,
    hopDepth.value === 0 ? Number.POSITIVE_INFINITY : hopDepth.value,
    300,
    direction.value,
  ),
)

let suppressClick = false

const onBarClick = (node: GanttNodeLike) => {
  if (suppressClick) {
    suppressClick = false
    return
  }
  if (selectedId.value === node.id) {
    selectedId.value = null
    hopDepth.value = 1
    direction.value = 'both'
    return
  }
  selectedId.value = node.id
  hopDepth.value = 1
  direction.value = 'both'
}

const clearSelection = () => {
  selectedId.value = null
  hopDepth.value = 1
  direction.value = 'both'
}

/** 行上的跳数徽标：↑1 = 上游 1 跳；↓2 = 下游 2 跳 */
const hopBadge = (node: GanttNodeLike) => {
  const hop = nodeHop(node.id, selectedId.value, chain.value)
  if (hop.relation === 'none') return null
  return {
    relation: hop.relation,
    label: `${hop.relation === 'upstream' ? '↑' : '↓'}${hop.depth}`,
  }
}

const rowClass = (node: GanttNodeLike) => {
  const hop = nodeHop(node.id, selectedId.value, chain.value)
  const self = selectedId.value === node.id
  const related = hop.relation !== 'none'
  return {
    'is-selected': self,
    'row-upstream': hop.relation === 'upstream',
    'row-downstream': hop.relation === 'downstream',
    'row-dimmed': selectedId.value !== null && !self && !related,
    'row-hop-far': related && hop.depth >= 2,
  }
}

const arrowClass = (arrow: { tone: string; from_id: number; to_id: number }) => {
  if (selectedId.value === null) {
    return [
      `arrow-${arrow.tone}`,
      { 'is-active': hoveredId.value !== null && (arrow.from_id === hoveredId.value || arrow.to_id === hoveredId.value) },
    ]
  }
  const hop = arrowHop({ id: 0, predecessor_id: arrow.from_id, successor_id: arrow.to_id }, selectedId.value, chain.value)
  if (hop.relation === 'none') return 'is-dimmed'
  return [
    `is-${hop.relation}`,
    `hop-depth-${Math.min(hop.depth, 3)}`,
  ]
}

const arrowTooltip = (arrow: { dep_type: string; lag_hours: number; lagged: boolean }) => {
  const lagText = arrow.lag_hours > 0 ? ` · 间隔 ${arrow.lag_hours}h` : ''
  return `${arrow.dep_type}${lagText}`
}

const arrowMarker = (arrow: { tone: string; from_id: number; to_id: number }) => {
  if (selectedId.value !== null) {
    const hop = arrowHop({ id: 0, predecessor_id: arrow.from_id, successor_id: arrow.to_id }, selectedId.value, chain.value)
    if (hop.relation === 'upstream') return 'url(#gantt-arrow-upstream)'
    if (hop.relation === 'downstream') return 'url(#gantt-arrow-downstream)'
  }
  return arrow.tone === 'danger' ? 'url(#gantt-arrow-danger)' : 'url(#gantt-arrow)'
}

// Esc 清除选中；选中节点不在当前数据里时自动清除
const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && selectedId.value !== null) clearSelection()
}

watch(
  () => props.groups,
  () => {
    if (selectedId.value === null) return
    const exists = props.groups.some((group) => group.nodes.some((node) => node.id === selectedId.value))
    if (!exists) selectedId.value = null
  },
)

// ---------------- 依赖箭头（2026-11-04） ----------------
const containerRef = ref<HTMLElement | null>(null)
const hoveredId = ref<number | null>(null)
const arrows = ref<Array<{ id: number; path: string; tone: 'normal' | 'danger'; from_id: number; to_id: number; lagged: boolean; lag_hours: number; dep_type: string }>>([])
const svgSize = ref({ width: 0, height: 0 })

const measureArrows = () => {
  const root = containerRef.value
  if (!root) return
  const rootRect = root.getBoundingClientRect()
  const rects = new Map<number, DOMRect>()
  root.querySelectorAll<HTMLElement>('[data-node-id]').forEach((element) => {
    rects.set(Number(element.dataset.nodeId), element.getBoundingClientRect())
  })
  const nodeById = new Map<number, GanttNodeLike>()
  for (const group of props.groups) for (const node of group.nodes) nodeById.set(node.id, node)
  const next: typeof arrows.value = []
  if (props.showDependencies !== false) {
    for (const dep of props.dependencies || []) {
      const a = rects.get(dep.predecessor_id)
      const b = rects.get(dep.successor_id)
      if (!a || !b) continue
      const geometry = arrowGeometry(
        { left: a.left - rootRect.left, right: a.right - rootRect.left, top: a.top - rootRect.top, height: a.height },
        { left: b.left - rootRect.left, right: b.right - rootRect.left, top: b.top - rootRect.top, height: b.height },
        { dayWidth: scale.value.dayWidth, lagHours: (dep as any).lag_hours, depType: (dep as any).dep_type },
      )
      const previous = nodeById.get(dep.predecessor_id)
      const nextNode = nodeById.get(dep.successor_id)
      next.push({
        id: dep.id,
        path: dependencyPath(geometry.from, geometry.to),
        tone: dependencyTone(previous ? nodePhase(previous) : 'upcoming', nextNode ? nodePhase(nextNode) : 'upcoming'),
        from_id: dep.predecessor_id,
        to_id: dep.successor_id,
        lagged: geometry.lagged,
        lag_hours: Number((dep as any).lag_hours) || 0,
        dep_type: (dep as any).dep_type || 'FS',
      })
    }
  }
  arrows.value = next
  svgSize.value = { width: root.scrollWidth, height: root.scrollHeight }
}

watch(
  () => [props.groups, props.from, props.to, props.zoom, props.showDependencies, props.dependencies],
  async () => {
    await nextTick()
    measureArrows()
  },
  { deep: true },
)

let resizeObserver: ResizeObserver | null = null
onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  measureArrows()
  if (typeof ResizeObserver !== 'undefined' && containerRef.value) {
    resizeObserver = new ResizeObserver(() => measureArrows())
    resizeObserver.observe(containerRef.value)
  }
})

const onPointerMove = (event: PointerEvent) => {
  if (!drag.value) return
  const deltaPx = event.clientX - drag.value.startX
  drag.value.deltaDays = Math.round(deltaPx / scale.value.dayWidth)
}

const onPointerUp = () => {
  const current = drag.value
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  drag.value = null
  // 拖动过就抑制紧随其后的 click，避免"拖完顺手选中"
  if (current && current.deltaDays !== 0) suppressClick = true
  if (!current || current.deltaDays === 0) return
  const node = props.groups.flatMap((group) => group.nodes).find((item) => item.id === current.id)
  if (!node) return
  const next = shiftDates(node, current.deltaDays)
  emit('move', { node, planned_start: next.planned_start, planned_end: next.planned_end, delta_days: current.deltaDays })
}

const startDrag = (event: PointerEvent, node: GanttNodeLike) => {
  if (event.button !== 0) return
  event.preventDefault()
  drag.value = { id: node.id, startX: event.clientX, deltaDays: 0 }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
}

const selectNode = (node: GanttNodeLike) => {
  selectedId.value = node.id
  emit('select', node)
}

onUnmounted(() => {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  resizeObserver?.disconnect()
  window.removeEventListener('keydown', onKeydown)
})
</script>

<style scoped>
.gantt-wrap {
  --gantt-left-width: 260px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  background: var(--el-bg-color);
  overflow: hidden;
}

.gantt-scroll {
  overflow: auto;
  max-height: 68vh;
}

.gantt {
  min-width: calc(var(--gantt-left-width) + var(--gantt-total-width));
  position: relative;
}

/* 表头 */
.gantt-header {
  display: flex;
  position: sticky;
  top: 0;
  z-index: 3;
  background: var(--el-bg-color);
  border-bottom: 1px solid var(--el-border-color);
}

.gantt-header-left,
.gantt-row-left {
  position: sticky;
  left: 0;
  z-index: 2;
  width: var(--gantt-left-width);
  min-width: var(--gantt-left-width);
  background: var(--el-bg-color);
  border-right: 1px solid var(--el-border-color-lighter);
  padding: 0 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.gantt-header-left {
  font-weight: 600;
  z-index: 4;
}

.gantt-header-timeline {
  flex: none;
}

.gantt-month-row,
.gantt-day-row {
  display: flex;
}

.gantt-month {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-color-info);
  border-right: 1px solid var(--el-border-color-lighter);
  padding: 4px 6px;
  white-space: nowrap;
  overflow: hidden;
}

.gantt-day {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  text-align: center;
  line-height: 22px;
  border-right: 1px solid var(--el-border-color-extra-light);
  user-select: none;
}

.gantt-day.is-weekend {
  background: var(--el-fill-color-lighter);
}

.gantt-day.is-today {
  color: var(--el-color-primary);
  font-weight: 700;
}

/* 主体 */
.gantt-body {
  position: relative;
}

.gantt-group-row,
.gantt-row {
  display: flex;
  border-bottom: 1px solid var(--el-border-color-extra-light);
}

.gantt-group-row {
  background: var(--el-fill-color-light);
  position: sticky;
  left: 0;
  z-index: 1;
}

.group-code {
  font-family: Consolas, monospace;
  font-weight: 600;
  font-size: 12px;
}

.group-name {
  font-size: 12px;
  color: var(--el-color-info);
  margin-right: 6px;
}

.gantt-row {
  height: 34px;
}

.gantt-row:hover {
  background: var(--el-fill-color-lighter);
}

.gantt-row.is-selected {
  background: var(--el-color-primary-light-9);
}

.gantt-row-track {
  position: relative;
  flex: none;
  /* 日分隔线 + 周末底纹（按 7 天周期，假设周一开始） */
  background-image:
    repeating-linear-gradient(
      90deg,
      transparent 0,
      transparent calc(var(--gantt-day-width) - 1px),
      var(--el-border-color-extra-light) calc(var(--gantt-day-width) - 1px),
      var(--el-border-color-extra-light) var(--gantt-day-width)
    ),
    repeating-linear-gradient(
      90deg,
      transparent 0,
      transparent calc(var(--gantt-day-width) * 5),
      var(--el-fill-color-lighter) calc(var(--gantt-day-width) * 5),
      var(--el-fill-color-lighter) calc(var(--gantt-day-width) * 7)
    );
}

.gantt-group-track {
  height: 30px;
}

.month-separator {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--el-border-color);
}

/* 条形 */
.gantt-bar {
  position: absolute;
  top: 7px;
  height: 20px;
  border-radius: 5px;
  display: flex;
  align-items: center;
  padding: 0 6px;
  font-size: 11px;
  color: #fff;
  overflow: hidden;
  white-space: nowrap;
  cursor: grab;
  user-select: none;
  z-index: 2;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  transition: box-shadow 120ms ease;
}

.gantt-bar:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
}

.gantt-bar.is-dragging {
  cursor: grabbing;
  opacity: 0.85;
  z-index: 5;
}

.gantt-bar-label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.bar-done {
  background: var(--el-color-success);
}

.bar-running {
  background: var(--el-color-warning);
}

.bar-overdue {
  background: var(--el-color-danger);
}

.bar-blocked {
  background: var(--el-color-danger-dark-2);
}

.bar-upcoming {
  background: var(--el-color-primary);
}

/* 行左侧状态点 */
.node-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}

.dot-done { background: var(--el-color-success); }
.dot-running { background: var(--el-color-warning); }
.dot-overdue { background: var(--el-color-danger); }
.dot-blocked { background: var(--el-color-danger-dark-2); }
.dot-upcoming { background: var(--el-color-primary); }
.dot-unscheduled { background: var(--el-color-info-light-5); }

.node-title {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node-meta {
  font-size: 11px;
  color: var(--el-color-info);
  margin-left: auto;
  flex: none;
}

/* 今天标线 */
.gantt-today-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--el-color-danger);
  opacity: 0.65;
  z-index: 3;
  pointer-events: none;
}

.gantt-today-label {
  position: absolute;
  top: 2px;
  left: 4px;
  font-size: 10px;
  color: var(--el-color-danger);
  background: var(--el-bg-color);
  padding: 0 2px;
  white-space: nowrap;
}

/* 依赖箭头 */
.gantt-arrows {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 1;
  pointer-events: none;
  overflow: visible;
}

.gantt-arrow {
  fill: none;
  stroke: var(--el-color-info-light-3);
  stroke-width: 1.2;
  opacity: 0.7;
}

.gantt-arrow.arrow-danger {
  stroke: var(--el-color-danger-light-5);
  opacity: 0.9;
}

.gantt-arrow.is-active {
  stroke: var(--el-color-primary);
  stroke-width: 2;
  opacity: 1;
}

.legend-line {
  width: 14px;
  height: 2px;
  background: var(--el-color-info-light-3);
  display: inline-block;
}

/* 图例 */
.gantt-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  padding: 8px 12px;
  border-top: 1px solid var(--el-border-color-lighter);
  font-size: 12px;
  color: var(--el-color-info);
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  display: inline-block;
}

.legend-hint {
  margin-left: auto;
}
.gantt-select-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: var(--el-color-primary-light-9);
  font-size: 12px;
}

.select-label {
  color: var(--el-color-info);
}

.select-hint {
  color: var(--el-color-info);
}

.gantt-row.row-upstream {
  background: var(--el-color-primary-light-9);
}

.gantt-row.row-downstream {
  background: var(--el-color-success-light-9);
}

.gantt-row.row-dimmed {
  opacity: 0.45;
}

.gantt-arrow.is-upstream {
  stroke: var(--el-color-primary);
  stroke-width: 2;
  opacity: 1;
}

.gantt-arrow.is-downstream {
  stroke: var(--el-color-success);
  stroke-width: 2;
  opacity: 1;
}

.gantt-arrow.is-dimmed {
  opacity: 0.07;
}
.hop-badge {
  font-size: 10px;
  line-height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  flex: none;
  color: #fff;
}

.hop-badge.hop-upstream {
  background: var(--el-color-primary);
}

.hop-badge.hop-downstream {
  background: var(--el-color-success);
}

.gantt-row.row-hop-far {
  opacity: 0.85;
}

/* 跳数越远，线越细越淡 */
.gantt-arrow.hop-depth-1 {
  stroke-width: 2;
  opacity: 1;
}

.gantt-arrow.hop-depth-2 {
  stroke-width: 1.6;
  opacity: 0.8;
}

.gantt-arrow.hop-depth-3 {
  stroke-width: 1.2;
  opacity: 0.6;
}
.gantt-arrow.is-lagged {
  stroke-dasharray: 5 3;
}

.legend-line--dashed {
  background: repeating-linear-gradient(90deg, var(--el-color-info-light-3) 0 4px, transparent 4px 7px);
}
</style>
