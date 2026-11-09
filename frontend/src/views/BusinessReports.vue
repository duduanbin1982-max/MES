<template>
  <div class="page">
    <PageToolbar class="page-header">
      <div class="page-title"><el-icon><DataAnalysis /></el-icon> 经营分析报表</div>
    </PageToolbar>

    <el-card style="margin-bottom:12px">
      <div class="tb">
        <el-select v-model="business.instance_id" placeholder="装备实例 (可选)" clearable style="width:240px">
          <el-option v-for="i in instances" :key="i.id" :label="i.instance_code + ' | ' + (i.instance_name||'')" :value="i.id" />
        </el-select>
        <el-date-picker v-model="business.dateRange" type="daterange" range-separator="至" start-placeholder="开始" end-placeholder="结束" style="width:280px" />
        <el-button type="primary" @click="loadBusinessReports" :loading="businessLoading">刷新经营分析</el-button>
      </div>
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="经营分析报表聚合全口径成本、交付、质量和 OEE；项目/日期筛选对成本、交付、质量、OEE 生效（成本报表按项目，不按日期截断）。报表中心负责通用报表生成、定时与历史。"
      />
    </el-card>

    <el-row :gutter="12" v-loading="businessLoading">
      <el-col v-for="item in businessReports" :key="item.type" :span="12">
        <el-card class="business-card">
          <template #header>
            <div class="card-header">
              <span>{{ item.label }}</span>
              <el-button link size="small" @click="goInstantReport(item.type)">去报表中心生成</el-button>
            </div>
          </template>
          <div v-if="item.error" class="business-error">{{ item.error }}</div>
          <template v-else>
            <div v-if="summaryEntries(item.result).length" class="business-summary">
              <div v-for="[key, val] in summaryEntries(item.result)" :key="key" class="mini-stat">
                <span class="mini-stat-label">{{ key }}</span>
                <span class="mini-stat-value">{{ val }}</span>
              </div>
            </div>
            <el-table v-if="item.result?.rows?.length" :data="item.result.rows.slice(0, 6)" stripe size="small" max-height="260">
              <el-table-column v-for="col in reportColumns(item.result)" :key="col" :prop="col" :label="col" min-width="110" show-overflow-tooltip />
            </el-table>
            <PageState state="empty" compact :show-action="false" v-else description="暂无经营数据" />
          </template>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Api } from '../api'
import { ElMessage } from 'element-plus'

const router = useRouter()
const instances = ref<any[]>([])
const businessTypes = [
  { type: 'cost_summary', label: '项目成本与毛利（全口径）' },
  { type: 'daily_production', label: '交付与生产进度' },
  { type: 'quality_monthly', label: '质量趋势' },
  { type: 'oee_weekly', label: '设备绩效 OEE' },
]
const business = reactive({ instance_id: null as any, dateRange: null as any })
const businessLoading = ref(false)
const businessReports = ref<any[]>([])

const fmtDate = (value: any) => {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}
const errText = (e: any) => e?.response?.data?.error || e?.response?.data?.message || e?.message || String(e)
const buildReportFilters = () => {
  const filters: any = {}
  if (business.instance_id) filters.instance_id = business.instance_id
  if (business.dateRange) {
    filters.from = fmtDate(business.dateRange[0])
    filters.to = fmtDate(business.dateRange[1])
  }
  return filters
}

const loadBusinessReports = async () => {
  businessLoading.value = true
  const filters = buildReportFilters()
  try {
    businessReports.value = await Promise.all(businessTypes.map(async (item) => {
      try {
        const result = await Api.post('/reports/generate', { type: item.type, filters })
        return { ...item, result }
      } catch (e: any) {
        return { ...item, error: errText(e) }
      }
    }))
  } finally {
    businessLoading.value = false
  }
}

const SUMMARY_LABELS: Record<string, string> = {
  total_projects: '项目数', total_contract: '合同额(元)', total_actual_cost: '全口径成本(元)',
  total_gross_margin: '毛利(元)', total_margin_pct: '毛利率', total_material_cost: '物料成本(元)',
  total_labor_cost: '人工成本(元)', total_outsourcing_cost: '其他成本(元)', total: '记录数',
  completed: '已完成', in_progress: '进行中', pending: '待开始', pass: '合格', fail: '不合格',
  pass_rate: '合格率', avg_oee: '平均 OEE', avg_availability: '平均可用率',
  avg_performance: '平均性能', avg_quality: '平均质量',
}
const formatSummaryValue = (key: string, value: any) => {
  if (typeof value === 'number') {
    const number = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)
    return key.includes('pct') ? number + '%' : number
  }
  return value
}
const summaryEntries = (result: any) => Object.entries(result?.summary || {}).slice(0, 6)
  .map(([key, value]) => [SUMMARY_LABELS[key] || key, formatSummaryValue(key, value)])
const reportColumns = (result: any) => result?.columns || Object.keys(result?.rows?.[0] || {})
const goInstantReport = (type: string) => router.push({ path: '/reports', query: { tab: 'instant', type } })

onMounted(async () => {
  try { instances.value = await Api.instances() } catch (e: any) { ElMessage.error('加载实例失败: ' + errText(e)) }
  loadBusinessReports()
})
</script>

<style scoped>
.page{padding:16px 24px}
.page-header{margin-bottom:16px}
.page-title{font-size:20px;font-weight:600}
.tb{display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap}
.card-header{display:flex;justify-content:space-between;align-items:center;gap:12px}
.business-card{margin-bottom:12px;min-height:360px}
.business-summary{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px}
.business-error{color:var(--el-color-danger);font-size:13px;padding:16px;background:var(--el-color-danger-light-9);border-radius:6px}
.mini-stat{background:var(--el-fill-color-light);border-radius:6px;padding:8px 14px;text-align:center;min-width:80px}
.mini-stat-label{display:block;font-size:12px;color:var(--el-color-info)}
.mini-stat-value{display:block;font-size:18px;font-weight:600;color:var(--el-text-color-primary);margin-top:2px}
</style>
