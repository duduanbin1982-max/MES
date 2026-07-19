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
        <el-button type="primary" :loading="scheduling" :disabled="!selectedInstance" @click="runScheduler">重新排程</el-button>
      </div>
    </div>

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
            <div class="stat-value">{{ gantt.total_days || 0 }} 天</div>
            <div class="stat-label">{{ gantt.total_weeks || 0 }} 周 / {{ gantt.total_hours || 0 }}h</div>
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
            <div class="stat-label">告警</div>
            <div class="stat-value warning-text">{{ alerts.by_severity?.warning || 0 }}</div>
            <div class="stat-label">warning</div>
          </div>
        </el-col>
      </el-row>

      <el-card class="gantt-card">
        <template #header>
          <div class="card-header">
            <span><el-icon><DataAnalysis /></el-icon> 子系统分组甘特</span>
            <span class="muted">计划：{{ gantt.project_start || '-' }} → {{ gantt.project_end || '-' }}</span>
          </div>
        </template>

        <div v-if="!displayRows.length" class="empty-wrap small">
          <el-empty description="该项目暂无可展示工序" :image-size="80" />
        </div>
        <div v-else class="gantt-container">
          <div class="gantt-header">
            <div class="gantt-row-label gantt-row-title">节点</div>
            <div class="gantt-timeline-header" :style="{ width: timelineWidth + 'px' }">
              <div v-for="month in months" :key="month.label + month.date" class="gantt-month" :style="{ width: monthWidth + 'px' }">
                {{ month.label }}
              </div>
            </div>
          </div>

          <div class="gantt-body">
            <div
              v-for="row in displayRows"
              :key="row.row_key"
              class="gantt-row"
              :class="{ 'group-row': row.type === 'group' }"
              :style="{ height: (row.type === 'group' ? groupRowHeight : rowHeight) + 'px' }"
            >
              <div class="gantt-row-label">
                <template v-if="row.type === 'group'">
                  <span class="group-name">{{ row.name }}</span>
                  <el-tag size="small" type="info">{{ row.count }} 项</el-tag>
                </template>
                <template v-else>
                  <span class="node-id">#{{ row.id }}</span>
                  <span class="node-name">{{ row.name }}</span>
                  <el-tag v-if="!row.scheduled" size="small" type="warning">未排程</el-tag>
                </template>
              </div>
              <div class="gantt-timeline" :style="{ width: timelineWidth + 'px' }">
                <div
                  v-if="row.type === 'bar'"
                  class="gantt-bar"
                  :style="barStyle(row)"
                  :title="barTitle(row)"
                >
                  <span>{{ barText(row) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </el-card>

      <el-card>
        <template #header>
          <span><el-icon><Bell /></el-icon> 系统告警</span>
        </template>
        <el-row :gutter="16" class="summary-row compact">
          <el-col :span="8"><div class="stat-card"><div class="stat-label">紧急</div><div class="stat-value danger-text">{{ alerts.by_severity?.danger || 0 }}</div></div></el-col>
          <el-col :span="8"><div class="stat-card"><div class="stat-label">警告</div><div class="stat-value warning-text">{{ alerts.by_severity?.warning || 0 }}</div></div></el-col>
          <el-col :span="8"><div class="stat-card"><div class="stat-label">信息</div><div class="stat-value info-text">{{ alerts.by_severity?.info || 0 }}</div></div></el-col>
        </el-row>
        <el-table :data="alerts.alerts || []" stripe size="small" empty-text="暂无告警">
          <el-table-column label="级别" width="80">
            <template #default="{ row }">
              <el-tag :type="row.severity === 'danger' ? 'danger' : row.severity === 'warning' ? 'warning' : 'info'" size="small">
                {{ row.severity }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="type" label="类型" width="180" />
          <el-table-column prop="message" label="内容" min-width="300" />
        </el-table>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Api } from '../api'

const instances = ref<any[]>([])
const selectedInstance = ref<any>(undefined)
const gantt = ref<any>({})
const alerts = ref<any>({})
const loading = ref(false)
const scheduling = ref(false)

const rowHeight = 28
const groupRowHeight = 30
const dayWidth = 8
const monthWidth = 30 * dayWidth

const parseDate = (value: any) => {
  if (!value) return null
  const raw = String(value).trim()
  const normalized = raw.length === 10 ? `${raw}T00:00:00` : raw.replace(' ', 'T')
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
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

const months = computed(() => {
  if (!gantt.value.project_start || !gantt.value.total_days) return []
  const result = []
  const start = parseDate(gantt.value.project_start)
  if (!start) return []
  const numMonths = Math.max(1, Math.ceil((gantt.value.total_days || 1) / 30) + 1)
  for (let index = 0; index < numMonths; index++) {
    const date = new Date(start)
    date.setMonth(date.getMonth() + index)
    result.push({ label: `${date.getFullYear()}-${date.getMonth() + 1}月`, date: date.toISOString().slice(0, 10) })
  }
  return result
})

const timelineWidth = computed(() => Math.max(800, months.value.length * monthWidth))

const barStyle = (bar: any) => {
  const projectStart = parseDate(gantt.value.project_start)
  const barStart = parseDate(bar.start || bar.planned_start)
  const barEnd = parseDate(bar.end || bar.planned_end)
  if (!projectStart || !barStart || !barEnd) return {}
  const offsetDays = Math.max(0, (barStart.getTime() - projectStart.getTime()) / (1000 * 60 * 60 * 24))
  const widthDays = Math.max(0.5, (barEnd.getTime() - barStart.getTime()) / (1000 * 60 * 60 * 24))
  return {
    position: 'absolute',
    left: (offsetDays * dayWidth) + 'px',
    width: Math.max(12, widthDays * dayWidth) + 'px',
    top: '4px',
    height: (rowHeight - 8) + 'px',
    background: barColor(bar.status),
    borderRadius: '999px',
    color: 'var(--el-color-white)',
    fontSize: '11px',
    padding: '0 8px',
    overflow: 'hidden',
    cursor: 'pointer',
    opacity: bar.status === 'pending' ? 0.66 : 1
  }
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

const barTitle = (bar: any) => `${bar.name}
计划：${bar.start} → ${bar.end}
工时：${bar.duration_hours || 0}h / 跨度：${bar.duration_days || 0}天
工位：${bar.workstation_name || '-'}
状态：${bar.status || '-'}`

const barText = (bar: any) => {
  if ((bar.duration_days || 0) < 2) return ''
  return String(bar.name || '').slice(0, 12)
}

const loadGantt = async () => {
  if (!selectedInstance.value) return
  loading.value = true
  try {
    gantt.value = await Api.instanceGantt(selectedInstance.value)
  } catch (error: any) {
    ElMessage.error('加载甘特图失败: ' + (error?.message || error))
  } finally {
    loading.value = false
  }
}

const loadAll = async () => {
  loading.value = true
  try {
    instances.value = await Api.instances()
    if (instances.value.length > 0 && !selectedInstance.value) selectedInstance.value = instances.value[0].id
    alerts.value = await Api.dashboardAlerts()
  } catch (error: any) {
    ElMessage.error('加载基础数据失败: ' + (error?.message || error))
  } finally {
    loading.value = false
  }
  if (selectedInstance.value) await loadGantt()
}

const runScheduler = async () => {
  if (!selectedInstance.value) return
  try {
    await ElMessageBox.confirm(
      '重新排程会覆盖该项目工序的计划开始/结束时间。建议确认 BOM、工艺路线、工位和依赖关系已经维护完整。',
      '确认重新排程',
      { type: 'warning', confirmButtonText: '开始排程', cancelButtonText: '取消' }
    )
  } catch (_error) {
    return
  }

  scheduling.value = true
  try {
    const result = await Api.scheduleInstance(selectedInstance.value)
    await loadGantt()
    ElMessage.success(`排程完成：${result.written_count || 0} 个节点已更新`)
  } catch (error: any) {
    ElMessage.error('排程失败: ' + (error.response?.data?.error || error.message || error))
  } finally {
    scheduling.value = false
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
  z-index: 1;
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
}

.gantt-body {
  max-height: 640px;
  overflow-y: auto;
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
}

.gantt-bar {
  display: flex;
  align-items: center;
  white-space: nowrap;
  transition: all 0.2s;
}

.gantt-bar:hover {
  filter: brightness(1.05);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
}
</style>
