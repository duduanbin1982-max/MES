<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title">⚙️ 设备综合效率 (OEE)</div>
      <div>
        <el-select v-model="days" style="width: 120px; margin-right: 8px" @change="load">
          <el-option v-for="d in [7, 14, 30, 60, 90]" :key="d" :label="d + ' 天'" :value="d" />
        </el-select>
        <el-button @click="load" type="primary" :loading="loading">刷新</el-button>
      </div>
    </div>

    <el-row :gutter="12" style="margin-bottom: 12px" v-loading="loading">
      <el-col :span="6"><div class="stat-card"><div class="stat-label">车队利用率</div><div class="stat-value" :style="{color: utilColor(summary.fleet_utilization_pct)}">{{ summary.fleet_utilization_pct || 0 }}%</div><div class="stat-label" style="font-size: 11px">{{ summary.fleet_busy_hours }}h / {{ summary.fleet_available_hours }}h</div></div></el-col>
      <el-col :span="6"><div class="stat-card"><div class="stat-label">工位</div><div class="stat-value">{{ summary.workstation_count || 0 }}</div><div class="stat-label" style="font-size: 11px">总工位</div></div></el-col>
      <el-col :span="6"><div class="stat-card"><div class="stat-label">过载</div><div class="stat-value" :style="{color: (summary.overloaded_count||0) > 0 ? '#f56c6c' : '#67c23a'}">{{ summary.overloaded_count || 0 }}</div><div class="stat-label" style="font-size: 11px">≥90% 利用率</div></div></el-col>
      <el-col :span="6"><div class="stat-card"><div class="stat-label">闲置</div><div class="stat-value" style="color: #909399">{{ summary.idle_count || 0 }}</div><div class="stat-label" style="font-size: 11px">&lt;30% 利用率</div></div></el-col>
    </el-row>

    <el-row :gutter="12" style="margin-bottom: 12px">
      <el-col :span="12">
        <el-card>
          <template #header><span style="color: #f56c6c; font-weight: 500">🔥 瓶颈工位</span></template>
          <div v-if="summary.bottleneck">
            <div style="font-size: 18px; font-weight: 600">{{ summary.bottleneck.name }}</div>
            <el-progress :percentage="summary.bottleneck.utilization_pct" :status="summary.bottleneck.utilization_pct >= 90 ? 'exception' : 'warning'" style="margin-top: 8px" />
            <div style="font-size: 12px; color: #909399; margin-top: 4px">利用率最高，建议优先调度</div>
          </div>
          <el-empty v-else description="暂无数据" :image-size="60" />
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card>
          <template #header><span style="color: #67c23a; font-weight: 500">💤 闲置工位</span></template>
          <div v-if="summary.least_busy">
            <div style="font-size: 18px; font-weight: 600">{{ summary.least_busy.name }}</div>
            <el-progress :percentage="summary.least_busy.utilization_pct" :status="summary.least_busy.utilization_pct < 30 ? 'success' : 'warning'" style="margin-top: 8px" />
            <div style="font-size: 12px; color: #909399; margin-top: 4px">利用率最低，可承接更多任务</div>
          </div>
          <el-empty v-else description="暂无数据" :image-size="60" />
        </el-card>
      </el-col>
    </el-row>

    <el-card>
      <template #header>
        <span style="font-weight: 500">🏭 各工位利用率（按利用率降序）</span>
      </template>
      <el-table :data="workstations" stripe size="small" empty-text="加载中">
        <el-table-column type="index" width="50" />
        <el-table-column prop="name" label="工位" width="160" />
        <el-table-column prop="workshop" label="车间" width="120" />
        <el-table-column label="利用率" min-width="220">
          <template #default="{ row }">
            <div style="display: flex; align-items: center; gap: 8px">
              <el-progress :percentage="row.utilization_pct" :status="utilStatus(row.level)" style="flex: 1" />
              <span style="font-weight: 600; min-width: 40px">{{ row.utilization_pct }}%</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="busy_hours" label="已用工时" width="100" sortable />
        <el-table-column prop="available_hours" label="可用工时" width="100" />
        <el-table-column prop="idle_hours" label="空闲工时" width="100" />
        <el-table-column prop="item_count" label="任务数" width="80" sortable />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="levelTag(row.level)" size="small">{{ levelLabel(row.level) }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-alert v-if="oeeNote" :title="oeeNote" type="info" :closable="false" style="margin-top: 12px" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import api from '../api'

const days = ref(30)
const loading = ref(false)
const summary = ref<any>({})
const workstations = ref<any[]>([])
const oeeNote = ref<string>('')

const utilColor = (p: number) => p >= 90 ? '#f56c6c' : p >= 70 ? '#e6a23c' : p >= 30 ? '#67c23a' : '#909399'
const utilStatus = (level: string) => ({ overload: 'exception', busy: 'warning', normal: 'success', idle: '' }[level] || '')
const levelTag = (level: string) => ({ overload: 'danger', busy: 'warning', normal: 'success', idle: 'info' }[level] || 'info')
const levelLabel = (level: string) => ({ overload: '过载', busy: '繁忙', normal: '正常', idle: '闲置' }[level] || level)

const load = async () => {
  loading.value = true
  try {
    const data = await api.oee({ days: days.value })
    summary.value = data.summary || {}
    workstations.value = data.workstations || []
    oeeNote.value = data.note || ''
  } finally { loading.value = false }
}

onMounted(load)
</script>

<style scoped>
.stat-card {
  background: #fff;
  padding: 16px;
  border-radius: 6px;
  text-align: center;
  border: 1px solid #ebeef5;
}
.stat-label {
  font-size: 12px;
  color: #909399;
  margin-bottom: 6px;
}
.stat-value {
  font-size: 28px;
  font-weight: 600;
  color: #303133;
  line-height: 1.2;
}
</style>
