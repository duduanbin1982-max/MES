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
      <template #header><span><el-icon><DataAnalysis /></el-icon> 工位利用率 TOP 10</span></template>
      <el-table :data="workstationUtil.slice(0, 10)" stripe size="small" empty-text="暂无工位负荷数据">
        <el-table-column prop="name" label="工位" width="180" />
        <el-table-column prop="daily_capacity_hours" label="日产能(h)" width="100" />
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
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'

const now = new Date()
const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
const startDate = ref(monthStart)
const days = ref(30)
const loading = ref(false)
const summary = ref<any>({})
const workstationUtil = ref<any[]>([])
const instanceBreakdown = ref<any[]>([])
const conflicts = ref<any[]>([])
const dataRange = ref<any>({})

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
