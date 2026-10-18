<template>
  <div class="page">
    <div class="page-header">
      <div>
        <div class="page-title"><el-icon><Switch /></el-icon> 多项目资源平衡</div>
        <div class="page-subtitle">按时间窗口分析工位产能、资源占用、跨项目抢占和日负荷超载。</div>
      </div>
      <div class="page-actions">
        <el-date-picker v-model="startDate" type="date" value-format="YYYY-MM-DD" style="width: 150px" @change="load" />
        <el-input-number v-model="days" :min="7" :max="180" :step="7" size="small" style="width: 120px" @change="load" />
        <el-button type="primary" :loading="loading" @click="load">刷新</el-button>
      </div>
    </div>

    <el-alert
      class="range-alert"
      type="info"
      :closable="false"
      show-icon
      :title="`分析窗口：${dataRange.start || startDate} → ${dataRange.end || '-'}，只统计窗口内发生重叠的工单/工序。`"
    />

    <el-row :gutter="12" class="summary-row" v-loading="loading">
      <el-col :span="6"><div class="stat-card"><div class="stat-label">项目</div><div class="stat-value">{{ summary.instance_count || 0 }}</div></div></el-col>
      <el-col :span="6"><div class="stat-card"><div class="stat-label">窗口工时</div><div class="stat-value">{{ summary.total_hours || 0 }}h</div></div></el-col>
      <el-col :span="6"><div class="stat-card"><div class="stat-label">工位数</div><div class="stat-value">{{ summary.workstation_count || 0 }}</div></div></el-col>
      <el-col :span="6"><div class="stat-card"><div class="stat-label">冲突</div><div class="stat-value" :class="{ danger: (summary.conflict_count || 0) > 0, success: (summary.conflict_count || 0) === 0 }">{{ summary.conflict_count || 0 }}</div></div></el-col>
    </el-row>

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
        <el-col :span="24" v-if="!topBottlenecks.length"><el-empty description="窗口内暂无工位负荷" :image-size="60" /></el-col>
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
          <span class="stat-label">点击格子查看当日在制任务并可改派</span>
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
              :class="heatLevelClass(cellOf(row, day).level)"
              :title="`${row.name} ${day}：${cellText(cellOf(row, day))}`"
              @click="openCell(row, day)"
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
          <el-tag v-if="conflicts.length === 0" type="success" size="small">无冲突</el-tag>
        </div>
      </template>
      <el-table :data="conflicts" stripe size="small" empty-text="无资源冲突">
        <el-table-column label="类型" width="130">
          <template #default="{ row }">
            <el-tag :type="row.type === 'capacity_overload' || row.type === 'cross_instance' ? 'danger' : 'warning'" size="small">
              {{ conflictLabel(row.type) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="workstation" label="工位" width="140" />
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
        <el-table-column prop="overlap_hours" label="重叠/超载小时" width="140" />
      </el-table>
    </el-card>

    <el-dialog v-model="cellDlg.visible" :title="`${cellDlg.wsName} · ${cellDlg.day}`" width="760px">
      <el-alert v-if="cellDlg.items.length === 0" type="info" :closable="false" title="该工位当天没有在制任务" />
      <el-table v-else :data="cellDlg.items" size="small" border>
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
            <el-select v-model="row._target" size="small" clearable placeholder="选择目标工位" :disabled="row.type === 'work_order'">
              <el-option v-for="ws in workstations" :key="ws.id" :label="ws.name" :value="ws.id" :disabled="Number(ws.id) === Number(cellDlg.wsId)" />
            </el-select>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="cellDlg.workOrderCount" class="stat-label" style="margin-top: 8px">
        注：{{ cellDlg.workOrderCount }} 条是工单级任务，改派需在工单页调整所属工位；这里只能改工序（process_node）。
      </div>
      <template #footer>
        <el-button @click="cellDlg.visible = false">取消</el-button>
        <el-button type="primary" :loading="cellDlg.saving" @click="saveReassign">保存改派</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'
import {
  cellText,
  formatHours,
  heatLevelClass,
  limitDays,
  loadToneClass,
  peakDayText,
  pickCellItems,
} from '../domain/workload'

const now = new Date()
const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
// P2-1：演示/上线初期数据集中在 6 月，默认窗口取数据月，避免一打开就是空表（用户可随时改）
const DATA_START_HINT = '2026-06-01'
const startDate = ref(DATA_START_HINT || monthStart)
const days = ref(30)
const loading = ref(false)
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
const cellDlg = ref<any>({ visible: false, saving: false, wsId: null, wsName: '', day: '', items: [], workOrderCount: 0 })

const topBottlenecks = computed(() => bottlenecks.value.top_overloaded || [])
const topIdle = computed(() => bottlenecks.value.top_idle || [])
const hasOverload = computed(() => topBottlenecks.value.some((item: any) => Number(item.peak_utilization_pct) >= 100))
const limited = computed(() => limitDays(heatDays.value, 31))
const shownDays = computed(() => limited.value.shown)
const hiddenDays = computed(() => limited.value.hidden)
const heatRows = computed(() => heatGrid.value || [])

const cellOf = (row: any, day: string) => (row.cells || []).find((cell: any) => cell.day === day) || { day, busy_hours: 0, utilization_pct: 0, level: 'idle' }

const openCell = (row: any, day: string) => {
  const cellItems = pickCellItems(items.value, row.ws_id, day).map((item: any) => ({ ...item, _target: null }))
  cellDlg.value = {
    visible: true,
    saving: false,
    wsId: row.ws_id,
    wsName: row.name,
    day,
    items: cellItems,
    workOrderCount: cellItems.filter((item: any) => item.type === 'work_order').length,
  }
}

const saveReassign = async () => {
  const targets = cellDlg.value.items.filter((item: any) => item.type !== 'work_order' && item._target)
  if (!targets.length) { ElMessage.warning('没有需要改派的工序'); return }
  cellDlg.value.saving = true
  try {
    for (const item of targets) {
      await api.put(`/process_nodes/${item.source_id}/assign`, { required_workstation_id: item._target })
    }
    ElMessage.success(`已改派 ${targets.length} 道工序`)
    cellDlg.value.visible = false
    await load()
  } catch (error: any) {
    ElMessage.error('改派失败: ' + (error?.response?.data?.message || error?.message || error))
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
    const data = await api.get('/resources/gantt', { params: { start_date: startDate.value, days: days.value } })
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
</style>
