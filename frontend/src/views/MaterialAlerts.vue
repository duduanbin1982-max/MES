<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title">⚠️ 物料预警 + MRP + 齐套分析</div>
      <div>
        <el-select v-model="selectedInstance" placeholder="选实例" style="width: 240px; margin-right: 8px" @change="loadAlerts">
          <el-option v-for="i in instances" :key="i.id" :label="i.instance_code + ' | ' + (i.instance_name || '')" :value="i.id" />
        </el-select>
        <el-button @click="loadAlerts">刷新</el-button>
        <el-tag v-if="autoRefresh" type="success" size="small" style="margin-left: 8px">自动刷新 60s</el-tag>
      </div>
    </div>

    <div v-if="!selectedInstance && tab==='alerts'" style="text-align: center; padding: 40px">
      <el-empty description="选实例查看物料预警" />
    </div>

    <el-tabs v-model="tab">
      <!-- ========== Tab 1: 物料预警 + 齐套分析 (existing) ========== -->
      <el-tab-pane label="物料预警" name="alerts">
        <div v-if="selectedInstance" v-loading="loading">
          <el-card style="margin-bottom: 16px">
            <template #header>
              <span style="font-weight: 500">📦 物料预警 (长交期件倒推)</span>
            </template>
            <el-row :gutter="16" style="margin-bottom: 12px">
              <el-col :span="6">
                <div class="stat-card" style="text-align: center">
                  <div class="stat-label">关键件总数</div>
                  <div class="stat-value">{{ alerts.summary?.total_components || 0 }}</div>
                </div>
              </el-col>
              <el-col :span="6">
                <div class="stat-card" style="text-align: center">
                  <div class="stat-label">已备齐</div>
                  <div class="stat-value" style="color: #67c23a">{{ alerts.summary?.by_status?.ready || 0 }}</div>
                </div>
              </el-col>
              <el-col :span="6">
                <div class="stat-card" style="text-align: center">
                  <div class="stat-label">紧急 (≤14天)</div>
                  <div class="stat-value" style="color: #f56c6c">{{ alerts.summary?.by_status?.urgent || 0 }}</div>
                </div>
              </el-col>
              <el-col :span="6">
                <div class="stat-card" style="text-align: center">
                  <div class="stat-label">已逾期</div>
                  <div class="stat-value" style="color: #e6a23c">{{ alerts.summary?.by_status?.overdue || 0 }}</div>
                </div>
              </el-col>
            </el-row>
            <el-table :data="alerts.alerts || []" stripe size="small">
              <el-table-column label="状态" width="90">
                <template #default="{ row }">
                  <el-tag :type="alertTagType(row.alert_status)" size="small">{{ alertLabel(row.alert_status) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="material_name" label="物料" min-width="180" />
              <el-table-column prop="supplier" label="供应商" width="100" />
              <el-table-column label="需求/库存" width="100" align="center">
                <template #default="{ row }">{{ row.required_qty }} / {{ row.in_stock_qty }}</template>
              </el-table-column>
              <el-table-column prop="lead_time_weeks" label="交期(周)" width="80" align="center" />
              <el-table-column prop="order_deadline" label="下单截止" width="110" />
              <el-table-column prop="days_to_deadline" label="剩(天)" width="80" align="right">
                <template #default="{ row }">
                  <span :style="{color: row.days_to_deadline < 0 ? '#f56c6c' : row.days_to_deadline < 14 ? '#e6a23c' : '#67c23a'}">{{ row.days_to_deadline }}</span>
                </template>
              </el-table-column>
              <el-table-column prop="alert_message" label="建议" min-width="200" />
            </el-table>
          </el-card>

          <el-card>
            <template #header>
              <span style="font-weight: 500">🔧 齐套分析 (工单开工检查)</span>
            </template>
            <el-row :gutter="16" style="margin-bottom: 12px">
              <el-col :span="6">
                <div class="stat-card" style="text-align: center">
                  <div class="stat-label">工单总数</div>
                  <div class="stat-value">{{ kit.stats?.total || 0 }}</div>
                </div>
              </el-col>
              <el-col :span="6">
                <div class="stat-card" style="text-align: center">
                  <div class="stat-label">可开工</div>
                  <div class="stat-value" style="color: #67c23a">{{ kit.stats?.ready || 0 }}</div>
                </div>
              </el-col>
              <el-col :span="6">
                <div class="stat-card" style="text-align: center">
                  <div class="stat-label">部分齐套</div>
                  <div class="stat-value" style="color: #e6a23c">{{ kit.stats?.partial || 0 }}</div>
                </div>
              </el-col>
              <el-col :span="6">
                <div class="stat-card" style="text-align: center">
                  <div class="stat-label">被卡 (缺关键件)</div>
                  <div class="stat-value" style="color: #f56c6c">{{ kit.stats?.blocked || 0 }}</div>
                </div>
              </el-col>
            </el-row>
            <el-collapse>
              <el-collapse-item v-for="w in kit.work_orders || []" :key="w.work_order.id" :name="String(w.work_order.id)">
                <template #title>
                  <span>
                    <el-tag :type="kitTagType(w.kit_status)" size="small" style="margin-right: 8px">{{ w.kit_status }}</el-tag>
                    <strong>{{ w.work_order.code }}</strong> · {{ w.work_order.title }}
                    <span style="color: #909399; margin-left: 12px">缺 {{ w.total_shortage }} 项 (关键 {{ w.critical_shortage }})</span>
                  </span>
                </template>
                <el-table :data="w.items" stripe size="small">
                  <el-table-column prop="code" label="编码" width="140" />
                  <el-table-column prop="name" label="名称" min-width="180" />
                  <el-table-column label="需求/库存" width="100" align="center">
                    <template #default="{ row }">{{ row.required_qty }} / {{ row.in_stock_qty || 0 }}</template>
                  </el-table-column>
                  <el-table-column label="缺料" width="80" align="center">
                    <template #default="{ row }">
                      <span :style="{color: row.shortage > 0 ? '#f56c6c' : '#67c23a', fontWeight: 600}">{{ row.shortage }}</span>
                    </template>
                  </el-table-column>
                  <el-table-column label="关键" width="60" align="center">
                    <template #default="{ row }">
                      <el-tag v-if="row.is_key" type="danger" size="small" effect="dark">⭐</el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column label="交期(周)" width="80" align="center">
                    <template #default="{ row }">{{ row.lead_time || '-' }}</template>
                  </el-table-column>
                </el-table>
              </el-collapse-item>
            </el-collapse>
            <el-empty v-if="!kit.work_orders?.length" description="没有工单" :image-size="60" />
          </el-card>
        </div>
      </el-tab-pane>

      <!-- ========== Tab 2: MRP 计算 ========== -->
      <el-tab-pane label="MRP 计算" name="mrp">
        <el-card style="margin-bottom:12px">
          <div class="tb">
            <el-select v-model="mrp.instance_id" placeholder="装备实例" style="width:240px">
              <el-option v-for="i in instances" :key="i.id" :label="i.instance_code + ' | ' + (i.instance_name||'')" :value="i.id" />
            </el-select>
            <el-date-picker v-model="mrp.demand_date" type="date" placeholder="需求日期" style="width:180px" />
            <el-button type="primary" @click="runMrp" :loading="mrpLoading">MRP 计算</el-button>
            <el-button v-if="mrpResult.length" type="success" @click="openPurchaseFromMrp">生成采购建议</el-button>
          </div>
        </el-card>
        <el-table v-if="mrpResult.length" :data="mrpResult" stripe size="small" max-height="500">
          <el-table-column prop="material_name" label="物料名称" min-width="180" />
          <el-table-column prop="bom_qty" label="BOM用量" width="90" align="center" />
          <el-table-column prop="stock_on_hand" label="现有库存" width="100" align="center" />
          <el-table-column prop="allocated" label="已分配" width="90" align="center" />
          <el-table-column prop="net_required" label="净需求" width="90" align="center">
            <template #default="{row}">
              <span :style="{color: row.net_required > 0 ? '#f56c6c' : '#67c23a', fontWeight: 600}">{{ row.net_required }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="suggested_order" label="建议订货量" width="110" align="center" />
          <el-table-column prop="lead_time_days" label="交期(天)" width="90" align="center" />
          <el-table-column prop="order_by_date" label="下单截止" width="110" />
          <el-table-column label="状态" width="80">
            <template #default="{row}">
              <el-tag :type="row.net_required > 0 ? 'danger' : 'success'" size="small">{{ row.net_required > 0 ? '需采购' : '充足' }}</el-tag>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-else description="选择实例和需求日期，点击 MRP 计算" :image-size="80" />
      </el-tab-pane>

      <!-- ========== Tab 3: 短缺预测 ========== -->
      <el-tab-pane label="短缺预测" name="forecast">
        <el-card style="margin-bottom:12px">
          <div class="tb">
            <span style="font-weight:500;margin-right:8px">预测周数:</span>
            <el-radio-group v-model="forecast.weeks" size="small" @change="loadForecast">
              <el-radio-button :label="2">2周</el-radio-button>
              <el-radio-button :label="4">4周</el-radio-button>
              <el-radio-button :label="8">8周</el-radio-button>
            </el-radio-group>
          </div>
        </el-card>
        <div v-if="forecast.chartData" ref="forecastChartRef" style="width:100%;height:300px;margin-bottom:16px"></div>
        <el-table v-if="forecast.data.length" :data="forecast.data" stripe size="small" max-height="400">
          <el-table-column prop="week_label" label="周次" width="100" />
          <el-table-column prop="material_name" label="物料" min-width="180" />
          <el-table-column prop="forecast_demand" label="预测需求" width="100" align="center" />
          <el-table-column prop="current_stock" label="当前库存" width="100" align="center" />
          <el-table-column prop="projected_balance" label="预计结余" width="100" align="center">
            <template #default="{row}">
              <span :style="{color: row.projected_balance < 0 ? '#f56c6c' : row.projected_balance < 10 ? '#e6a23c' : '#67c23a', fontWeight: 600}">{{ row.projected_balance }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{row}">
              <el-tag :type="row.status==='Critical'?'danger':row.status==='Warning'?'warning':'success'" size="small">{{ row.status }}</el-tag>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!forecast.data.length" description="选择预测周数自动加载" :image-size="80" />
      </el-tab-pane>

      <!-- ========== Tab 4: 交货期管理 ========== -->
      <el-tab-pane label="交货期管理" name="leadtimes">
        <div class="tb">
          <el-button type="primary" @click="loadLeadTimes">刷新</el-button>
        </div>
        <el-table :data="leadTimes" stripe size="small" v-loading="ltLoading" style="margin-top:10px">
          <el-table-column prop="material_name" label="物料" min-width="200" />
          <el-table-column prop="supplier_name" label="供应商" min-width="160" />
          <el-table-column prop="lead_time_days" label="交期(天)" width="120" align="center">
            <template #default="{row}">
              <span v-if="!row._editing">{{ row.lead_time_days }}</span>
              <el-input-number v-else v-model="row._lead_time_days" :min="1" :max="999" size="small" style="width:100px" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="160">
            <template #default="{row}">
              <template v-if="!row._editing">
                <el-button size="small" link @click="startEditLT(row)">编辑</el-button>
              </template>
              <template v-else>
                <el-button size="small" link type="primary" @click="saveLeadTime(row)">保存</el-button>
                <el-button size="small" link @click="cancelEditLT(row)">取消</el-button>
              </template>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { Api } from '../api'
import * as echarts from 'echarts'
import { useRouter } from 'vue-router'

const router = useRouter()
const tab = ref('alerts')

// ============ Shared ============
const instances = ref<any[]>([])
const selectedInstance = ref<any>(undefined)
const loading = ref(false)
const autoRefresh = ref(true)
let refreshTimer: ReturnType<typeof setInterval> | null = null

// ============ Tab 1: Alerts + Kit Check ============
const alerts = ref<any>({})
const kit = ref<any>({})
const alertTagType = (s: string) => ({ overdue: 'danger', urgent: 'danger', warning: 'warning', planned: 'info', ready: 'success', ok: 'success' }[s] || 'info')
const alertLabel = (s: string) => ({ overdue: '已逾期', urgent: '紧急', warning: '预警', planned: '计划', ready: '已备齐', ok: 'OK' }[s] || s)
const kitTagType = (s: string) => ({ ready: 'success', partial: 'warning', blocked: 'danger' }[s] || 'info')

const loadAlerts = async () => {
  if (!selectedInstance.value) return
  loading.value = true
  try {
    const [a, k] = await Promise.all([
      Api.get('/equipment_instances/' + selectedInstance.value + '/material_alerts'),
      Api.get('/equipment_instances/' + selectedInstance.value + '/kit_check')
    ])
    alerts.value = a
    kit.value = k
  } catch (e) {
    console.error('[MaterialAlerts] load failed:', e)
  } finally { loading.value = false }
}

// ============ Tab 2: MRP ============
const mrp = reactive({ instance_id: null as any, demand_date: '' })
const mrpLoading = ref(false)
const mrpResult = ref<any[]>([])

const runMrp = async () => {
  if (!mrp.instance_id || !mrp.demand_date) return
  mrpLoading.value = true
  try {
    mrpResult.value = await Api.post('/material-planner/mrp', {
      equipment_instance_id: mrp.instance_id,
      demand_date: mrp.demand_date
    })
  } catch (e: any) {
    console.error('[MRP] failed:', e)
  } finally { mrpLoading.value = false }
}

const openPurchaseFromMrp = () => {
  router.push('/purchase')
}

// ============ Tab 3: Forecast ============
const forecast = reactive({ weeks: 4, data: [] as any[], chartData: null as any })
const forecastChartRef = ref<HTMLElement | null>(null)
var forecastChart: any = null

const loadForecast = async () => {
  try {
    forecast.data = await Api.get('/material-planner/shortage-forecast', { params: { weeks: forecast.weeks } })
    if (forecast.data.length) buildForecastChart()
  } catch (e: any) {
    console.error('[Forecast] failed:', e)
    forecast.data = []
  }
}

const buildForecastChart = () => {
  nextTick(() => {
    const el = forecastChartRef.value
    if (!el) return
    if (forecastChart) forecastChart.dispose()
    forecastChart = echarts.init(el)

    const weeks = [...new Set(forecast.data.map((r: any) => r.week_label))]
    const materials = [...new Set(forecast.data.map((r: any) => r.material_name))]

    const series = materials.map(m => {
      const d = forecast.data.filter((r: any) => r.material_name === m)
      return {
        name: m, type: 'line', data: weeks.map(w => {
          const f = d.find((r: any) => r.week_label === w)
          return f ? f.projected_balance : null
        }), smooth: true
      }
    })

    forecastChart.setOption({
      tooltip: { trigger: 'axis' },
      legend: { type: 'scroll', bottom: 0 },
      grid: { left: 50, right: 20, top: 20, bottom: 40 },
      xAxis: { type: 'category', data: weeks },
      yAxis: { type: 'value', name: '库存' },
      series
    })
  })
}

// ============ Tab 4: Lead Times ============
const leadTimes = ref<any[]>([])
const ltLoading = ref(false)

const loadLeadTimes = async () => {
  ltLoading.value = true
  try {
    leadTimes.value = (await Api.get('/material-planner/lead-times')).map((r: any) => ({
      ...r, _editing: false, _lead_time_days: r.lead_time_days
    }))
  } catch { leadTimes.value = [] }
  finally { ltLoading.value = false }
}

const startEditLT = (row: any) => {
  row._editing = true
  row._lead_time_days = row.lead_time_days
}

const cancelEditLT = (row: any) => {
  row._editing = false
  row._lead_time_days = row.lead_time_days
}

const saveLeadTime = async (row: any) => {
  try {
    await Api.put('/material-planner/lead-times/' + row.id, {
      lead_time_days: row._lead_time_days
    })
    row.lead_time_days = row._lead_time_days
    row._editing = false
  } catch (e: any) {
    console.error('[LeadTimes] save failed:', e)
  }
}

// ============ Lifecycle ============
const startAutoRefresh = () => {
  if (refreshTimer) return
  refreshTimer = setInterval(() => {
    if (selectedInstance.value && autoRefresh.value && tab.value === 'alerts') loadAlerts()
  }, 60000)
}

onMounted(async () => {
  instances.value = await Api.instances()
  if (instances.value.length > 0) {
    selectedInstance.value = instances.value[0].id
    await loadAlerts()
  }
  startAutoRefresh()
  loadLeadTimes()
})

onUnmounted(() => {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null }
  if (forecastChart) forecastChart.dispose()
})
</script>

<style scoped>
.page{padding:16px 24px}
.page-header{margin-bottom:16px;display:flex;justify-content:space-between;align-items:center}
.page-title{font-size:20px;font-weight:600}
.tb{display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap}
.stat-card{padding:8px}
.stat-label{font-size:12px;color:#909399;margin-bottom:4px}
.stat-value{font-size:24px;font-weight:700;color:#303133}
</style>