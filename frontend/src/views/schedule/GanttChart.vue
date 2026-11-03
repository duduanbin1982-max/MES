<template>
  <div class="gantt-wrap" v-loading="loading">
    <div class="gantt-scroll">
      <div class="gantt" :style="{ '--gantt-day-width': scale.dayWidth + 'px', '--gantt-total-width': scale.totalWidth + 'px' }">
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
              <div class="gantt-row-track gantt-group-track" :style="{ width: scale.totalWidth + 'px' }">
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
              :class="{ 'is-selected': selectedId === node.id }"
            >
              <div class="gantt-row-left" :title="`${node.operation_name || ''} ${node.planned_start || ''} ~ ${node.planned_end || ''}`">
                <span class="node-dot" :class="'dot-' + nodePhase(node)"></span>
                <span class="node-title">{{ node.operation_name || '（未命名工序）' }}</span>
                <span v-if="node.assigned_name" class="node-meta">{{ node.assigned_name }}</span>
              </div>
              <div
                class="gantt-row-track"
                :style="{ width: scale.totalWidth + 'px' }"
                @dblclick="selectNode(node)"
              >
                <div
                  v-if="geometry(node)"
                  class="gantt-bar"
                  :class="['bar-' + nodePhase(node), { 'is-dragging': drag && drag.id === node.id }]"
                  :style="barStyle(node)"
                  :title="barTooltip(node)"
                  @pointerdown="startDrag($event, node)"
                >
                  <span class="gantt-bar-label">{{ node.operation_name }}</span>
                </div>
              </div>
            </div>
          </template>
        </div>

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
      <span class="legend-hint">拖动条形可直接改期（按天吸附）；双击行查看详情</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { nodePhase } from '../../domain/scheduleBoard'
import {
  barGeometry,
  buildScale,
  diffDays,
  monthSegments,
  parseDay,
  shiftDates,
  tickLabel,
  toDayString,
  todayOffset,
  type GanttNodeLike,
} from '../../domain/gantt'

const props = defineProps<{
  groups: Array<{ instance_id?: number | null; instance_code?: string; instance_name?: string; nodes: GanttNodeLike[] }>
  from: string
  to: string
  zoom: 'day' | 'week' | 'month'
  loading?: boolean
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
  z-index: 2;
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
</style>
