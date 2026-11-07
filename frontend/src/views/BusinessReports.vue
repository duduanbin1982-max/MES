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
        title="经营分析报表聚合成本、交付、质量和 OEE，用于经营层看趋势；报表中心只保留通用报表生成、定时与历史。"
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
  { type: 'cost_summary', label: '项目成本与毛利' },
  { type: 'daily_production', label: '交付与生产进度' },
  { type: 'quality_monthly', label: '质量趋势' },
  { type: 'oee_weekly', label: '设备绩效 OEE' },
]
const business = reactive({ instance_id: null as any, dateRange: null as any })
const businessLoading = ref(false)
const businessReports = ref<any[]>([])

const buildReportFilters = () => {
  const filters: any = {}
  if (business.instance_id) filters.instance_id = business.instance_id
  if (business.dateRange) {
    filters.from = business.dateRange[0]?.toISOString?.() || business.dateRange[0]
    filters.to = business.dateRange[1]?.toISOString?.() || business.dateRange[1]
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
        return { ...item, error: e?.message || String(e) }
      }
    }))
  } finally {
    businessLoading.value = false
  }
}

const summaryEntries = (result: any) => Object.entries(result?.summary || {}).slice(0, 6)
const reportColumns = (result: any) => result?.columns || Object.keys(result?.rows?.[0] || {})
const goInstantReport = (type: string) => router.push({ path: '/reports', query: { tab: 'instant', type } })

onMounted(async () => {
  try { instances.value = await Api.instances() } catch (e: any) { ElMessage.error('加载实例失败: ' + (e?.message || e)) }
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
