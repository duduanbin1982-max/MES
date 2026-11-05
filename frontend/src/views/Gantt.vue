<template>
  <div class="page">
    <div class="page-header">
      <div>
        <div class="page-title"><el-icon><Calendar /></el-icon> 单项目甘特图</div>
        <div class="page-subtitle">按项目排程结果展示工序计划、真实工期、子系统分组和计划告警。</div>
      </div>
      <div class="page-actions">
        <el-select v-model="selectedInstance" placeholder="选实例" style="width: 280px" filterable @change="loadGantt">
          <el-option
            v-for="instance in instances"
            :key="instance.id"
            :label="instance.instance_code + ' | ' + (instance.instance_name || '')"
            :value="instance.id"
          />
        </el-select>
        <el-button @click="loadAll">刷新</el-button>
        <el-button type="primary" :loading="scheduling" :disabled="!selectedInstance" @click="openScheduler">重新排程</el-button>
      </div>
    </div>

    <el-alert v-if="lastBatch" type="success" :closable="false" show-icon class="schedule-alert">
      <template #title>
        本次排程已应用（批次 {{ lastBatch.batch_no }}，{{ lastBatch.written }} 个节点）。
        <el-button link type="primary" size="small" :loading="undoing" @click="undoLastSchedule">撤销本次排程</el-button>
      </template>
    </el-alert>

    <div v-if="!selectedInstance" class="empty-wrap">
      <el-empty description="选实例查看甘特图" />
    </div>

    <div v-else v-loading="loading">
      <el-row :gutter="16" class="summary-row">
        <el-col :span="6">
          <div class="stat-card">
            <div class="stat-label">项目</div>
            <div class="stat-value stat-text">{{ gantt.instance?.code || '-' }}</div>
            <div class="stat-label">{{ gantt.instance?.name || '' }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-card">
            <div class="stat-label">计划跨度</div>
            <div class="stat-value">{{ timeline.totalDays || 0 }} 天</div>
            <div class="stat-label">{{ (gantt.total_weeks || 0) }} 周</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-card">
            <div class="stat-label">工序工时</div>
            <div class="stat-value">{{ gantt.total_work_hours || 0 }}h</div>
            <div class="stat-label">已排 {{ gantt.scheduled_count || 0 }} / 未排 {{ gantt.unscheduled_count || 0 }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-card">
            <div class="stat-label">本项目告警</div>
            <div class="stat-value warning-text">{{ alerts.count || 0 }}</div>
            <div class="stat-label">紧急 {{ alerts.by_severity?.danger || 0 }} · 警告 {{ alerts.by_severity?.warning || 0 }}</div>
          </div>
        </el-col>
      </el-row>

      <el-card class="gantt-card">
        <template #header>
          <div class="card-header">
            <span><el-icon><DataAnalysis /></el-icon> 子系统分组甘特</span>
            <div class="header-right">
              <el-button-group>
                <el-button
                  v-for="level in ZOOM_LEVELS"
                  :key="level.value"
                  size="small"
                  :type="zoom === level.value ? 'primary' : 'default'"
                  :title="level.hint"
                  @click="setZoom(level.value)"
                >{{ level.label }}</el-button>
              </el-button-group>
              <span class="muted">
                计划：{{ formatSpanLabel(gantt.project_start, gantt.project_end, gantt.total_days) }}
              </span>
            </div>
          </div>
        </template>

        <div class="gantt-legend">
          <span class="legend-item"><i class="lg-plan"></i>计划</span>
          <span class="legend-item"><i class="lg-actual"></i>实际进度（完成后变深）</span>
          <span class="legend-item"><i class="lg-unscheduled"></i>未排程（按依赖推算）</span>
          <span class="legend-item"><i class="lg-today"></i>今天</span>
          <span class="legend-item legend-progress">
            项目进度
            <el-progress :percentage="gantt.progress_pct || 0" :stroke-width="10" :show-text="true" style="width: 160px" />
          </span>
        </div>
        <div v-if="!displayRows.length" class="empty-wrap small">
          <el-empty description="该项目暂无可展示工序" :image-size="80">
            <el-button type="primary" plain @click="$router.push('/process-tree')">去工艺树排程</el-button>
          </el-empty>
        </div>
        <div v-else class="gantt-container">
          <div class="gantt-header">
            <div class="gantt-row-label gantt-row-title">节点</div>
            <div class="gantt-timeline-header" :style="{ width: timeline.totalWidth + 'px' }">
              <div
                v-for="month in timeline.months"
                :key="month.key"
                class="gantt-month"
                :style="{ width: month.width + 'px' }"
                :title="`${month.label} · ${month.days} 天`"
              >
                {{ month.label }}
                <small v-if="month.width >= 64">（{{ month.days }}天）</small>
              </div>
            </div>
          </div>

          <div class="gantt-body">
            <div
              v-for="row in displayRows"
              :key="row.row_key"
              class="gantt-row"
              :class="{ 'group-row': row.type === 'group', 'row-focused': row.type === 'bar' && row.id === focusedNodeId }"
              :data-node-id="row.type === 'bar' ? row.id : undefined"
              :style="{ height: (row.type === 'group' ? groupRowHeight : rowHeight) + 'px' }"
            >
              <div class="gantt-row-label" :title="row.type === 'bar' ? rowTitle(row) : row.name">
                <template v-if="row.type === 'group'">
                  <span class="group-name">{{ row.name }}</span>
                  <el-tag size="small" type="info">{{ row.count }} 项</el-tag>
                </template>
                <template v-else>
                  <span class="node-id">#{{ row.id }}</span>
                  <span class="node-name">{{ row.name }}</span>
                  <el-tag v-if="!row.scheduled" size="small" type="warning">未排程·推算</el-tag>
                </template>
              </div>
              <div class="gantt-timeline" :style="{ width: timeline.totalWidth + 'px', ...timelineGridStyle }">
                <div
                  v-if="row.type === 'bar' && barRectOf(row)"
                  class="gantt-bar"
                  :class="{ 'is-unscheduled': !row.scheduled }"
                  :style="barStyle(row)"
                  :title="barTitle(row)"
                >
                  <span class="bar-progress" :style="{ width: (row.progress || 0) + '%' }"></span>
                  <span v-if="!row.scheduled" class="bar-hatch"></span>
                  <span v-if="barRectOf(row)!.width >= 56" class="bar-text">{{ barText(row) }}</span>
                  <span
                    v-if="row.has_actual_start"
                    class="bar-actual-mark"
                    :style="actualMarkStyle(row)"
                    title="实际开始"
                  ></span>
                </div>
              </div>
            </div>
            <div
              v-if="timeline.todayLeft !== null"
              class="gantt-today-line"
              :style="{ left: `calc(260px + ${timeline.todayLeft}px)` }"
            >
              <span class="gantt-today-label">今天</span>
            </div>
          </div>
        </div>
      </el-card>

      <el-card>
        <template #header>
          <span><el-icon><Bell /></el-icon> 本项目告警</span>
          <span class="muted">仅统计当前项目（{{ gantt.instance?.code || '-' }}）</span>
        </template>
        <el-row :gutter="16" class="summary-row compact">
          <el-col :span="8"><div class="stat-card"><div class="stat-label">紧急</div><div class="stat-value danger-text">{{ alerts.by_severity?.danger || 0 }}</div></div></el-col>
          <el-col :span="8"><div class="stat-card"><div class="stat-label">警告</div><div class="stat-value warning-text">{{ alerts.by_severity?.warning || 0 }}</div></div></el-col>
          <el-col :span="8"><div class="stat-card"><div class="stat-label">信息</div><div class="stat-value info-text">{{ alerts.by_severity?.info || 0 }}</div></div></el-col>
        </el-row>
        <el-table
          :data="alerts.alerts || []"
          stripe
          size="small"
          empty-text="暂无告警"
          :row-class-name="alertRowClass"
          @row-click="onAlertClick"
        >
          <el-table-column label="级别" width="80">
            <template #default="{ row }">
              <el-tag :type="row.severity === 'danger' ? 'danger' : row.severity === 'warning' ? 'warning' : 'info'" size="small">
                {{ row.severity === 'danger' ? '紧急' : row.severity === 'warning' ? '警告' : '信息' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="类型" width="160">
            <template #default="{ row }">{{ row.type_label || row.type }}</template>
          </el-table-column>
          <el-table-column prop="message" label="内容" min-width="300" />
          <el-table-column label="操作" width="90" align="center">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click.stop="onAlertClick(row)">
                {{ alertTargetLabel(row) }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </div>

    <!-- 2026-11-05（审计 F-01/F-03）：重新排程改为"先预览再应用" -->
    <el-dialog v-model="schedulerVisible" title="重新排程（先预览，确认后再写入）" width="860px" :close-on-click-modal="false">
      <div class="scheduler-toolbar">
        <span class="muted">项目开始日</span>
        <el-date-picker v-model="schedulerStart" type="date" value-format="YYYY-MM-DD" placeholder="沿用项目已设开始日" style="width: 200px" />
        <el-button size="small" :loading="previewing" @click="previewSchedule">重新预览</el-button>
        <span class="muted">已完成 / 已取消节点不会被重排</span>
      </div>

      <div v-if="preview" class="scheduler-summary">
        <el-tag type="info">节点 {{ preview.node_count }}</el-tag>
        <el-tag type="primary">可排 {{ preview.schedulable_count }}</el-tag>
        <el-tag type="success">将变更 {{ preview.changed_count }}</el-tag>
        <el-tag>不变 {{ preview.unchanged_count }}</el-tag>
        <el-tag type="warning">受保护 {{ preview.protected_count }}</el-tag>
        <el-tag v-if="preview.errors?.length" type="danger">错误 {{ preview.errors.length }}</el-tag>
      </div>

      <el-alert v-if="preview?.errors?.length" type="error" :closable="false" show-icon class="schedule-alert">
        <template #title>存在无法排程的节点，已阻止写入：{{ preview.errors.slice(0, 3).join('；') }}</template>
      </el-alert>

      <el-table v-if="preview?.full?.length" :data="preview.full" size="small" border max-height="340" empty-text="没有需要变更的节点">
        <el-table-column label="工序" min-width="150">
          <template #default="{ row }">
            <span>#{{ row.id }} {{ row.operation_name || '' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="90" />
        <el-table-column label="原计划" min-width="180">
          <template #default="{ row }">
            <span :class="{ 'plan-changed': row.changed }">{{ row.previous_planned_start || '未排程' }}</span>
            <span v-if="row.previous_planned_start"> → {{ row.previous_planned_end || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="新计划" min-width="180">
          <template #default="{ row }">
            <span :class="{ 'plan-changed': row.changed }">{{ row.planned_start }} → {{ row.planned_end }}</span>
          </template>
        </el-table-column>
        <el-table-column label="变更" width="70" align="center">
          <template #default="{ row }">
            <el-tag :type="row.changed ? 'warning' : 'info'" size="small">{{ row.changed ? '变' : '不变' }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-else-if="!previewing" description="点「重新预览」查看排程结果" :image-size="60" />

      <template #footer>
        <el-button @click="schedulerVisible = false">取消</el-button>
        <el-button :loading="previewing" @click="previewSchedule">预览</el-button>
        <el-button
          type="primary"
          :loading="scheduling"
          :disabled="!preview || !preview.changed_count || (preview.errors && preview.errors.length > 0)"
          @click="applySchedule"
        >
          确认应用{{ preview?.changed_count ? `（${preview.changed_count} 条）` : '' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted } from 'vue'
import type { CSSProperties } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Api } from '../api'
import {
  ZOOM_LEVELS,
  barRect,
  buildTimeline,
  dayWidthOf,
  formatSpanLabel,
  parseDateLoose,
  type ZoomLevel,
} from '../domain/singleGantt'

const router = useRouter()

const instances = ref<any[]>([])
const selectedInstance = ref<any>(undefined)
const gantt = ref<any>({})
const alerts = ref<any>({})
const loading = ref(false)
const scheduling = ref(false)
const previewing = ref(false)
const undoing = ref(false)

const schedulerVisible = ref(false)
const schedulerStart = ref<string>('')
const preview = ref<any>(null)
const lastBatch = ref<{ id: number; batch_no: string; written: number } | null>(null)

const rowHeight = 28
const groupRowHeight = 30

// 缩放档位（2026-11-05）：日 24px / 周 8px / 月 4px
const zoom = ref<ZoomLevel>('week')
const dayWidth = computed(() => dayWidthOf(zoom.value))
const setZoom = (level: ZoomLevel) => {
  zoom.value = level
}

const timeline = computed(() => buildTimeline(gantt.value.project_start, gantt.value.project_end, dayWidth.value, 30))

// 网格：日视图画每天线，周/月视图画每 7 天线
const timelineGridStyle = computed<CSSProperties>(() => {
  const step = dayWidth.value >= 16 ? dayWidth.value : dayWidth.value * 7
  return {
    backgroundImage: `repeating-linear-gradient(90deg, transparent 0, transparent ${step - 1}px, var(--el-border-color-extra-light) ${step - 1}px, var(--el-border-color-extra-light) ${step}px)`,
  }
})

// 告警点击定位
const focusedNodeId = ref<number | null>(null)
const alertRowClass = ({ row }: { row: any }) => 'alert-row-clickable'
const alertTargetLabel = (alert: any) => {
  if (alert?.ref?.node_id) return '定位工序'
  if (alert?.ref?.work_order_id) return '看工单'
  if (alert?.ref?.milestone_id) return '看项目'
  return '—'
}
const onAlertClick = async (alert: any) => {
  const ref = alert?.ref || {}
  if (ref.node_id) {
    focusedNodeId.value = Number(ref.node_id)
    await nextTick()
    const row = document.querySelector(`[data-node-id="${ref.node_id}"]`) as HTMLElement | null
    row?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    window.setTimeout(() => { focusedNodeId.value = null }, 3000)
    return
  }
  if (ref.work_order_id) {
    router.push({ path: '/work-orders', query: { instance_id: String(selectedInstance.value) } })
    return
  }
  if (ref.milestone_id) {
    router.push(`/instances/${selectedInstance.value}`)
  }
}

const displayRows = computed(() => {
  const bars = gantt.value.bars || []
  const groups = new Map<string, any[]>()
  for (const bar of bars) {
    const group = bar.subsystem || '未分组'
    if (!groups.has(group)) groups.set(group, [])
    groups.get(group)!.push({ ...bar, type: 'bar', row_key: `bar-${bar.id}` })
  }
  const rows: any[] = []
  for (const [name, groupBars] of groups.entries()) {
    rows.push({ type: 'group', row_key: `group-${name}`, name, count: groupBars.length })
    rows.push(...groupBars)
  }
  return rows
})

const barRectOf = (bar: any) => barRect(bar, gantt.value.project_start, dayWidth.value)

const barStyle = (bar: any): CSSProperties => {
  const rect = barRectOf(bar)
  if (!rect) return {}
  return {
    position: 'absolute',
    left: rect.left + 'px',
    width: rect.width + 'px',
    top: '4px',
    height: (rowHeight - 8) + 'px',
    background: barColor(bar.status),
    borderRadius: '999px',
    color: 'var(--el-color-white)',
    fontSize: '11px',
    padding: '0 8px',
    overflow: 'hidden',
    cursor: 'pointer',
    opacity: bar.status === 'pending' ? 0.66 : 1,
    border: bar.scheduled ? 'none' : '1px dashed var(--el-color-warning)'
  }
}

/** 实际开始标记：在计划跨度内的相对位置（0~100%） */
const actualMarkStyle = (bar: any): CSSProperties => {
  const start = parseDateLoose(bar.start)
  const actual = parseDateLoose(bar.actual_start)
  const end = parseDateLoose(bar.end)
  if (!start || !actual || !end || end.getTime() <= start.getTime()) return {}
  const ratio = Math.max(0, Math.min(100, ((actual.getTime() - start.getTime()) / (end.getTime() - start.getTime())) * 100))
  return { left: ratio + '%' }
}

const barColor = (status: string) => {
  const colors: Record<string, string> = {
    pending: 'var(--el-color-info)',
    ready: 'var(--el-color-primary)',
    in_progress: 'var(--el-color-warning)',
    completed: 'var(--el-color-success)',
    blocked: 'var(--el-color-danger)',
    delayed: 'var(--el-color-danger)',
    paused: 'var(--el-color-warning)'
  }
  return colors[status] || 'var(--el-color-info)'
}

const rowTitle = (bar: any) => `#${bar.id} ${bar.name || ''} · ${bar.subsystem || '未分组'}`

const barTitle = (bar: any) => [
  `${bar.name || ''}（#${bar.id}）`,
  `计划：${bar.start} → ${bar.end}`,
  `工时：${bar.duration_hours || 0}h / 跨度：${bar.duration_days || 0}天`,
  `工位：${bar.workstation_name || '-'}`,
  `状态：${bar.status || '-'}${bar.scheduled ? '' : '（未排程，按依赖推算）'}`,
  `进度：${bar.progress || 0}%（${bar.progress_basis === 'actual_elapsed' ? '按已开工时长估算' : '按状态'}）`,
  bar.actual_start ? `实际：${bar.actual_start} → ${bar.actual_end || '-'}` : ''
].filter(Boolean).join('\n')

const barText = (bar: any) => String(bar.name || '').slice(0, 12)

const loadGantt = async () => {
  if (!selectedInstance.value) return
  loading.value = true
  try {
    gantt.value = await Api.instanceGantt(selectedInstance.value)
    lastBatch.value = null
  } catch (error: any) {
    ElMessage.error('加载甘特图失败: ' + (error?.response?.data?.message || error?.message || error))
  } finally {
    loading.value = false
  }
}

const loadAll = async () => {
  loading.value = true
  try {
    instances.value = await Api.instances()
    if (instances.value.length > 0 && !selectedInstance.value) selectedInstance.value = instances.value[0].id
    alerts.value = await Api.instanceAlerts(selectedInstance.value)
  } catch (error: any) {
    ElMessage.error('加载基础数据失败: ' + (error?.response?.data?.message || error?.message || error))
  } finally {
    loading.value = false
  }
  if (selectedInstance.value) await loadGantt()
}

// ---------------- 重新排程：预览 → 确认 → 应用 → 可撤销 ----------------
const openScheduler = async () => {
  preview.value = null
  schedulerStart.value = ''
  schedulerVisible.value = true
  await previewSchedule()
}

const previewSchedule = async () => {
  if (!selectedInstance.value) return
  previewing.value = true
  try {
    const params: any = { dryRun: 1 }
    if (schedulerStart.value) params.start = schedulerStart.value
    preview.value = await Api.post(`/equipment_instances/${selectedInstance.value}/schedule`, {}, { params })
    if (!preview.value.errors?.length && !preview.value.changed_count) {
      ElMessage.info('当前计划已是最新，无需变更')
    }
  } catch (error: any) {
    const body = error?.response?.data
    if (body?.cyclic_node_ids) ElMessage.error('存在循环依赖，无法排程：节点 ' + body.cyclic_node_ids.join(', '))
    else ElMessage.error('预览失败: ' + (body?.error || body?.message || error?.message || error))
  } finally {
    previewing.value = false
  }
}

const applySchedule = async () => {
  if (!preview.value?.changed_count) return
  try {
    await ElMessageBox.confirm(
      `将变更 ${preview.value.changed_count} 个工序的计划时间（已完成节点不会改动）。确认写入？`,
      '确认应用排程',
      { type: 'warning' },
    )
  } catch {
    return
  }
  scheduling.value = true
  try {
    const params: any = {}
    if (schedulerStart.value) params.start = schedulerStart.value
    const result: any = await Api.post(`/equipment_instances/${selectedInstance.value}/schedule`, {}, { params })
    schedulerVisible.value = false
    lastBatch.value = result.batch_id ? { id: result.batch_id, batch_no: result.batch_no, written: result.written_count } : null
    await loadGantt()
    ElMessage.success(`排程完成：${result.written_count} 个节点已更新${result.batch_no ? `（批次 ${result.batch_no}，可撤销）` : ''}`)
  } catch (error: any) {
    const body = error?.response?.data
    ElMessage.error('排程失败: ' + (body?.error || body?.message || error?.message || error))
  } finally {
    scheduling.value = false
  }
}

const undoLastSchedule = async () => {
  if (!lastBatch.value) return
  try {
    await ElMessageBox.confirm(`撤销批次 ${lastBatch.value.batch_no}？计划时间将还原到排程前。`, '撤销确认', { type: 'warning' })
  } catch {
    return
  }
  undoing.value = true
  try {
    const result: any = await Api.post(`/schedule/reschedule/batches/${lastBatch.value.id}/undo`)
    lastBatch.value = null
    await loadGantt()
    ElMessage.success(`已撤销：还原 ${result.restored} 条${result.skipped ? `，跳过 ${result.skipped} 条（已被改过）` : ''}`)
  } catch (error: any) {
    ElMessage.error('撤销失败: ' + (error?.response?.data?.message || error?.message || error))
  } finally {
    undoing.value = false
  }
}

onMounted(loadAll)
</script>

<style scoped>
.page-subtitle {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  margin-top: 4px;
}

.page-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.schedule-alert {
  margin-bottom: 12px;
  border-radius: 10px;
}

.empty-wrap {
  text-align: center;
  padding: 40px;
}

.empty-wrap.small {
  padding: 20px;
}

.summary-row {
  margin-bottom: 16px;
}

.summary-row.compact {
  margin-bottom: 12px;
}

.stat-card {
  text-align: center;
}

.stat-text {
  font-size: 16px;
}

.warning-text {
  color: var(--el-color-warning);
}

.danger-text {
  color: var(--el-color-danger);
}

.info-text {
  color: var(--el-color-info);
}

.gantt-card {
  margin-bottom: 16px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  font-weight: 500;
}

.muted {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  font-weight: 400;
}

.gantt-container {
  overflow-x: auto;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
}

.gantt-header {
  display: flex;
  background: var(--el-fill-color-light);
  border-bottom: 1px solid var(--el-border-color-lighter);
  height: 34px;
  position: sticky;
  top: 0;
  z-index: 2;
}

.gantt-row-label {
  width: 260px;
  flex-shrink: 0;
  padding: 6px 10px;
  font-size: 12px;
  border-right: 1px solid var(--el-border-color-lighter);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  background: var(--el-fill-color-light);
  display: flex;
  gap: 6px;
  align-items: center;
}

.gantt-row-title {
  font-weight: 600;
}

.node-id {
  color: var(--el-text-color-secondary);
  font-size: 11px;
}

.node-name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.group-row .gantt-row-label,
.group-row .gantt-timeline {
  background: var(--el-fill-color);
}

.group-name {
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.gantt-month {
  padding: 7px 6px;
  font-size: 11px;
  border-right: 1px solid var(--el-border-color-lighter);
  text-align: center;
  color: var(--el-text-color-regular);
  overflow: hidden;
  white-space: nowrap;
}

.gantt-month small {
  color: var(--el-text-color-secondary);
  font-size: 10px;
}

.gantt-body {
  max-height: 640px;
  overflow-y: auto;
  position: relative;
}

.gantt-row {
  display: flex;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.gantt-timeline-header {
  display: flex;
  background: var(--el-fill-color-light);
}

.gantt-timeline {
  position: relative;
  background-repeat: repeat-x;
}

/* 告警点击定位后的高亮行 */
.gantt-row.row-focused {
  background: var(--el-color-warning-light-9);
  outline: 1px solid var(--el-color-warning);
  outline-offset: -1px;
}

:deep(.alert-row-clickable) {
  cursor: pointer;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.gantt-bar {
  display: flex;
  align-items: center;
  white-space: nowrap;
  transition: all 0.2s;
  position: absolute;
}

/* 实际进度：从左侧覆盖一层深色（已完成部分） */
.bar-progress {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.28);
  pointer-events: none;
}

/* 未排程：斜纹，一眼区分"推算值" */
.bar-hatch {
  position: absolute;
  inset: 0;
  background-image: repeating-linear-gradient(
    45deg,
    rgba(255, 255, 255, 0.5) 0,
    rgba(255, 255, 255, 0.5) 4px,
    transparent 4px,
    transparent 8px
  );
  pointer-events: none;
}

.bar-text {
  position: relative;
  z-index: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bar-actual-mark {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 2px;
  background: var(--el-color-danger);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.8);
  pointer-events: none;
}

.gantt-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--el-text-color-regular);
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.legend-progress {
  margin-left: auto;
}

.lg-plan,
.lg-actual,
.lg-unscheduled,
.lg-today {
  display: inline-block;
  width: 18px;
  height: 10px;
  border-radius: 4px;
}

.lg-plan {
  background: var(--el-color-primary-light-5);
}

.lg-actual {
  background: linear-gradient(90deg, var(--el-color-primary) 0 50%, var(--el-color-primary-light-5) 50% 100%);
}

.lg-unscheduled {
  background: repeating-linear-gradient(
    45deg,
    var(--el-color-warning-light-5) 0,
    var(--el-color-warning-light-5) 4px,
    transparent 4px,
    transparent 8px
  );
  border: 1px dashed var(--el-color-warning);
}

.lg-today {
  width: 2px;
  height: 14px;
  border-radius: 0;
  background: var(--el-color-danger);
}

.gantt-bar:hover {
  filter: brightness(1.05);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
}

.gantt-today-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--el-color-danger);
  opacity: 0.65;
  z-index: 1;
  pointer-events: none;
}

.gantt-today-label {
  position: absolute;
  top: 0;
  left: 3px;
  font-size: 10px;
  color: var(--el-color-danger);
  background: var(--el-bg-color);
  padding: 0 2px;
  white-space: nowrap;
}

.scheduler-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.scheduler-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}

.plan-changed {
  color: var(--el-color-warning);
  font-weight: 500;
}
</style>
