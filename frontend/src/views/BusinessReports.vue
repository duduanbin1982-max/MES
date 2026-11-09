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
            <div v-if="trendPoints(item).length" class="mini-trend" title="最近趋势">
              <span v-for="(point, idx) in trendPoints(item)" :key="idx" :style="{ height: point.height + '%' }" :title="point.label"></span>
            </div>
            <el-table v-if="item.result?.rows?.length" :data="item.result.rows" stripe size="small" max-height="260" :row-class-name="item.type === 'cost_summary' ? 'clickable-row' : ''" @row-click="(row: any) => onRowClick(item, row)">
              <el-table-column v-for="col in reportColumns(item.result)" :key="col" :prop="col" :label="columnLabel(col)" min-width="110" show-overflow-tooltip />
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
  total_period_cost: '期间台账成本(元)', total_rework_cost: '返工成本(元)', total_quality_loss_cost: '质量损失(元)', total_other_cost: '其他成本(元)',
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
const COLUMN_LABELS: Record<string, string> = {
  id: 'ID', instance_code: '项目编号', instance_name: '项目名称', contract_no: '合同号',
  contract_amount: '合同原值', contract_amount_unit: '合同单位', contract_yuan: '合同额(元)',
  material_estimated: '物料估算(元)', material_cost: '物料实际(元)', key_component_estimated: '关键件估算(元)',
  key_component_cost: '关键件实际(元)', labor_hours: '实际工时', labor_ledger_cost: '台账人工(元)',
  labor_cost: '人工成本(元)', labor_cost_source: '人工来源', outsourcing_cost: '外协(元)',
  depreciation_cost: '折旧(元)', rework_cost: '返工(元)', quality_loss_cost: '质量损失(元)',
  other_cost: '其他成本(元)', period_cost: '期间台账成本(元)', total_cost: '全口径成本(元)',
  gross_margin: '毛利(元)', margin_pct: '毛利率(%)', delivery: '交付', status: '状态',
  inspection_type: '检验类型', result: '结果', inspection_date: '检验日期', wo_code: '工单号',
  title: '标题', planned_start: '计划开始', planned_end: '计划结束', actual_hours: '实际工时',
  shift_date: '班次日期', shift_name: '班次', oee: 'OEE(%)', availability: '可用率(%)',
  performance: '性能(%)', quality: '质量(%)', total_output: '产量', good_output: '合格数',
}
const columnLabel = (col: string) => COLUMN_LABELS[col] || col
const reportColumns = (result: any) => (result?.columns || Object.keys(result?.rows?.[0] || {}))
  .filter((col: string) => col !== 'period_cost' || Boolean(business.dateRange))
const trendPoints = (item: any) => {
  const rows = item.result?.rows || []
  if (item.type === 'oee_weekly') {
    return rows.slice(0, 12).reverse().map((row: any) => ({ height: Math.max(4, Math.min(100, Number(row.oee || 0))), label: row.shift_date + ' OEE ' + row.oee + '%' }))
  }
  if (item.type === 'quality_monthly') {
    return rows.slice(0, 12).reverse().map((row: any) => ({ height: row.result === 'pass' ? 90 : 25, label: row.inspection_date + ' ' + row.result }))
  }
  if (item.type === 'daily_production') {
    const map: Record<string, number> = { completed: 90, in_progress: 55, pending: 20, cancelled: 10 }
    return rows.slice(0, 12).reverse().map((row: any) => ({ height: map[row.status] || 30, label: row.wo_code + ' ' + row.status }))
  }
  return []
}
const onRowClick = (item: any, row: any) => {
  if (item.type === 'cost_summary' && row?.id) router.push({ path: '/cost-variance', query: { instance_id: row.id } })
}
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
.mini-trend{display:flex;align-items:flex-end;gap:3px;height:46px;padding:4px 2px;margin-bottom:8px}
.mini-trend span{flex:1;min-width:4px;background:var(--el-color-primary-light-5);border-radius:2px 2px 0 0;transition:height .2s}
:deep(.clickable-row){cursor:pointer}
.business-error{color:var(--el-color-danger);font-size:13px;padding:16px;background:var(--el-color-danger-light-9);border-radius:6px}
.mini-stat{background:var(--el-fill-color-light);border-radius:6px;padding:8px 14px;text-align:center;min-width:80px}
.mini-stat-label{display:block;font-size:12px;color:var(--el-color-info)}
.mini-stat-value{display:block;font-size:18px;font-weight:600;color:var(--el-text-color-primary);margin-top:2px}
</style>
