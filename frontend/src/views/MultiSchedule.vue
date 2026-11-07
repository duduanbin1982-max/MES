<template>
  <div class="page">
    <PageToolbar class="page-header">
      <div>
        <div class="page-title"><el-icon><Switch /></el-icon> 多项目资源平衡</div>
        <div class="page-subtitle">按时间窗口分析工位产能、资源占用、跨项目抢占和日负荷超载。</div>
      </div>
      <div class="page-actions">
        <el-select
          v-model="instanceFilter"
          clearable
          filterable
          placeholder="全部项目"
          size="small"
          style="width: 220px"
          @change="onFilterChange"
        >
          <el-option
            v-for="instance in instances"
            :key="instance.id"
            :label="instance.instance_code + ' | ' + (instance.instance_name || '')"
            :value="instance.id"
          />
        </el-select>
        <el-date-picker v-model="startDate" type="date" value-format="YYYY-MM-DD" style="width: 140px" @change="onFilterChange" />
        <el-input-number v-model="days" :min="7" :max="180" :step="7" size="small" style="width: 110px" @change="onFilterChange" />
        <el-switch v-model="includeCompleted" size="small" inline-prompt active-text="含历史" inactive-text="仅未来" @change="onFilterChange" />
        <el-button type="primary" :loading="loading" @click="load">刷新</el-button>
      </div>
    </PageToolbar>

    <el-alert
      class="range-alert"
      type="info"
      :closable="false"
      show-icon
      :title="`分析窗口：${dataRange.start || startDate} → ${dataRange.end || '-'}，只统计窗口内发生重叠的工单/工序。`"
    />

    <el-row :gutter="12" class="summary-row" v-loading="loading">
      <el-col :span="6"><div class="stat-card"><div class="stat-label">项目</div><div class="stat-value">{{ summary.instance_count || 0 }}</div></div></el-col>
      <el-col :span="6"><div class="stat-card"><div class="stat-label">窗口占用工时</div><div class="stat-value">{{ formatHours(summary.window_busy_hours) }}</div><div class="stat-label">任务工时 {{ formatHours(summary.total_hours) }}</div></div></el-col>
      <el-col :span="6"><div class="stat-card"><div class="stat-label">工位数</div><div class="stat-value">{{ summary.workstation_count || 0 }}</div></div></el-col>
      <el-col :span="6"><div class="stat-card"><div class="stat-label">冲突</div><div class="stat-value" :class="{ danger: (summary.conflict_count || 0) > 0, success: (summary.conflict_count || 0) === 0 }">{{ summary.conflict_count || 0 }}</div><div class="stat-label">超载 {{ overloadCount }} · 重叠 {{ overlapCount }}</div></div></el-col>
    </el-row>
    <el-alert
      v-if="(summary.excluded_completed_count || 0) > 0 && !includeCompleted"
      class="range-alert"
      type="info"
      :closable="false"
      show-icon
      :title="`已自动排除 ${summary.excluded_completed_count} 条已完成/已取消任务（避免历史占用冒充未来负荷）；需要复盘时打开右上「含历史」`"
    />

    <el-card class="content-card">
      <template #header>
        <div class="card-header">
          <span><el-icon><Aim /></el-icon> 最紧的三个工位（按峰值利用率）</span>
          <el-tag v-if="hasOverload" type="danger" size="small">存在超载</el-tag>
          <el-tag v-else type="success" size="small">未超载</el-tag>
        </div>
      </template>
      <el-row :gutter="12">
        <el-col :span="8" v-for="(item, index) in topBottlenecks" :key="item.ws_id">
          <div class="stat-card bottleneck-card">
            <div class="stat-label">#{{ index + 1 }} {{ item.name }}</div>
            <div class="stat-value" :class="loadToneClass(item.peak_utilization_pct)">{{ item.peak_utilization_pct || 0 }}%</div>
            <div class="stat-label stat-caption">
              峰值日 {{ peakDayText(item.peak_day) }} · 平均 {{ item.avg_utilization_pct || 0 }}% · 已用 {{ formatHours(item.total_busy_hours) }} / 天 {{ formatHours(item.daily_capacity_hours) }}
            </div>
          </div>
        </el-col>
        <el-col :span="24" v-if="!topBottlenecks.length"><PageState state="empty" compact :show-action="false" description="窗口内暂无工位负荷" /></el-col>
      </el-row>
      <div v-if="topIdle.length" class="idle-line">
        <span class="stat-label">最空闲：</span>
        <el-tag v-for="item in topIdle" :key="item.ws_id" size="small" class="tag-gap">{{ item.name }}（峰值 {{ item.peak_utilization_pct || 0 }}%）</el-tag>
      </div>
    </el-card>

    <el-card class="content-card">
      <template #header>
        <div class="card-header">
          <span><el-icon><Grid /></el-icon> 工位 × 日 负荷热力图</span>
          <span class="stat-label">点击格子查看任务｜**拖拽格子到另一工位** 或 在弹窗里把任务拖到工位即可改派</span>
        </div>
      </template>
      <el-alert v-if="hiddenDays > 0" type="info" :closable="false" class="range-alert"
        :title="`窗口共 ${hiddenDays + shownDays.length} 天，仅展示前 ${shownDays.length} 天（缩短分析窗口可看全）`" />
      <el-table :data="heatRows" size="small" border empty-text="暂无负荷数据" :max-height="420">
        <el-table-column prop="name" label="工位" width="130" fixed />
        <el-table-column label="车间" width="80" fixed>
          <template #default="{ row }">{{ row.workshop || '-' }}</template>
        </el-table-column>
        <el-table-column v-for="day in shownDays" :key="day" :label="day.slice(5)" width="70" align="center">
          <template #default="{ row }">
            <span
              class="heat-cell"
              :class="[heatLevelClass(cellOf(row, day).level), { 'drop-target': cellDlg.dragSource }]"
              :title="`${row.name} ${day}：${cellText(cellOf(row, day))}（可拖到其它工位改派）`"
              draggable="true"
              @click="openCell(row, day)"
              @dragstart="onCellDragStart(row, day)"
              @dragover.prevent="onCellDragOver(row, day)"
              @drop.prevent="onCellDrop(row, day)"
            >{{ cellOf(row, day).utilization_pct }}%</span>
          </template>
        </el-table-column>
        <el-table-column label="合计" width="100" align="center">
          <template #default="{ row }">
            <span :class="loadToneClass(row.avg_utilization_pct)">{{ row.avg_utilization_pct }}%</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card class="content-card">
      <template #header><span><el-icon><DataAnalysis /></el-icon> 工位利用率 TOP 10</span></template>
      <el-table :data="workstationUtil.slice(0, 10)" stripe size="small" empty-text="暂无工位负荷数据">
        <el-table-column prop="name" label="工位" width="180" />
        <el-table-column prop="daily_capacity_hours" label="可用工时/天" width="120" />
        <el-table-column prop="total_busy_hours" label="已用工时" width="120" sortable />
        <el-table-column label="平均利用率" width="190">
          <template #default="{ row }">
            <el-progress :percentage="row.avg_utilization_pct || 0" :status="row.avg_utilization_pct >= 100 ? 'exception' : row.avg_utilization_pct >= 80 ? 'warning' : 'success'" />
          </template>
        </el-table-column>
        <el-table-column label="峰值日" width="150">
          <template #default="{ row }">{{ row.peak_day?.day || '-' }} ({{ row.peak_day?.busy_hours || 0 }}h)</template>
        </el-table-column>
        <el-table-column label="峰值利用率" width="120">
          <template #default="{ row }">
            <el-tag :type="row.peak_utilization_pct >= 100 ? 'danger' : row.peak_utilization_pct >= 80 ? 'warning' : 'info'" size="small">{{ row.peak_utilization_pct || 0 }}%</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card class="content-card">
      <template #header><span><el-icon><OfficeBuilding /></el-icon> 各项目占用工位</span></template>
      <el-table :data="instanceBreakdown" stripe size="small" empty-text="暂无项目占用数据">
        <el-table-column prop="instance_code" label="项目" width="140" />
        <el-table-column prop="instance_name" label="名称" min-width="180" />
        <el-table-column prop="item_count" label="节点数" width="100" sortable />
        <el-table-column prop="total_hours" label="窗口工时" width="120" sortable />
        <el-table-column prop="workstation_count" label="用工位" width="100" />
        <el-table-column label="占用工位">
          <template #default="{ row }">
            <el-tag v-for="workstation in row.workstations" :key="workstation" size="small" class="tag-gap">{{ workstation }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card>
      <template #header>
        <div class="card-header">
          <span><el-icon><Warning /></el-icon> 资源冲突 ({{ conflicts.length }})</span>
          <div class="conflict-tools">
            <el-select v-model="conflictType" size="small" style="width: 150px" placeholder="全部类型">
              <el-option label="全部类型" value="" />
              <el-option label="产能超载" value="capacity_overload" />
              <el-option label="跨项目抢占" value="cross_instance" />
              <el-option label="同工位重叠" value="same_workstation" />
            </el-select>
            <el-tag v-if="conflicts.length === 0" type="success" size="small">无冲突</el-tag>
          </div>
        </div>
      </template>
      <el-alert
        v-if="shownConflicts.length < conflicts.length"
        type="info"
        :closable="false"
        class="range-alert"
        :title="`共 ${conflicts.length} 条冲突，表格最多展示 ${CONFLICT_LIMIT} 条（用左侧类型筛选可缩小范围）`"
      />
      <el-table :data="shownConflicts" stripe size="small" empty-text="无资源冲突（当前筛选条件）">
        <el-table-column label="类型" width="130">
          <template #default="{ row }">
            <el-tag :type="row.type === 'capacity_overload' || row.type === 'cross_instance' ? 'danger' : 'warning'" size="small">
              {{ conflictLabel(row.type) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="workstation" label="工位" width="140" />
        <el-table-column label="涉及" width="150">
          <template #default="{ row }">
            <template v-if="row.items">
              <el-tag v-for="code in row.instance_codes" :key="code" size="small" class="tag-gap">{{ code }}</el-tag>
              <div class="stat-label">{{ row.item_count }} 个任务{{ row.peak_concurrency ? ` · 峰值并发 ${row.peak_concurrency}` : '' }}</div>
            </template>
            <span v-else class="stat-label">{{ row.day }}</span>
          </template>
        </el-table-column>
        <el-table-column label="冲突项" min-width="360">
          <template #default="{ row }">
            <div v-if="row.items">
              <div v-for="(item, index) in row.items" :key="index" class="conflict-item">
                <el-tag size="small" class="tag-gap">{{ item.instance }}</el-tag>
                {{ item.node || item.name }} ({{ item.start }} → {{ item.end }})
              </div>
            </div>
            <div v-else class="conflict-item">{{ row.day }}：{{ row.busy_hours }}h / 产能 {{ row.capacity_hours }}h，利用率 {{ row.utilization_pct }}%</div>
          </template>
        </el-table-column>
        <el-table-column prop="overlap_hours" label="重叠/超载小时" width="140" sortable />
      </el-table>
    </el-card>

    <el-dialog v-model="cellDlg.visible" :title="`${cellDlg.wsName} · ${cellDlg.day}`" width="760px">
      <el-alert v-if="cellDlg.items.length === 0" type="info" :closable="false" title="该工位当天没有在制任务" />
      <el-table v-else :data="cellDlg.items" size="small" border row-key="id">
        <el-table-column label="拖" width="46" align="center">
          <template #default="{ row }">
            <span v-if="canWrite && canReassign(row)" class="drag-handle" draggable="true" title="拖到下方工位即可改派"
              @dragstart="onTaskDragStart(row)">⋮⋮</span>
            <span v-else class="stat-label">—</span>
          </template>
        </el-table-column>
        <el-table-column label="任务" min-width="200">
          <template #default="{ row }">
            {{ row.name }}
            <el-tag size="small" type="info" class="tag-gap">{{ row.type === 'work_order' ? '工单' : '工序' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="instance_code" label="项目" width="130" />
        <el-table-column label="工时" width="80" align="right">
          <template #default="{ row }">{{ formatHours(row.hours) }}</template>
        </el-table-column>
        <el-table-column label="改派到" width="220">
          <template #default="{ row }">
            <el-select v-model="row._target" size="small" clearable placeholder="选择目标工位" :disabled="!canReassign(row)">
              <el-option v-for="ws in workstations" :key="ws.id" :label="ws.name" :value="ws.id" :disabled="Number(ws.id) === Number(cellDlg.wsId)" />
            </el-select>
          </template>
        </el-table-column>
      </el-table>
      <el-alert
        v-if="cellDlg.items.some(canReassign) && !canWrite"
        type="warning"
        :closable="false"
        show-icon
        class="range-alert"
        title="当前账号没有改派权限（需要 process:write / work_order:write 或车间主任、管理员），可查看但不能保存"
      />
      <div v-if="canWrite && cellDlg.items.some(canReassign)" class="drop-zones" @dragover.prevent>
        <div class="stat-label">拖到工位（把左侧任务拖到下面任一工位 = 改派）：</div>
        <span v-for="ws in workstations" :key="'dz' + ws.id" class="drop-zone"
          :class="{ 'drop-active': cellDlg.dragTaskId }"
          @dragover.prevent="cellDlg.hoverWs = ws.id"
          @dragleave="cellDlg.hoverWs = null"
          @drop.prevent="onTaskDrop(ws)">
          {{ ws.name }}<el-tag v-if="Number(ws.id) === Number(cellDlg.wsId)" size="small" type="info" class="tag-gap">源工位</el-tag>
        </span>
      </div>
      <div v-if="cellDlg.workOrderCount" class="stat-label" style="margin-top: 8px">
        注：{{ cellDlg.workOrderCount }} 条是工单级任务，保存时会改「工单所属工位」（PUT /work_orders/:id/workstation），
        不影响工序级排程（process_node 走 /assign）。
      </div>
      <template #footer>
        <el-button @click="cellDlg.visible = false">取消</el-button>
        <el-button type="primary" :loading="cellDlg.saving" :disabled="!canWrite" @click="saveReassign">保存改派</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'
import { useAuthStore } from '../stores/auth'
import {
  applyPresetTarget,
  canReassign,
  cellText,
  dropHint,
  formatHours,
  heatLevelClass,
  limitDays,
  loadToneClass,
  peakDayText,
  pickCellItems,
  reassignRequest,
} from '../domain/workload'

// 2026-11-05（审计 F-05）：去掉硬编码 2026-06-01 —— 默认当前月，并记住上次窗口/筛选
const WINDOW_STORAGE_KEY = 'factory-mes:multi-schedule:window'
const readWindow = () => {
  const fallback = {
    start: new Date().toISOString().slice(0, 8) + '01',
    days: 30,
    instance_id: null as number | null,
    include_completed: false,
  }
  try {
    const raw = localStorage.getItem(WINDOW_STORAGE_KEY)
    if (!raw) return fallback
    const saved = JSON.parse(raw)
    return {
      start: typeof saved.start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(saved.start) ? saved.start : fallback.start,
      days: Number.isFinite(Number(saved.days)) ? Math.min(180, Math.max(7, Number(saved.days))) : fallback.days,
      instance_id: saved.instance_id ? Number(saved.instance_id) : null,
      include_completed: Boolean(saved.include_completed),
    }
  } catch {
    return fallback
  }
}
const savedWindow = readWindow()
const startDate = ref(savedWindow.start)
const days = ref(savedWindow.days)
const instanceFilter = ref<number | null>(savedWindow.instance_id)
const includeCompleted = ref(savedWindow.include_completed)
const loading = ref(false)
const instances = ref<any[]>([])
const auth = useAuthStore()
// 改派权限：process:write（工序改工位）或 work_order:write（工单改工位）；车间主任/管理员天然有
const canWrite = computed(() => Boolean(auth.hasAnyPerm('process:write', 'work_order:write')) || ['admin', 'foreman'].includes(auth.role))
const onFilterChange = () => {
  try {
    localStorage.setItem(WINDOW_STORAGE_KEY, JSON.stringify({
      start: startDate.value,
      days: days.value,
      instance_id: instanceFilter.value,
      include_completed: includeCompleted.value,
    }))
  } catch { /* 隐私模式忽略 */ }
  load()
}
const summary = ref<any>({})
const workstationUtil = ref<any[]>([])
const instanceBreakdown = ref<any[]>([])
const conflicts = ref<any[]>([])
const dataRange = ref<any>({})
// P2-1：Top3 最紧工位 + 工位×日热力图 + 改派
const bottlenecks = ref<any>({ top_overloaded: [], top_idle: [] })
const heatGrid = ref<any[]>([])
const heatDays = ref<string[]>([])
const items = ref<any[]>([])
const workstations = ref<any[]>([])
const cellDlg = ref<any>({
  visible: false, saving: false, wsId: null, wsName: '', day: '', items: [], workOrderCount: 0,
  // 拖拽改派状态：dragSource=被拖的格子 {wsId, day}；dragTaskId=被拖的任务；hoverWs=悬停目标
  dragSource: null, dragTaskId: null, hoverWs: null,
})

const topBottlenecks = computed(() => bottlenecks.value.top_overloaded || [])
const topIdle = computed(() => bottlenecks.value.top_idle || [])
// 2026-11-05（审计 F-04）：超载判定不再只看 Top3 —— 以冲突表/热力图为准，避免"未超载"误报
const hasOverload = computed(() =>
  conflicts.value.some((item: any) => item.type === 'capacity_overload')
  || heatRows.value.some((row: any) => (row.cells || []).some((cell: any) => Number(cell.utilization_pct) >= 100)),
)
const overloadCount = computed(() => conflicts.value.filter((item: any) => item.type === 'capacity_overload').length)
const overlapCount = computed(() => conflicts.value.filter((item: any) => item.type !== 'capacity_overload').length)
const CONFLICT_LIMIT = 100
const conflictType = ref('')
const shownConflicts = computed(() => {
  const list = conflictType.value ? conflicts.value.filter((item: any) => item.type === conflictType.value) : conflicts.value
  return list.slice(0, CONFLICT_LIMIT)
})
const limited = computed(() => limitDays(heatDays.value, 31))
const shownDays = computed(() => limited.value.shown)
const hiddenDays = computed(() => limited.value.hidden)
const heatRows = computed(() => heatGrid.value || [])

const cellOf = (row: any, day: string) => (row.cells || []).find((cell: any) => cell.day === day) || { day, busy_hours: 0, utilization_pct: 0, level: 'idle' }

const openCell = (row: any, day: string, presetTarget: number | null = null) => {
  const cellItems = pickCellItems(items.value, row.ws_id, day).map((item: any) => ({ ...item, _target: null }))
  cellDlg.value = {
    visible: true,
    saving: false,
    wsId: row.ws_id,
    wsName: row.name,
    day,
    items: presetTarget ? applyPresetTarget(cellItems, presetTarget) : cellItems,
    workOrderCount: cellItems.filter((item: any) => item.type === 'work_order').length,
    dragSource: null,
    dragTaskId: null,
    hoverWs: null,
  }
}

// ---- 拖拽改派（P2-1 第二步）
const onCellDragStart = (row: any, day: string) => {
  cellDlg.value.dragSource = { wsId: row.ws_id, day, name: row.name }
  cellDlg.value.dragTaskId = null
}

const onCellDragOver = (row: any, day: string) => {
  // 仅用于视觉反馈：悬停到目标格时高亮
  cellDlg.value.hoverWs = row.ws_id
  cellDlg.value.hoverDay = day
}

const onCellDrop = (row: any, day: string) => {
  const source = cellDlg.value.dragSource
  cellDlg.value.hoverWs = null
  cellDlg.value.hoverDay = null
  if (!source) return
  const hint = dropHint(source.wsId, row.ws_id, row.name)
  cellDlg.value.dragSource = null
  if (!hint.ok) { ElMessage.info(hint.text); return }
  // 打开源格子弹窗，并把目标工位预置到每条工序上，用户确认后保存
  const sourceRow = heatRows.value.find((item: any) => Number(item.ws_id) === Number(source.wsId))
  if (!sourceRow) return
  openCell(sourceRow, source.day, row.ws_id)
  ElMessage.warning(hint.text)
}

const onTaskDragStart = (item: any) => {
  if (!canReassign(item)) return
  cellDlg.value.dragTaskId = item.id
  cellDlg.value.dragSource = null
}

const onTaskDrop = (ws: any) => {
  const taskId = cellDlg.value.dragTaskId
  cellDlg.value.hoverWs = null
  if (!taskId) return
  if (Number(ws.id) === Number(cellDlg.value.wsId)) {
    ElMessage.info('目标就是源工位，无需改派')
    return
  }
  cellDlg.value.items = cellDlg.value.items.map((item: any) =>
    item.id === taskId && canReassign(item) ? { ...item, _target: ws.id } : item)
  cellDlg.value.dragTaskId = null
  ElMessage.success(`已把该任务预置到「${ws.name}」，确认后点"保存改派"`)
}

const saveReassign = async () => {
  const targets = cellDlg.value.items.filter((item: any) => canReassign(item) && item._target)
  if (!targets.length) { ElMessage.warning('没有需要改派的任务'); return }
  const targetName = (id: any) => {
    const ws = workstations.value.find((item: any) => Number(item.id) === Number(id))
    return ws ? ws.name : `工位 ${id}`
  }
  const groups = new Map<string, number>()
  for (const item of targets) {
    const key = targetName(item._target)
    groups.set(key, (groups.get(key) || 0) + 1)
  }
  try {
    await ElMessageBox.confirm(
      `将把 ${targets.length} 个任务改派到：${[...groups.entries()].map(([name, count]) => `${name}（${count}）`).join('、')}。` +
      '改派只调整工位归属，不自动改期；改派后请留意目标工位是否超载。',
      '确认改派',
      { type: 'warning' },
    )
  } catch {
    return
  }
  cellDlg.value.saving = true
  const failed: string[] = []
  let okCount = 0
  try {
    for (const item of targets) {
      const request = reassignRequest(item, item._target)
      if (!request) continue
      try {
        await api.put(request.url, request.body)
        okCount += 1
      } catch (error: any) {
        const body = error?.response?.data
        const reason = body?.message || body?.error || error?.message || '未知错误'
        failed.push(`${item.name || item.id}：${reason}`)
      }
    }
    if (okCount) {
      ElMessage.success(`已改派 ${okCount} 个任务${failed.length ? `，${failed.length} 个失败` : ''}`)
    }
    if (failed.length) {
      ElMessage.warning(`部分改派失败（已成功的不回滚）：${failed.slice(0, 3).join('；')}`)
    }
    if (okCount) {
      cellDlg.value.visible = false
      await load()
    }
  } finally {
    cellDlg.value.saving = false
  }
}

const conflictLabel = (type: string) => {
  const labels: Record<string, string> = {
    cross_instance: '跨项目抢占',
    same_workstation: '同工位重叠',
    capacity_overload: '产能超载'
  }
  return labels[type] || type
}

const load = async () => {
  loading.value = true
  try {
    const params: any = { start_date: startDate.value, days: days.value }
    if (instanceFilter.value) params.instance_id = instanceFilter.value
    if (includeCompleted.value) params.include_completed = 1
    const data = await api.get('/resources/gantt', { params })
    summary.value = data.summary || {}
    workstationUtil.value = data.workstation_utilization || []
    instanceBreakdown.value = data.instance_breakdown || []
    conflicts.value = data.conflicts || []
    dataRange.value = { start: data.start_date, end: data.end_date }
    bottlenecks.value = data.bottlenecks || { top_overloaded: [], top_idle: [] }
    heatGrid.value = (data.heatmap && data.heatmap.grid) || []
    heatDays.value = (data.heatmap && data.heatmap.days) || []
    items.value = data.items || []
    workstations.value = data.workstations || []
    if (!instances.value.length) {
      try { instances.value = await api.instances() } catch { instances.value = [] }
    }
  } catch (error: any) {
    ElMessage.error('加载资源平衡失败: ' + (error?.message || error))
  } finally {
    loading.value = false
  }
}

onMounted(load)
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

.conflict-tools {
  display: flex;
  align-items: center;
  gap: 8px;
}

.range-alert,
.summary-row,
.content-card {
  margin-bottom: 12px;
}

.stat-card {
  background: var(--el-color-white);
  padding: 16px;
  border-radius: 8px;
  text-align: center;
  border: 1px solid var(--el-border-color-lighter);
}

.stat-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 6px;
}

.stat-value {
  font-size: 24px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.stat-value.danger {
  color: var(--el-color-danger);
}

.stat-value.success {
  color: var(--el-color-success);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.tag-gap {
  margin-right: 4px;
}

.conflict-item {
  font-size: 12px;
  line-height: 1.8;
}
.drag-handle { cursor: grab; font-weight: 700; letter-spacing: -2px; color: var(--el-color-primary); }
.drag-handle:active { cursor: grabbing; }
.drop-zones { margin-top: 12px; padding-top: 8px; border-top: 1px dashed var(--el-border-color); }
.drop-zone { display: inline-block; padding: 4px 10px; margin: 4px 6px 0 0; border: 1px dashed var(--el-border-color);
  border-radius: 6px; font-size: 12px; cursor: copy; }
.drop-zone.drop-active { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.heat-cell.drop-target { outline: 1px dashed var(--el-color-primary); }
</style>
