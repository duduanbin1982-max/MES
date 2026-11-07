<template>
  <DashboardGrid>
    <DashboardPanel title="项目结构分布" description="按装备类型与生命周期状态观察 TBM 交付组合。">
      <template #actions>
        <el-tag effect="plain" type="primary">实例 {{ numberText(stats.instances?.total) }}</el-tag>
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
    </DashboardPanel>

    <DashboardPanel title="交付风险雷达" description="延误、长交期、变更与服务问题统一收口。" compact>
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
    </DashboardPanel>
  </DashboardGrid>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { echarts } from '../../utils/echarts'
import DashboardGrid from './DashboardGrid.vue'
import DashboardPanel from './DashboardPanel.vue'
import { numberText, statusLabel } from './dashboardFormat'

const props = defineProps<{
  stats: any
  riskLevel: { type: string; label: string }
  riskItems: Array<{ label: string; value: number; hint: string; type: string }>
  riskTotal: number
}>()

const typeChartEl = ref<HTMLElement>()
const statusChartEl = ref<HTMLElement>()
let typeChart: echarts.ECharts | null = null
let statusChart: echarts.ECharts | null = null

const themeColor = (name: string, fallbackVar = '--color-primary') => {
  if (typeof window === 'undefined') return 'currentColor'
  const styles = getComputedStyle(document.documentElement)
  return styles.getPropertyValue(name).trim()
    || styles.getPropertyValue(fallbackVar).trim()
    || 'currentColor'
}

const chartPalette = () => [
  themeColor('--chart-blue'),
  themeColor('--chart-amber', '--color-warning'),
  themeColor('--chart-green', '--color-success'),
  themeColor('--color-primary'),
  themeColor('--color-warning'),
  themeColor('--chart-red', '--color-danger'),
]

const drawTypeChart = () => {
  if (!typeChartEl.value || !props.stats.instances?.by_type?.length) return
  if (!typeChart) typeChart = echarts.init(typeChartEl.value)
  typeChart.setOption({
    color: chartPalette(),
    tooltip: { trigger: 'item' },
    legend: { bottom: 0, textStyle: { color: 'var(--color-text-secondary)' } },
    series: [{
      type: 'pie',
      radius: ['48%', '72%'],
      center: ['50%', '44%'],
      avoidLabelOverlap: true,
      label: { color: 'var(--color-text)' },
      data: props.stats.instances.by_type.map((type: any) => ({ name: type.type, value: type.c })),
    }],
  })
}

const drawStatusChart = () => {
  if (!statusChartEl.value) return
  if (!statusChart) statusChart = echarts.init(statusChartEl.value)
  const data = props.stats.instances?.by_status?.length
    ? props.stats.instances.by_status.map((status: any) => ({ name: statusLabel(status.status), value: status.c }))
    : [{ name: '暂无数据', value: 1 }]
  statusChart.setOption({
    color: chartPalette(),
    tooltip: { trigger: 'item' },
    legend: { bottom: 0, textStyle: { color: 'var(--color-text-secondary)' } },
    series: [{
      type: 'pie',
      radius: ['0%', '68%'],
      center: ['50%', '44%'],
      label: { color: 'var(--color-text)' },
      data,
    }],
  })
}

const drawCharts = async () => {
  await nextTick()
  drawTypeChart()
  drawStatusChart()
}

const resize = () => {
  typeChart?.resize()
  statusChart?.resize()
}

watch(() => props.stats.instances, drawCharts, { deep: true })

onMounted(() => {
  drawCharts()
  window.addEventListener('resize', resize)
})

onUnmounted(() => {
  window.removeEventListener('resize', resize)
  typeChart?.dispose()
  statusChart?.dispose()
})
</script>

<style scoped>
.chart-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.chart-box {
  border: 1px solid var(--color-border);
  border-radius: 16px;
  background: var(--color-background);
  padding: 12px;
}

.chart-title {
  color: var(--color-text-secondary);
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
  border: 1px solid var(--el-border-color-light);
  border-radius: 18px;
  color: var(--el-text-color-primary);
}

.risk-score--success { background: rgba(58, 159, 115, 0.12); color: var(--color-success); }
.risk-score--warning { background: rgba(215, 154, 69, 0.14); color: var(--color-warning); }
.risk-score--danger { background: rgba(209, 102, 102, 0.13); color: var(--color-danger); }

.risk-score span,
.risk-score small {
  color: var(--el-text-color-secondary);
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
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: var(--color-background);
}

.risk-row div {
  display: grid;
  gap: 4px;
}

.risk-row span {
  color: var(--color-text);
  font-weight: 750;
}

.risk-row small {
  color: var(--color-text-secondary);
}

@media (max-width: 768px) {
  .chart-grid {
    grid-template-columns: 1fr;
  }
}
</style>
