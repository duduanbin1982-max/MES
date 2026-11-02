<template>
  <div class="dashboard-page">
    <DashboardHero :updated-at="updatedAt" :loading="loading" @refresh="loadAll" />

    <PageState
      v-if="loading && !updatedAt"
      state="loading"
      title="正在加载首页驾驶舱"
      description="正在汇总项目交付、风险、OEE 与现场状态。"
    />
    <PageState
      v-else-if="loadError"
      state="error"
      title="首页驾驶舱加载失败"
      :description="loadError"
      action-text="重新加载"
      @retry="loadAll"
    />
    <template v-else>
      <el-alert
        v-if="partialErrors.length"
        class="dashboard-alert"
        type="warning"
        :closable="false"
        show-icon
      >
        <template #title>部分数据暂时不可用，首页已使用兜底数据展示</template>
        <div class="partial-error-list">
          <span v-for="item in partialErrors" :key="item.key">{{ item.label }}：{{ item.message }}</span>
        </div>
      </el-alert>

      <DashboardKpiGrid
        :stats="stats"
        :live="live"
        :in-progress="inProgress"
        :completed="completed"
        :risk-total="riskTotal"
        :delays-total="delaysSummary.total"
        :execution-delays="executionDelays"
        :plan-overdue="planOverdue"
        :fleet-utilization="fleetUtilization"
      />
      <ProcessHealthCard
        :data="processHealth"
        :loading="healthLoading"
        @refresh="loadProcessHealth()"
        @select="onHealthSelect"
      />
      <DashboardProjectRisk
        :stats="stats"
        :risk-level="riskLevel"
        :risk-items="riskItems"
        :risk-total="riskTotal"
      />
      <DashboardOeeLive
        :oee="oee"
        :live="live"
        :utilization-tone="utilizationTone"
      />
      <DashboardInstanceRiskTables
        :recent-instances="recentInstances"
        :long-leadtime="longLeadtime"
        :delays-summary="delaysSummary"
        :delays-top="delaysTop"
        @instance-click="goInstance"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Api } from '../api'
import PageState from '../components/PageState.vue'
import DashboardHero from './dashboard/DashboardHero.vue'
import DashboardKpiGrid from './dashboard/DashboardKpiGrid.vue'
import DashboardProjectRisk from './dashboard/DashboardProjectRisk.vue'
import DashboardOeeLive from './dashboard/DashboardOeeLive.vue'
import DashboardInstanceRiskTables from './dashboard/DashboardInstanceRiskTables.vue'
import ProcessHealthCard from './dashboard/ProcessHealthCard.vue'

type DashboardRequestKey = 'dashboard' | 'riskSummary' | 'instances' | 'longLeadtime' | 'liveStatus' | 'delaysSummary' | 'delays' | 'oee'
type DashboardRiskLevel = { type: 'success' | 'warning' | 'danger'; label: string }
type DashboardRiskItem = { key?: string; label: string; value: number; hint: string; type: string }

const router = useRouter()
const route = useRoute()
const loading = ref(false)
const stats = ref<any>(defaultStats())
const live = ref<any>(defaultLiveStatus())
const recentInstances = ref<any[]>([])
const longLeadtime = ref<any[]>([])
const updatedAt = ref('')
const loadError = ref('')
const partialErrors = ref<Array<{ key: DashboardRequestKey; label: string; message: string }>>([])
const riskSummary = ref<any>(defaultRiskSummary())
// 2026-10-19：全流程健康检查（8 环节体检）
const processHealth = ref<any>({ instances: [], selected: null })
const healthLoading = ref(false)

const loadProcessHealth = async (instanceId?: number) => {
  const requested = instanceId ?? (Number(route.query.instance_id) || undefined)
  healthLoading.value = true
  try {
    const params = requested ? { instance_id: requested } : {}
    processHealth.value = await Api.get('/dashboard/process-health', { params })
  } catch (_error) {
    // 体检失败不阻断仪表盘主体
    processHealth.value = { instances: [], selected: null }
  } finally {
    healthLoading.value = false
  }
}

/** 切换体检项目：先拉数据，再同步 URL（失败也不影响已加载的数据） */
const onHealthSelect = async (instanceId: number) => {
  await loadProcessHealth(instanceId)
  try {
    await router.replace({ query: { ...route.query, instance_id: String(instanceId) } })
  } catch (_error) { /* 忽略路由同步失败 */ }
}

// 支持手改 URL / 前进后退（深链）
watch(
  () => route.query.instance_id,
  (value) => {
    const id = Number(value) || undefined
    if (id && Number(processHealth.value?.selected?.instance_id) === id) return
    loadProcessHealth(id)
  },
)

const inProgress = computed(() => stats.value.work_orders?.by_status?.find((s: any) => s.status === 'in_progress')?.c || 0)
const completed = computed(() => stats.value.work_orders?.by_status?.find((s: any) => s.status === 'completed')?.c || 0)
const fleetUtilization = computed(() => Number(oee.value.summary?.fleet_utilization_pct || live.value.utilization || 0))
// 2026-11-02：延误拆两档（已开工超期 / 未开工计划过期）
const executionDelays = computed(() => Number(riskSummary.value.sources?.delays_started ?? riskSummary.value.delays?.started?.total ?? 0))
const planOverdue = computed(() => Number(riskSummary.value.sources?.delays_not_started ?? riskSummary.value.delays?.not_started?.total ?? 0))
const riskTotal = computed(() => Number(riskSummary.value.total || 0))
const riskLevel = computed<DashboardRiskLevel>(() => riskSummary.value.level || defaultRiskSummary().level)
const riskItems = computed<DashboardRiskItem[]>(() => riskSummary.value.items || defaultRiskSummary().items)
const utilizationTone = computed(() => {
  const value = Number(live.value.utilization || 0)
  if (value >= 70) return 'success'
  if (value >= 40) return 'warning'
  return 'danger'
})

const goInstance = (row: any) => router.push(`/instances/${row.id}`)

const delaysSummary = ref(defaultDelaySummary())
const delaysTop = ref<any[]>([])
const oee = ref<any>(defaultOee())

function defaultStats() {
  return {
    equipment_types: 0,
    equipment_models: 0,
    instances: { total: 0, by_status: [] },
    work_orders: { total: 0, by_status: [] },
    process_nodes: { total: 0, by_status: [] },
    bom_total: 0,
    key_components: 0,
    long_leadtime: 0,
    open_eco: 0,
    open_field_service: 0,
  }
}

function defaultLiveStatus() {
  return {
    equipment_total: 0,
    equipment_busy: 0,
    equipment_idle: 0,
    utilization: 0,
    wo_in_progress: 0,
    pn_in_progress: 0,
    by_subsystem: [],
    recent_starts: [],
  }
}

function defaultDelaySummary() {
  return { work_order_delays: 0, process_node_delays: 0, total: 0, today: '' }
}

function defaultOee() {
  return { summary: {}, workstations: [] }
}

function defaultRiskSummary() {
  return {
    total: 0,
    level: { type: 'success', label: '平稳' } as DashboardRiskLevel,
    delays: defaultDelaySummary(),
    sources: { delays: 0, long_leadtime: 0, open_eco: 0, open_field_service: 0 },
    items: [
      { key: 'delays_started', label: '执行中超期', value: 0, hint: '已开工但超计划完成时间', type: 'success' },
      { key: 'delays_not_started', label: '未开工计划过期', value: 0, hint: '计划时间已过但尚未开工（需重排程）', type: 'success' },
      { key: 'long_leadtime', label: '长交期关键件', value: 0, hint: '采购到货风险', type: 'success' },
      { key: 'open_eco', label: '待处理 ECO', value: 0, hint: '设计变更影响', type: 'success' },
      { key: 'open_field_service', label: '服务工单', value: 0, hint: '现场/售后问题', type: 'success' },
    ] as DashboardRiskItem[],
  }
}

const requestLabels: Record<DashboardRequestKey, string> = {
  dashboard: '首页汇总',
  riskSummary: '风险口径',
  instances: '装备实例',
  longLeadtime: '长交期关键件',
  liveStatus: '现场状态',
  delaysSummary: '延误汇总',
  delays: '延误明细',
  oee: 'OEE',
}

const messageOf = (reason: any) => reason?.response?.data?.error
  || reason?.response?.data?.message
  || reason?.message
  || '接口暂时不可用'

function normalizeRiskSummary(value: any) {
  const fallback = defaultRiskSummary()
  const source = value && typeof value === 'object' ? value : {}
  const items = Array.isArray(source.items) && source.items.length ? source.items : fallback.items
  const level = source.level?.type ? source.level : fallback.level
  return {
    ...fallback,
    ...source,
    total: Number(source.total ?? fallback.total),
    level,
    delays: { ...fallback.delays, ...(source.delays || {}) },
    sources: { ...fallback.sources, ...(source.sources || {}) },
    items: items.map((item: any) => ({
      key: item.key,
      label: item.label || '未命名风险',
      value: Number(item.value || 0),
      hint: item.hint || '',
      type: item.type || (Number(item.value || 0) > 0 ? 'warning' : 'success'),
    })),
  }
}

function normalizeDelaySummary(value: any) {
  return { ...defaultDelaySummary(), ...(value || {}) }
}

const loadAll = async () => {
  loading.value = true
  loadError.value = ''
  partialErrors.value = []
  const requests: Array<[DashboardRequestKey, Promise<any>]> = [
    ['dashboard', Api.dashboard()],
    ['riskSummary', Api.riskSummary()],
    ['instances', Api.instances()],
    ['longLeadtime', Api.longLeadtime()],
    ['liveStatus', Api.liveStatus()],
    ['delaysSummary', Api.delaysSummary()],
    ['delays', Api.delays({ limit: 5 })],
    ['oee', Api.oee({ days: 14 })],
  ]

  const settled = await Promise.allSettled(requests.map(([, request]) => request))
  const values: Partial<Record<DashboardRequestKey, any>> = {}
  const nextErrors: Array<{ key: DashboardRequestKey; label: string; message: string }> = []
  let successCount = 0

  settled.forEach((result, index) => {
    const key = requests[index][0]
    if (result.status === 'fulfilled') {
      values[key] = result.value
      successCount += 1
    } else {
      nextErrors.push({ key, label: requestLabels[key], message: messageOf(result.reason) })
    }
  })

  if (successCount === 0) {
    loadError.value = '首页接口全部不可用，请检查后端服务状态后重试。'
    loading.value = false
    return
  }

  const queryInstance = Number(new URLSearchParams(window.location.search).get('instance_id')) || undefined
  loadProcessHealth(queryInstance)

  const dashboardStats = values.dashboard || defaultStats()
  const dashboardRisk = values.riskSummary || dashboardStats.risk_summary
  stats.value = { ...defaultStats(), ...dashboardStats }
  riskSummary.value = normalizeRiskSummary(dashboardRisk)
  recentInstances.value = Array.isArray(values.instances) ? values.instances.slice(0, 5) : []
  longLeadtime.value = Array.isArray(values.longLeadtime) ? values.longLeadtime : []
  live.value = { ...defaultLiveStatus(), ...(values.liveStatus || {}) }
  delaysSummary.value = normalizeDelaySummary(values.delaysSummary || riskSummary.value.delays)
  delaysTop.value = Array.isArray(values.delays?.items) ? values.delays.items : []
  oee.value = values.oee || defaultOee()
  partialErrors.value = nextErrors
  updatedAt.value = new Date().toLocaleString('zh-CN', { hour12: false })
  loading.value = false
}

onMounted(() => {
  loadAll()
})
</script>

<style scoped>
.dashboard-page {
  min-height: 100%;
  padding: 22px;
  background:
    radial-gradient(circle at top left, rgba(79, 127, 168, 0.10), transparent 360px),
    radial-gradient(circle at top right, rgba(197, 138, 58, 0.08), transparent 320px),
    linear-gradient(180deg, var(--el-bg-color-page) 0%, var(--color-surface-muted) 100%);
  color: var(--color-text);
  font-family: var(--el-font-family);
}

.dashboard-alert {
  margin-bottom: 16px;
  border-radius: 14px;
}

.partial-error-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  margin-top: 6px;
  color: var(--color-text-secondary);
  font-size: 12px;
}

@media (max-width: 768px) {
  .dashboard-page {
    padding: 12px;
  }
}
</style>
