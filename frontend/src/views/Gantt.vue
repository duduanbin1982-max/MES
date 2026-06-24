<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title">📅 甘特图 + 资源平衡</div>
      <div>
        <el-select v-model="selectedInstance" placeholder="选实例" style="width: 240px; margin-right: 8px" @change="loadGantt">
          <el-option v-for="i in instances" :key="i.id" :label="i.instance_code" :value="i.id" />
        </el-select>
        <el-button @click="loadAll">刷新</el-button>
        <el-button @click="runScheduler" type="primary" :loading="scheduling">重新排程</el-button>
      </div>
    </div>

    <div v-if="!selectedInstance" style="text-align: center; padding: 40px"><el-empty description="选实例查看甘特图" /></div>

    <div v-else v-loading="loading">
      <!-- 项目总览 -->
      <el-row :gutter="16" style="margin-bottom: 16px">
        <el-col :span="6"><div class="stat-card" style="text-align:center"><div class="stat-label">项目</div><div class="stat-value" style="font-size: 16px">{{ gantt.instance?.code }}</div></div></el-col>
        <el-col :span="6"><div class="stat-card" style="text-align:center"><div class="stat-label">总工期</div><div class="stat-value">{{ gantt.total_weeks }} 周</div><div class="stat-label" style="font-size: 12px">{{ gantt.total_days }} 天 / {{ gantt.total_hours }}h</div></div></el-col>
        <el-col :span="6"><div class="stat-card" style="text-align:center"><div class="stat-label">开始</div><div class="stat-value" style="font-size: 14px">{{ gantt.project_start }}</div></div></el-col>
        <el-col :span="6"><div class="stat-card" style="text-align:center"><div class="stat-label">告警</div><div class="stat-value" style="color: #e6a23c">{{ alerts.by_severity?.warning || 0 }}</div><div class="stat-label" style="font-size: 12px">warning</div></div></el-col>
      </el-row>

      <!-- 甘特图 -->
      <el-card style="margin-bottom: 16px">
        <template #header>
          <span style="font-weight: 500">📊 嵌套甘特 (按 subsystem 分组, 颜色编码状态)</span>
        </template>
        <div class="gantt-container">
          <div class="gantt-header">
            <div class="gantt-row-label" style="width: 200px; flex-shrink: 0">节点</div>
            <div class="gantt-timeline-header" :style="{width: timelineWidth + 'px'}">
              <div v-for="m in months" :key="m.label" class="gantt-month" :style="{width: monthWidth + 'px'}">
                {{ m.label }}
              </div>
            </div>
          </div>
          <div class="gantt-body">
            <div v-for="(bar, idx) in gantt.bars" :key="bar.id" class="gantt-row" :style="{height: rowHeight + 'px'}">
              <div class="gantt-row-label" style="width: 200px; flex-shrink: 0">
                <span style="font-size: 12px">{{ bar.id }}</span>
                <span style="margin-left: 6px">{{ bar.name.substring(0, 16) }}</span>
              </div>
              <div class="gantt-timeline" :style="{width: timelineWidth + 'px', position: 'relative'}">
                <div class="gantt-bar"
                     :style="barStyle(bar)"
                     :title="bar.name + ' (' + bar.duration_days + 'd)'">
                  <span v-if="bar.duration_days >= 7">{{ bar.name.substring(0, 10) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </el-card>

      <!-- 告警面板 -->
      <el-card>
        <template #header>
          <span style="font-weight: 500">🔔 系统告警</span>
        </template>
        <el-row :gutter="16" style="margin-bottom: 12px">
          <el-col :span="8"><div class="stat-card" style="text-align:center"><div class="stat-label">紧急</div><div class="stat-value" style="color: #f56c6c">{{ alerts.by_severity?.danger || 0 }}</div></div></el-col>
          <el-col :span="8"><div class="stat-card" style="text-align:center"><div class="stat-label">警告</div><div class="stat-value" style="color: #e6a23c">{{ alerts.by_severity?.warning || 0 }}</div></div></el-col>
          <el-col :span="8"><div class="stat-card" style="text-align:center"><div class="stat-label">信息</div><div class="stat-value" style="color: #909399">{{ alerts.by_severity?.info || 0 }}</div></div></el-col>
        </el-row>
        <el-table :data="alerts.alerts || []" stripe size="small">
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
import { Api } from '../api'

const instances = ref<any[]>([])
const selectedInstance = ref<any>(undefined)
const gantt = ref<any>({})
const alerts = ref<any>({})
const loading = ref(false)
const scheduling = ref(false)

const rowHeight = 24
const dayWidth = 4  // 4px per day
const monthWidth = 30 * dayWidth  // ~120px per month

const months = computed(() => {
  if (!gantt.value.project_start || !gantt.value.total_days) return []
  const result = []
  const start = new Date(gantt.value.project_start)
  const numMonths = Math.ceil(gantt.value.total_days / 30) + 1
  for (let i = 0; i < numMonths; i++) {
    const d = new Date(start)
    d.setMonth(d.getMonth() + i)
    result.push({ label: (d.getMonth() + 1) + '月', date: d.toISOString().slice(0, 10) })
  }
  return result
})

const timelineWidth = computed(() => months.value.length * monthWidth)

const barStyle = (bar: any) => {
  if (!gantt.value.project_start) return {}
  const start = new Date(gantt.value.project_start)
  const barStart = new Date(bar.start)
  const barEnd = new Date(bar.end)
  const offsetDays = Math.floor((barStart.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
  const widthDays = Math.max(1, Math.floor((barEnd.getTime() - barStart.getTime()) / (1000 * 60 * 60 * 24)))
  return {
    position: 'absolute',
    left: (offsetDays * dayWidth) + 'px',
    width: (widthDays * dayWidth) + 'px',
    top: '2px',
    height: (rowHeight - 4) + 'px',
    background: barColor(bar.status),
    borderRadius: '3px',
    color: '#fff',
    fontSize: '11px',
    padding: '0 4px',
    overflow: 'hidden',
    cursor: 'pointer',
    opacity: bar.status === 'pending' ? 0.5 : 1
  }
}

const barColor = (status: string) => {
  const colors: any = {
    pending: '#909399', ready: '#409eff', in_progress: '#67c23a',
    completed: '#67c23a', blocked: '#f56c6c', paused: '#e6a23c'
  }
  return colors[status] || '#909399'
}

const loadGantt = async () => {
  if (!selectedInstance.value) return
  loading.value = true
  try {
    gantt.value = await Api.instanceGantt(selectedInstance.value)
  } finally { loading.value = false }
}

const loadAll = async () => {
  loading.value = true
  try {
    instances.value = await Api.instances()
    if (instances.value.length > 0 && !selectedInstance.value) {
      selectedInstance.value = instances.value[0].id
    }
    if (selectedInstance.value) await loadGantt()
    alerts.value = await Api.dashboardAlerts()
  } finally { loading.value = false }
}

const runScheduler = async () => {
  if (!selectedInstance.value) return
  scheduling.value = true
  try {
    const r = await Api.scheduleInstance(selectedInstance.value)
    await loadGantt()
    alert('排程完成: ' + r.written_count + ' 节点已更新, 项目开始 ' + r.project_start)
  } catch (e: any) {
    alert('排程失败: ' + (e.response?.data?.error || e.message))
  } finally {
    scheduling.value = false
  }
}

onMounted(loadAll)
</script>

<style scoped>
.gantt-container {
  overflow-x: auto;
  border: 1px solid #ebeef5;
  border-radius: 4px;
}
.gantt-header {
  display: flex;
  background: #f5f7fa;
  border-bottom: 1px solid #ebeef5;
  height: 32px;
  position: sticky;
  top: 0;
  z-index: 1;
}
.gantt-row-label {
  padding: 6px 8px;
  font-size: 12px;
  border-right: 1px solid #ebeef5;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  background: #f5f7fa;
}
.gantt-month {
  padding: 6px;
  font-size: 11px;
  border-right: 1px solid #ebeef5;
  text-align: center;
  color: #606266;
}
.gantt-body {
  max-height: 600px;
  overflow-y: auto;
}
.gantt-row {
  display: flex;
  border-bottom: 1px solid #f0f0f0;
}
.gantt-timeline-header {
  display: flex;
  background: #f5f7fa;
}
.gantt-bar {
  display: flex;
  align-items: center;
  white-space: nowrap;
  transition: all 0.2s;
}
.gantt-bar:hover {
  filter: brightness(1.1);
  box-shadow: 0 2px 8px rgba(0,0,0,0.2);
}
</style>
