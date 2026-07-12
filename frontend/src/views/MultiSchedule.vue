<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title"><el-icon><Switch /></el-icon> 多项目资源排程</div>
      <div>
        <el-input-number v-model="days" :min="7" :max="90" :step="7" size="small" style="width: 120px; margin-right: 8px" @change="load" />
        <el-button @click="load" type="primary" :loading="loading">刷新</el-button>
      </div>
    </div>

    <el-row :gutter="12" style="margin-bottom: 12px" v-loading="loading">
      <el-col :span="6"><div class="stat-card"><div class="stat-label">项目</div><div class="stat-value">{{ summary.instance_count || 0 }}</div></div></el-col>
      <el-col :span="6"><div class="stat-card"><div class="stat-label">总工时</div><div class="stat-value">{{ summary.total_hours || 0 }}h</div></div></el-col>
      <el-col :span="6"><div class="stat-card"><div class="stat-label">工位数</div><div class="stat-value">{{ summary.workstation_count || 0 }}</div></div></el-col>
      <el-col :span="6"><div class="stat-card"><div class="stat-label">冲突</div><div class="stat-value" :style="{color: (summary.conflict_count||0) > 0 ? 'var(--el-color-danger)' : 'var(--el-color-success)'}">{{ summary.conflict_count || 0 }}</div></div></el-col>
    </el-row>

    <el-card style="margin-bottom: 12px">
      <template #header><span style="font-weight: 500"><el-icon><DataAnalysis /></el-icon> 工位利用率 (TOP 10)</span></template>
      <el-table :data="workstationUtil.slice(0, 10)" stripe size="small" empty-text="加载中">
        <el-table-column prop="name" label="工位" width="180" />
        <el-table-column prop="total_busy_hours" label="已用工时" width="120" sortable />
        <el-table-column label="平均利用率" width="180">
          <template #default="{ row }">
            <el-progress :percentage="row.avg_utilization_pct" :status="row.avg_utilization_pct >= 90 ? 'exception' : row.avg_utilization_pct >= 70 ? 'warning' : 'success'" />
          </template>
        </el-table-column>
        <el-table-column label="峰值日" width="120">
          <template #default="{ row }">{{ row.peak_day?.day || '-' }} ({{ row.peak_day?.busy_hours || 0 }}h)</template>
        </el-table-column>
        <el-table-column label="峰值利用率" width="120">
          <template #default="{ row }">
            <el-tag :type="row.peak_utilization_pct >= 90 ? 'danger' : row.peak_utilization_pct >= 70 ? 'warning' : 'info'" size="small">{{ row.peak_utilization_pct }}%</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card style="margin-bottom: 12px">
      <template #header><span style="font-weight: 500"><el-icon><OfficeBuilding /></el-icon> 各项目占用工位</span></template>
      <el-table :data="instanceBreakdown" stripe size="small" empty-text="加载中">
        <el-table-column prop="instance_code" label="项目" width="120" />
        <el-table-column prop="instance_name" label="名称" min-width="160" />
        <el-table-column prop="item_count" label="节点数" width="100" sortable />
        <el-table-column prop="total_hours" label="总工时" width="120" sortable />
        <el-table-column prop="workstation_count" label="用工位" width="100" />
        <el-table-column label="占用工位">
          <template #default="{ row }">
            <el-tag v-for="ws in row.workstations" :key="ws" size="small" style="margin-right: 4px">{{ ws }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card>
      <template #header>
        <div style="display: flex; justify-content: space-between; align-items: center">
          <span style="font-weight: 500"><el-icon><Warning /></el-icon> 跨项目冲突 ({{ conflicts.length }})</span>
          <el-tag v-if="conflicts.length === 0" type="success" size="small">无冲突</el-tag>
        </div>
      </template>
      <el-table :data="conflicts" stripe size="small" empty-text="<el-icon><CircleCheck /></el-icon> 无跨项目冲突">
        <el-table-column label="类型" width="140">
          <template #default="{ row }">
            <el-tag :type="row.type === 'cross_instance' ? 'danger' : 'warning'" size="small">
              {{ row.type === 'cross_instance' ? '工位抢占' : '容量超载' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="workstation" label="工位" width="120" />
        <el-table-column label="冲突项" min-width="300">
          <template #default="{ row }">
            <div v-if="row.items">
              <div v-for="(it, i) in row.items" :key="i" style="font-size: 12px">
                <el-tag size="small" style="margin-right: 4px">{{ it.instance }}</el-tag>
                {{ it.node || it.name }} ({{ it.start }} → {{ it.end }})
              </div>
            </div>
            <div v-else style="font-size: 12px">{{ row.day }}: {{ row.busy_hours }}h ({{ row.utilization_pct }}%)</div>
          </template>
        </el-table-column>
        <el-table-column prop="overlap_hours" label="重叠/超载小时" width="140" />
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import api from '../api'

const days = ref(30)
const loading = ref(false)
const summary = ref<any>({})
const workstationUtil = ref<any[]>([])
const instanceBreakdown = ref<any[]>([])
const conflicts = ref<any[]>([])

const load = async () => {
  loading.value = true
  try {
    const data = await api.get('/resources/gantt', { params: { days: days.value } })
    summary.value = data.summary || {}
    workstationUtil.value = data.workstation_utilization || []
    instanceBreakdown.value = data.instance_breakdown || []
    conflicts.value = data.conflicts || []
  } finally { loading.value = false }
}

onMounted(load)
</script>

<style scoped>
.stat-card {
  background: var(--el-color-white);
  padding: 16px;
  border-radius: 6px;
  text-align: center;
  border: 1px solid var(--el-border-color-lighter);
}
.stat-label {
  font-size: 12px;
  color: var(--el-color-info);
  margin-bottom: 6px;
}
.stat-value {
  font-size: 24px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
</style>
