<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title">📊 总览仪表盘</div>
      <el-button @click="loadAll" :loading="loading" size="small">刷新</el-button>
    </div>

    <!-- 顶部 4 张统计卡 -->
    <el-row :gutter="16" style="margin-bottom: 16px">
      <el-col :span="6">
        <el-card>
          <div class="stat-card">
            <div class="stat-label">装备实例总数</div>
            <div class="stat-value">{{ stats.instances?.total || 0 }}</div>
            <div style="font-size: 12px; color: #909399">
              {{ stats.equipment_types || 0 }} 类 / {{ stats.equipment_models || 0 }} 型号
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card>
          <div class="stat-card">
            <div class="stat-label">工单总数</div>
            <div class="stat-value">{{ stats.work_orders?.total || 0 }}</div>
            <div style="font-size: 12px; color: #909399">
              {{ inProgress }} 进行中 / {{ completed }} 已完成
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card>
          <div class="stat-card">
            <div class="stat-label">关键外购件</div>
            <div class="stat-value">{{ stats.key_components || 0 }}</div>
            <div style="font-size: 12px; color: #f56c6c">
              {{ stats.long_leadtime || 0 }} 个长交期 (≥12 周)
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card>
          <div class="stat-card">
            <div class="stat-label">BOM 节点 / 设计变更 / 服务工单</div>
            <div class="stat-value" style="font-size: 20px">
              {{ stats.bom_total || 0 }} / {{ stats.open_eco || 0 }} / {{ stats.open_field_service || 0 }}
            </div>
            <div style="font-size: 12px; color: #909399">BOM / 待处理 ECO / 待处理服务</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 中间 2 个图表 -->
    <el-row :gutter="16" style="margin-bottom: 16px">
      <el-col :span="12">
        <el-card title="装备实例按类型分布">
          <div ref="typeChartEl" style="height: 280px"></div>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card title="实例按状态分布">
          <div ref="statusChartEl" style="height: 280px"></div>
        </el-card>
      </el-col>
    </el-row>

    <!-- P2-#3 设备实时状态看板 -->
    <el-row :gutter="16" style="margin-bottom: 16px">
      <el-col :span="24">
        <el-card title="⚙️ 设备产能 (OEE 简化版 - 14 天)" v-if="oee.workstations && oee.workstations.length">
        <div style="display: flex; gap: 16px; margin-bottom: 12px; align-items: baseline">
          <div style="font-size: 28px; font-weight: bold; color: #409eff">{{ oee.summary.fleet_utilization_pct }}%</div>
          <div style="font-size: 12px; color: #909399">fleet 利用率 ({{ oee.summary.fleet_busy_hours }}h / {{ oee.summary.fleet_available_hours }}h)</div>
          <el-tag v-if="oee.summary.bottleneck" type="danger" size="small">瓶颈: {{ oee.summary.bottleneck.name }} {{ oee.summary.bottleneck.utilization_pct }}%</el-tag>
        </div>
        <el-table :data="oee.workstations" size="small">
          <el-table-column prop="name" label="工位" />
          <el-table-column prop="utilization_pct" label="利用率" width="100">
            <template #default="{ row }">
              <el-progress :percentage="row.utilization_pct" :color="row.level === 'overload' ? '#f56c6c' : row.level === 'busy' ? '#e6a23c' : row.level === 'normal' ? '#67c23a' : '#909399'" />
            </template>
          </el-table-column>
          <el-table-column prop="busy_hours" label="忙碌" width="80" />
          <el-table-column prop="item_count" label="任务" width="80" />
        </el-table>
      </el-card>
      <el-card title="⚠️ 延误预警" v-if="delaysSummary.total > 0">
        <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 12px">
          <el-tag type="danger" size="large" v-if="delaysSummary.total > 0">🚨 {{ delaysSummary.total }} 项延误</el-tag>
          <span style="font-size: 12px; color: #909399">WO: {{ delaysSummary.work_order_delays }} | 工序: {{ delaysSummary.process_node_delays }}</span>
        </div>
        <el-table :data="delaysTop" size="small" :show-header="true">
          <el-table-column prop="severity" label="等级" width="80">
            <template #default="{ row }">
              <el-tag :type="row.severity === 'critical' ? 'danger' : row.severity === 'high' ? 'warning' : 'info'" size="small">{{ row.severity === 'critical' ? '严重' : row.severity === 'high' ? '高' : '警告' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="name" label="延误项" />
          <el-table-column prop="instance_code" label="项目" width="120" />
          <el-table-column prop="days_overdue" label="延期" width="80">
            <template #default="{ row }"><span :style="{ color: row.severity === 'critical' ? '#f56c6c' : '#e6a23c' }">{{ row.days_overdue }}d</span></template>
          </el-table-column>
        </el-table>
      </el-card>
      <el-card title="🏭 设备实时状态">
          <el-row :gutter="12" style="margin-bottom: 12px">
            <el-col :span="6">
              <div class="stat-card">
                <div class="stat-label">设备总数 / 忙 / 闲</div>
                <div class="stat-value" style="font-size: 18px">
                  {{ live.equipment_total || 0 }} / <span style="color: #e6a23c">{{ live.equipment_busy || 0 }}</span> / <span style="color: #67c23a">{{ live.equipment_idle || 0 }}</span>
                </div>
              </div>
            </el-col>
            <el-col :span="6">
              <div class="stat-card">
                <div class="stat-label">设备利用率</div>
                <div class="stat-value" :style="{color: (live.utilization||0) >= 70 ? '#67c23a' : (live.utilization||0) >= 40 ? '#e6a23c' : '#f56c6c'}">
                  {{ live.utilization || 0 }}%
                </div>
              </div>
            </el-col>
            <el-col :span="6">
              <div class="stat-card">
                <div class="stat-label">在加工工单 / 工序</div>
                <div class="stat-value">{{ live.wo_in_progress || 0 }} / {{ live.pn_in_progress || 0 }}</div>
              </div>
            </el-col>
            <el-col :span="6">
              <div class="stat-card">
                <div class="stat-label">最新开工</div>
                <div class="stat-value" style="font-size: 14px">
                  {{ live.recent_starts?.[0]?.wo_code || '无' }}
                </div>
                <div style="font-size: 12px; color: #909399">{{ live.recent_starts?.[0]?.title || '' }}</div>
              </div>
            </el-col>
          </el-row>
          <el-table v-if="live.recent_starts?.length" :data="live.recent_starts" stripe size="small" max-height="200">
            <el-table-column prop="wo_code" label="工单" width="180" />
            <el-table-column prop="instance_code" label="实例" width="140" />
            <el-table-column prop="title" label="标题" />
            <el-table-column prop="actual_start" label="开工时间" width="180" />
          </el-table>
        </el-card>
      </el-col>
    </el-row>

        <!-- 最近实例 + 长交期预警 -->
    <el-row :gutter="16">
      <el-col :span="14">
        <el-card title="最近装备实例">
          <el-table :data="recentInstances" stripe size="small" @row-click="goInstance" style="cursor: pointer">
            <el-table-column prop="instance_code" label="编号" width="130" />
            <el-table-column prop="instance_name" label="名称" />
            <el-table-column prop="type_name" label="类型" width="100" />
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="statusTagType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="工期" width="170">
              <template #default="{ row }">{{ row.planned_start }} → {{ row.planned_end }}</template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
      <el-col :span="10">
        <el-card title="长交期关键件 (≥12 周)">
          <el-table :data="longLeadtime" stripe size="small">
            <el-table-column prop="material_name" label="物料" />
            <el-table-column prop="supplier" label="供应商" width="90" />
            <el-table-column label="交期" width="80">
              <template #default="{ row }">
                <el-tag type="danger" size="small">{{ row.lead_time_weeks }}w</el-tag>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, computed } from 'vue'
import { useRouter } from 'vue-router'
import * as echarts from 'echarts'
import { Api } from '../api'

const router = useRouter()
const loading = ref(false)
const stats = ref<any>({})
const live = ref<any>({})
const recentInstances = ref<any[]>([])
const longLeadtime = ref<any[]>([])
const typeChartEl = ref()
const statusChartEl = ref()
let typeChart: echarts.ECharts | null = null
let statusChart: echarts.ECharts | null = null

const inProgress = computed(() => stats.value.work_orders?.by_status?.find((s: any) => s.status === 'in_progress')?.c || 0)
const completed = computed(() => stats.value.work_orders?.by_status?.find((s: any) => s.status === 'completed')?.c || 0)

const statusLabel = (s: string) => ({ design: '设计', procurement: '采购', manufacturing: '生产', assembly: '装配', commissioning: '调试', shipping: '发运', accepted: '已验收' }[s] || s)
const statusTagType = (s: string) => ({ design: 'info', procurement: 'warning', manufacturing: 'primary', assembly: 'primary', commissioning: 'success', shipping: 'warning', accepted: 'success' }[s] || 'info')

const goInstance = (row: any) => router.push(`/instances/${row.id}`)

const drawTypeChart = () => {
  if (!typeChartEl.value || !stats.value.instances?.by_type?.length) return
  if (!typeChart) typeChart = echarts.init(typeChartEl.value)
  typeChart.setOption({
    tooltip: { trigger: 'item' },
    legend: { bottom: 0 },
    series: [{
      type: 'pie',
      radius: ['40%', '70%'],
      data: stats.value.instances.by_type.map((t: any) => ({ name: t.type, value: t.c }))
    }]
  })
}

const drawStatusChart = () => {
  if (!statusChartEl.value) return
  if (!statusChart) statusChart = echarts.init(statusChartEl.value)
  const data = stats.value.instances?.by_status?.length
    ? stats.value.instances.by_status.map((s: any) => ({ name: statusLabel(s.status), value: s.c }))
    : [{ name: '暂无数据', value: 1 }]
  statusChart.setOption({
    tooltip: { trigger: 'item' },
    legend: { bottom: 0 },
    series: [{
      type: 'pie',
      radius: '60%',
      data
    }]
  })
}

const delaysSummary = ref({ work_order_delays: 0, process_node_delays: 0, total: 0, today: '' })
const delaysTop = ref<any[]>([])
const oee = ref<any>({ summary: {}, workstations: [] })

const loadAll = async () => {
  loading.value = true
  try {
    const [dash, inst, lt, lv, dsum, dtop, oeeR] = await Promise.all([
      Api.dashboard(),
      Api.instances(),
      Api.longLeadtime(),
      Api.liveStatus(),
      Api.delaysSummary().catch(() => ({ total: 0, work_order_delays: 0, process_node_delays: 0 })),
      Api.delays({ limit: 5 }).catch(() => ({ items: [] })),
      Api.oee({ days: 14 }).catch(() => ({ summary: {}, workstations: [] }))
    ])
    stats.value = dash
    recentInstances.value = inst.slice(0, 5)
    longLeadtime.value = lt
    live.value = lv
    delaysSummary.value = dsum
    delaysTop.value = dtop.items || []
    oee.value = oeeR
    await nextTick()
    drawTypeChart()
    drawStatusChart()
  } finally {
    loading.value = false
  }
}

const resize = () => { typeChart?.resize(); statusChart?.resize() }
onMounted(() => { loadAll(); window.addEventListener('resize', resize) })
onUnmounted(() => { window.removeEventListener('resize', resize); typeChart?.dispose(); statusChart?.dispose() })
</script>
