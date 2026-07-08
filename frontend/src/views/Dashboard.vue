<template>
  <div class="dashboard-page">
    <section class="dashboard-hero">
      <div class="hero-copy">
        <div class="eyebrow">
          <span class="eyebrow-dot"></span>
          TBM-MES Command Center
        </div>
        <h1>首页驾驶舱</h1>
        <p>聚合项目交付、产能利用、延误风险、关键物料与现场状态，帮助生产主管第一眼看到“卡在哪”。</p>
      </div>
      <div class="hero-actions">
        <div class="refresh-meta">
          <span>最近刷新</span>
          <strong>{{ updatedAt || '尚未刷新' }}</strong>
        </div>
        <el-button type="primary" :icon="Refresh" :loading="loading" @click="loadAll">刷新数据</el-button>
      </div>
    </section>

    <section class="kpi-grid">
      <article class="kpi-card kpi-card--blue">
        <div class="kpi-icon">
          <el-icon><Box /></el-icon>
        </div>
        <div class="kpi-body">
          <span class="kpi-label">装备实例总数</span>
          <strong>{{ numberText(stats.instances?.total) }}</strong>
          <small>{{ numberText(stats.equipment_types) }} 类 / {{ numberText(stats.equipment_models) }} 型号</small>
        </div>
      </article>
      <article class="kpi-card kpi-card--slate">
        <div class="kpi-icon">
          <el-icon><DocumentChecked /></el-icon>
        </div>
        <div class="kpi-body">
          <span class="kpi-label">工单执行</span>
          <strong>{{ numberText(stats.work_orders?.total) }}</strong>
          <small>{{ numberText(inProgress) }} 进行中 / {{ numberText(completed) }} 已完成</small>
        </div>
      </article>
      <article class="kpi-card kpi-card--orange">
        <div class="kpi-icon">
          <el-icon><WarningFilled /></el-icon>
        </div>
        <div class="kpi-body">
          <span class="kpi-label">风险待办</span>
          <strong>{{ numberText(riskTotal) }}</strong>
          <small>{{ numberText(delaysSummary.total) }} 延误 / {{ numberText(stats.open_eco) }} ECO / {{ numberText(stats.open_field_service) }} 服务</small>
        </div>
      </article>
      <article class="kpi-card kpi-card--green">
        <div class="kpi-icon">
          <el-icon><Cpu /></el-icon>
        </div>
        <div class="kpi-body">
          <span class="kpi-label">设备利用率</span>
          <strong>{{ pctText(fleetUtilization) }}</strong>
          <small>{{ numberText(live.equipment_busy) }} 忙 / {{ numberText(live.equipment_idle) }} 闲 / {{ numberText(live.equipment_total) }} 总</small>
        </div>
      </article>
    </section>

    <section class="command-grid">
      <el-card class="panel panel--wide" shadow="never">
        <template #header>
          <div class="panel-header">
            <div>
              <h2>项目结构分布</h2>
              <p>按装备类型与生命周期状态观察 TBM 交付组合。</p>
            </div>
            <el-tag effect="plain" type="primary">实例 {{ numberText(stats.instances?.total) }}</el-tag>
          </div>
        </template>
        <div class="chart-grid">
          <div class="chart-box">
            <div class="chart-title">装备类型</div>
            <div ref="typeChartEl" class="chart"></div>
          </div>
          <div class="chart-box">
            <div class="chart-title">实例状态</div>
            <div ref="statusChartEl" class="chart"></div>
          </div>
        </div>
      </el-card>

      <el-card class="panel risk-panel" shadow="never">
        <template #header>
          <div class="panel-header compact">
            <div>
              <h2>交付风险雷达</h2>
              <p>延误、长交期、变更与服务问题统一收口。</p>
            </div>
          </div>
        </template>
        <div class="risk-score" :class="`risk-score--${riskLevel.type}`">
          <span>{{ riskLevel.label }}</span>
          <strong>{{ numberText(riskTotal) }}</strong>
          <small>当前风险项</small>
        </div>
        <div class="risk-list">
          <div v-for="item in riskItems" :key="item.label" class="risk-row">
            <div>
              <span>{{ item.label }}</span>
              <small>{{ item.hint }}</small>
            </div>
            <el-tag :type="item.type" effect="light">{{ numberText(item.value) }}</el-tag>
          </div>
        </div>
      </el-card>
    </section>

    <section class="command-grid">
      <el-card class="panel" shadow="never" v-if="oee.workstations && oee.workstations.length">
        <template #header>
          <div class="panel-header compact">
            <div>
              <h2>产能利用 OEE</h2>
              <p>最近 14 天工位负荷与瓶颈识别。</p>
            </div>
            <el-tag v-if="oee.summary.bottleneck" type="danger" effect="light">
              瓶颈 {{ oee.summary.bottleneck.name }}
            </el-tag>
          </div>
        </template>
        <div class="oee-summary">
          <strong>{{ pctText(oee.summary.fleet_utilization_pct) }}</strong>
          <span>{{ numberText(oee.summary.fleet_busy_hours) }}h / {{ numberText(oee.summary.fleet_available_hours) }}h</span>
        </div>
        <el-table :data="oee.workstations" size="small" class="dense-table">
          <el-table-column prop="name" label="工位" min-width="120" />
          <el-table-column prop="utilization_pct" label="利用率" min-width="150">
            <template #default="{ row }">
              <el-progress
                :percentage="row.utilization_pct"
                :stroke-width="8"
                :color="progressColor(row.level)"
              />
            </template>
          </el-table-column>
          <el-table-column prop="busy_hours" label="忙碌(h)" width="90" />
          <el-table-column prop="item_count" label="任务" width="80" />
        </el-table>
      </el-card>

      <el-card class="panel" shadow="never">
        <template #header>
          <div class="panel-header compact">
            <div>
              <h2>现场实时状态</h2>
              <p>设备、工单、工序与最新开工动态。</p>
            </div>
            <el-tag :type="utilizationTone" effect="light">{{ pctText(live.utilization) }}</el-tag>
          </div>
        </template>
        <div class="live-grid">
          <div class="live-metric">
            <span>设备总数</span>
            <strong>{{ numberText(live.equipment_total) }}</strong>
          </div>
          <div class="live-metric">
            <span>在加工工单</span>
            <strong>{{ numberText(live.wo_in_progress) }}</strong>
          </div>
          <div class="live-metric">
            <span>在加工工序</span>
            <strong>{{ numberText(live.pn_in_progress) }}</strong>
          </div>
        </div>
        <el-table v-if="live.recent_starts?.length" :data="live.recent_starts" stripe size="small" max-height="238" class="dense-table">
          <el-table-column prop="wo_code" label="工单" width="150" />
          <el-table-column prop="instance_code" label="实例" width="120" />
          <el-table-column prop="title" label="标题" min-width="180" />
          <el-table-column prop="actual_start" label="开工时间" width="170" />
        </el-table>
        <el-empty v-else description="暂无开工动态" :image-size="72" />
      </el-card>
    </section>

    <section class="command-grid command-grid--bottom">
      <el-card class="panel panel--wide" shadow="never">
        <template #header>
          <div class="panel-header">
            <div>
              <h2>最近装备实例</h2>
              <p>点击实例进入项目详情，继续钻取 BOM、齐套、工单、质检与成本。</p>
            </div>
          </div>
        </template>
        <el-table :data="recentInstances" stripe size="small" class="dense-table clickable-table" @row-click="goInstance">
          <el-table-column prop="instance_code" label="编号" width="130" />
          <el-table-column prop="instance_name" label="名称" min-width="180" />
          <el-table-column prop="type_name" label="类型" width="110" />
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="statusTagType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="计划周期" min-width="190">
            <template #default="{ row }">{{ row.planned_start || '-' }} → {{ row.planned_end || '-' }}</template>
          </el-table-column>
        </el-table>
      </el-card>

      <el-card class="panel" shadow="never">
        <template #header>
          <div class="panel-header compact">
            <div>
              <h2>长交期关键件</h2>
              <p>采购风险前置预警，默认关注 ≥12 周。</p>
            </div>
          </div>
        </template>
        <el-table :data="longLeadtime" stripe size="small" class="dense-table">
          <el-table-column prop="material_name" label="物料" min-width="150" />
          <el-table-column prop="supplier" label="供应商" width="100" />
          <el-table-column label="交期" width="84">
            <template #default="{ row }">
              <el-tag type="danger" size="small">{{ row.lead_time_weeks }}w</el-tag>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!longLeadtime.length" description="暂无长交期关键件" :image-size="72" />
      </el-card>
    </section>

    <section v-if="delaysSummary.total > 0" class="delay-strip">
      <div class="delay-title">
        <el-icon><Timer /></el-icon>
        <div>
          <strong>延误预警</strong>
          <span>WO {{ numberText(delaysSummary.work_order_delays) }} / 工序 {{ numberText(delaysSummary.process_node_delays) }}</span>
        </div>
      </div>
      <el-table :data="delaysTop" size="small" class="dense-table delay-table">
        <el-table-column prop="severity" label="等级" width="82">
          <template #default="{ row }">
            <el-tag :type="row.severity === 'critical' ? 'danger' : row.severity === 'high' ? 'warning' : 'info'" size="small">
              {{ row.severity === 'critical' ? '严重' : row.severity === 'high' ? '高' : '警告' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="延误项" min-width="180" />
        <el-table-column prop="instance_code" label="项目" width="130" />
        <el-table-column prop="days_overdue" label="延期" width="90">
          <template #default="{ row }">
            <span class="overdue-days">{{ row.days_overdue }}d</span>
          </template>
        </el-table-column>
      </el-table>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, computed } from 'vue'
import { useRouter } from 'vue-router'
import * as echarts from 'echarts'
import { Box, Cpu, DocumentChecked, Refresh, Timer, WarningFilled } from '@element-plus/icons-vue'
import { Api } from '../api'

const router = useRouter()
const loading = ref(false)
const stats = ref<any>({})
const live = ref<any>({})
const recentInstances = ref<any[]>([])
const longLeadtime = ref<any[]>([])
const typeChartEl = ref()
const statusChartEl = ref()
const updatedAt = ref('')
let typeChart: echarts.ECharts | null = null
let statusChart: echarts.ECharts | null = null

const chartPalette = ['#2563eb', '#f97316', '#0f766e', '#64748b', '#f59e0b', '#ef4444']

const numberText = (value: any) => Number(value || 0).toLocaleString('zh-CN')
const pctText = (value: any) => `${Math.round(Number(value || 0))}%`

const inProgress = computed(() => stats.value.work_orders?.by_status?.find((s: any) => s.status === 'in_progress')?.c || 0)
const completed = computed(() => stats.value.work_orders?.by_status?.find((s: any) => s.status === 'completed')?.c || 0)
const fleetUtilization = computed(() => Number(oee.value.summary?.fleet_utilization_pct || live.value.utilization || 0))
const riskTotal = computed(() => Number(delaysSummary.value.total || 0) + Number(stats.value.open_eco || 0) + Number(stats.value.open_field_service || 0) + Number(stats.value.long_leadtime || longLeadtime.value.length || 0))
const utilizationTone = computed(() => {
  const value = Number(live.value.utilization || 0)
  if (value >= 70) return 'success'
  if (value >= 40) return 'warning'
  return 'danger'
})
const riskLevel = computed(() => {
  if (riskTotal.value >= 10) return { type: 'danger', label: '高风险' }
  if (riskTotal.value >= 4) return { type: 'warning', label: '需关注' }
  return { type: 'success', label: '平稳' }
})
const riskItems = computed(() => [
  { label: '延误项', value: delaysSummary.value.total || 0, hint: '工单与工序延期', type: delaysSummary.value.total ? 'danger' : 'success' },
  { label: '长交期关键件', value: stats.value.long_leadtime || longLeadtime.value.length || 0, hint: '采购到货风险', type: (stats.value.long_leadtime || longLeadtime.value.length) ? 'warning' : 'success' },
  { label: '待处理 ECO', value: stats.value.open_eco || 0, hint: '设计变更影响', type: stats.value.open_eco ? 'warning' : 'success' },
  { label: '服务工单', value: stats.value.open_field_service || 0, hint: '现场/售后问题', type: stats.value.open_field_service ? 'info' : 'success' },
])

const statusLabel = (status: string) => ({
  design: '设计',
  procurement: '采购',
  manufacturing: '生产',
  assembly: '装配',
  commissioning: '调试',
  shipping: '发运',
  accepted: '已验收',
}[status] || status)
const statusTagType = (status: string) => ({
  design: 'info',
  procurement: 'warning',
  manufacturing: 'primary',
  assembly: 'primary',
  commissioning: 'success',
  shipping: 'warning',
  accepted: 'success',
}[status] || 'info')
const progressColor = (level: string) => ({
  overload: '#ef4444',
  busy: '#f97316',
  normal: '#0f766e',
  idle: '#64748b',
}[level] || '#2563eb')

const goInstance = (row: any) => router.push(`/instances/${row.id}`)

const drawTypeChart = () => {
  if (!typeChartEl.value || !stats.value.instances?.by_type?.length) return
  if (!typeChart) typeChart = echarts.init(typeChartEl.value)
  typeChart.setOption({
    color: chartPalette,
    tooltip: { trigger: 'item' },
    legend: { bottom: 0, textStyle: { color: '#475569' } },
    series: [{
      type: 'pie',
      radius: ['48%', '72%'],
      center: ['50%', '44%'],
      avoidLabelOverlap: true,
      label: { color: '#334155' },
      data: stats.value.instances.by_type.map((type: any) => ({ name: type.type, value: type.c })),
    }],
  })
}

const drawStatusChart = () => {
  if (!statusChartEl.value) return
  if (!statusChart) statusChart = echarts.init(statusChartEl.value)
  const data = stats.value.instances?.by_status?.length
    ? stats.value.instances.by_status.map((status: any) => ({ name: statusLabel(status.status), value: status.c }))
    : [{ name: '暂无数据', value: 1 }]
  statusChart.setOption({
    color: chartPalette,
    tooltip: { trigger: 'item' },
    legend: { bottom: 0, textStyle: { color: '#475569' } },
    series: [{
      type: 'pie',
      radius: ['0%', '68%'],
      center: ['50%', '44%'],
      label: { color: '#334155' },
      data,
    }],
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
      Api.oee({ days: 14 }).catch(() => ({ summary: {}, workstations: [] })),
    ])
    stats.value = dash || {}
    recentInstances.value = Array.isArray(inst) ? inst.slice(0, 5) : []
    longLeadtime.value = Array.isArray(lt) ? lt : []
    live.value = lv || {}
    delaysSummary.value = dsum || { total: 0, work_order_delays: 0, process_node_delays: 0 }
    delaysTop.value = dtop.items || []
    oee.value = oeeR || { summary: {}, workstations: [] }
    updatedAt.value = new Date().toLocaleString('zh-CN', { hour12: false })
    await nextTick()
    drawTypeChart()
    drawStatusChart()
  } finally {
    loading.value = false
  }
}

const resize = () => {
  typeChart?.resize()
  statusChart?.resize()
}

onMounted(() => {
  loadAll()
  window.addEventListener('resize', resize)
})
onUnmounted(() => {
  window.removeEventListener('resize', resize)
  typeChart?.dispose()
  statusChart?.dispose()
})
</script>

<style scoped>
.dashboard-page {
  --dash-primary: #2563eb;
  --dash-secondary: #64748b;
  --dash-accent: #f97316;
  --dash-bg: #eff6ff;
  --dash-text: #0f172a;
  --dash-muted: #475569;
  --dash-border: #dbeafe;
  min-height: 100%;
  padding: 20px;
  background:
    radial-gradient(circle at top left, rgba(37, 99, 235, 0.14), transparent 34%),
    linear-gradient(135deg, #f8fafc 0%, #eff6ff 46%, #f8fafc 100%);
  color: var(--dash-text);
  font-family: "Fira Sans", "Plus Jakarta Sans", "Microsoft YaHei", system-ui, sans-serif;
}

.dashboard-hero {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  align-items: stretch;
  margin-bottom: 18px;
  padding: 24px;
  border: 1px solid rgba(37, 99, 235, 0.18);
  border-radius: 22px;
  background:
    linear-gradient(120deg, rgba(15, 23, 42, 0.96), rgba(30, 64, 175, 0.9)),
    radial-gradient(circle at right, rgba(249, 115, 22, 0.2), transparent 28%);
  color: #fff;
  box-shadow: 0 18px 45px rgba(30, 64, 175, 0.18);
}

.hero-copy {
  max-width: 760px;
}

.eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  color: #bfdbfe;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.eyebrow-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--dash-accent);
  box-shadow: 0 0 0 6px rgba(249, 115, 22, 0.16);
}

.dashboard-hero h1 {
  margin: 0;
  font-size: clamp(28px, 3vw, 42px);
  line-height: 1.1;
  font-weight: 800;
  letter-spacing: -0.04em;
}

.dashboard-hero p {
  max-width: 760px;
  margin: 12px 0 0;
  color: #dbeafe;
  font-size: 15px;
  line-height: 1.7;
}

.hero-actions {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: flex-end;
  min-width: 180px;
}

.refresh-meta {
  display: grid;
  gap: 4px;
  text-align: right;
  color: #bfdbfe;
  font-size: 12px;
}

.refresh-meta strong {
  color: #fff;
  font-size: 13px;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 16px;
}

.kpi-card {
  display: flex;
  gap: 14px;
  min-height: 118px;
  padding: 18px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.88);
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.06);
  transition: border-color 200ms ease, box-shadow 200ms ease, transform 200ms ease;
}

.kpi-card:hover {
  border-color: rgba(37, 99, 235, 0.36);
  box-shadow: 0 18px 38px rgba(15, 23, 42, 0.1);
  transform: translateY(-1px);
}

.kpi-icon {
  display: grid;
  place-items: center;
  flex: 0 0 42px;
  width: 42px;
  height: 42px;
  border-radius: 14px;
  color: #fff;
  font-size: 20px;
}

.kpi-card--blue .kpi-icon { background: #2563eb; }
.kpi-card--slate .kpi-icon { background: #475569; }
.kpi-card--orange .kpi-icon { background: #f97316; }
.kpi-card--green .kpi-icon { background: #0f766e; }

.kpi-body {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.kpi-label {
  color: var(--dash-muted);
  font-size: 13px;
  font-weight: 700;
}

.kpi-body strong {
  color: var(--dash-text);
  font-family: "Fira Code", "Consolas", monospace;
  font-size: 30px;
  line-height: 1;
  letter-spacing: -0.04em;
}

.kpi-body small {
  color: var(--dash-muted);
  line-height: 1.5;
}

.command-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(360px, 0.75fr);
  gap: 16px;
  margin-bottom: 16px;
}

.command-grid--bottom {
  align-items: start;
}

.panel {
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 10px 26px rgba(15, 23, 42, 0.06);
}

.panel :deep(.el-card__header) {
  padding: 16px 18px;
  border-bottom: 1px solid #e2e8f0;
}

.panel :deep(.el-card__body) {
  padding: 16px 18px 18px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
}

.panel-header.compact {
  align-items: flex-start;
}

.panel-header h2 {
  margin: 0;
  color: var(--dash-text);
  font-size: 16px;
  font-weight: 800;
}

.panel-header p {
  margin: 5px 0 0;
  color: var(--dash-muted);
  font-size: 12px;
  line-height: 1.5;
}

.chart-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.chart-box {
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  background: #f8fafc;
  padding: 12px;
}

.chart-title {
  color: var(--dash-muted);
  font-size: 12px;
  font-weight: 800;
}

.chart {
  height: 278px;
}

.risk-score {
  display: grid;
  gap: 3px;
  margin-bottom: 14px;
  padding: 18px;
  border-radius: 18px;
  color: #fff;
}

.risk-score--success { background: linear-gradient(135deg, #0f766e, #14b8a6); }
.risk-score--warning { background: linear-gradient(135deg, #f97316, #f59e0b); }
.risk-score--danger { background: linear-gradient(135deg, #b91c1c, #ef4444); }

.risk-score span,
.risk-score small {
  color: rgba(255, 255, 255, 0.86);
}

.risk-score strong {
  font-family: "Fira Code", "Consolas", monospace;
  font-size: 42px;
  line-height: 1;
}

.risk-list {
  display: grid;
  gap: 10px;
}

.risk-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  padding: 11px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  background: #f8fafc;
}

.risk-row div {
  display: grid;
  gap: 3px;
}

.risk-row span {
  color: var(--dash-text);
  font-weight: 800;
}

.risk-row small {
  color: var(--dash-muted);
}

.oee-summary {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 12px;
  padding: 12px 14px;
  border-radius: 14px;
  background: #eff6ff;
}

.oee-summary strong {
  color: var(--dash-primary);
  font-family: "Fira Code", "Consolas", monospace;
  font-size: 30px;
}

.oee-summary span {
  color: var(--dash-muted);
}

.live-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}

.live-metric {
  display: grid;
  gap: 4px;
  padding: 13px;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  background: #f8fafc;
}

.live-metric span {
  color: var(--dash-muted);
  font-size: 12px;
  font-weight: 700;
}

.live-metric strong {
  color: var(--dash-text);
  font-family: "Fira Code", "Consolas", monospace;
  font-size: 24px;
}

.dense-table {
  width: 100%;
}

.dense-table :deep(.el-table__header th) {
  color: var(--dash-muted);
  background: #f8fafc;
  font-weight: 800;
}

.clickable-table :deep(.el-table__row) {
  cursor: pointer;
}

.clickable-table :deep(.el-table__row:hover td) {
  background: #eff6ff !important;
}

.delay-strip {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 16px;
  padding: 16px;
  border: 1px solid rgba(249, 115, 22, 0.24);
  border-radius: 18px;
  background: rgba(255, 247, 237, 0.92);
}

.delay-title {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  color: #9a3412;
}

.delay-title .el-icon {
  margin-top: 2px;
  font-size: 22px;
}

.delay-title div {
  display: grid;
  gap: 5px;
}

.delay-title strong {
  font-size: 16px;
}

.delay-title span {
  color: #c2410c;
  font-size: 12px;
}

.overdue-days {
  color: #dc2626;
  font-family: "Fira Code", "Consolas", monospace;
  font-weight: 800;
}

@media (max-width: 1200px) {
  .kpi-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .command-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .dashboard-page {
    padding: 12px;
  }

  .dashboard-hero,
  .panel-header,
  .delay-strip {
    grid-template-columns: 1fr;
    flex-direction: column;
  }

  .hero-actions,
  .refresh-meta {
    align-items: flex-start;
    text-align: left;
  }

  .kpi-grid,
  .chart-grid,
  .live-grid {
    grid-template-columns: 1fr;
  }

  .chart {
    height: 240px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .kpi-card,
  .btn-primary,
  .btn-secondary {
    transition: none;
  }

  .kpi-card:hover {
    transform: none;
  }
}
</style>
