<template>
  <div class="page">
    <PageToolbar class="page-header">
      <div>
        <div class="page-title"><el-icon><DataLine /></el-icon> 采购估价 vs 实际合同价</div>
        <div class="page-subtitle">关键件从采购估价到实际合同价的差异，用于成本归集和采购复盘。</div>
      </div>
      <el-button type="primary" :loading="loading" @click="load">刷新</el-button>
    </PageToolbar>

    <el-row :gutter="16" class="kpi-row">
      <el-col :span="6"><el-card><el-statistic title="关键件数量" :value="summary.component_count || 0" /></el-card></el-col>
      <el-col :span="6"><el-card><el-statistic title="已签合同" :value="summary.contract_signed_count || 0" /></el-card></el-col>
      <el-col :span="6"><el-card><el-statistic title="估价合计" :value="money(summary.total_estimated_price)" /></el-card></el-col>
      <el-col :span="6"><el-card><el-statistic title="实际合计" :value="money(summary.total_actual_price)" /></el-card></el-col>
    </el-row>

    <el-card>
      <template #header>
        <div class="card-header">
          <span>价差明细</span>
          <div class="summary-line">
            <el-tag type="danger" effect="plain">超预算 {{ summary.over_budget_diff || 0 }}</el-tag>
            <el-tag type="success" effect="plain">节约 {{ summary.under_budget_saved || 0 }}</el-tag>
            <el-tag type="warning" effect="plain">待签 {{ summary.pending_count || 0 }}</el-tag>
          </div>
        </div>
      </template>
      <el-table :data="items" stripe size="small" v-loading="loading" height="620" empty-text="暂无采购价差数据">
        <el-table-column prop="component_type" label="关键件" min-width="160" show-overflow-tooltip />
        <el-table-column prop="supplier" label="供应商" min-width="140" show-overflow-tooltip />
        <el-table-column prop="lead_time_weeks" label="交期/周" width="90" />
        <el-table-column label="估价" width="120"><template #default="{ row }">{{ money(row.estimated_price) }}</template></el-table-column>
        <el-table-column label="实际合同价" width="130"><template #default="{ row }">{{ row.actual_price == null ? '-' : money(row.actual_price) }}</template></el-table-column>
        <el-table-column label="差异" width="120">
          <template #default="{ row }">
            <span :class="{ danger: Number(row.price_diff || 0) > 0, success: Number(row.price_diff || 0) < 0 }">{{ money(row.price_diff) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="差异率" width="100">
          <template #default="{ row }">{{ row.diff_pct == null ? '-' : row.diff_pct + '%' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="130">
          <template #default="{ row }">
            <el-tag :type="statusTag(row.cost_status)" size="small">{{ statusLabel(row.cost_status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="contract_no" label="合同号" min-width="140" show-overflow-tooltip />
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Api } from '../api'
import { ElMessage } from 'element-plus'

const loading = ref(false)
const summary = ref<any>({})
const items = ref<any[]>([])

const money = (value: any) => {
  const n = Number(value || 0)
  return n.toLocaleString('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 0 })
}

const statusTag = (status: string) => status === 'over_20pct' ? 'danger' : status === 'over_10pct' ? 'warning' : status === 'no_contract_yet' ? 'info' : 'success'
const statusLabel = (status: string) => ({
  no_contract_yet: '未签合同',
  on_or_under_budget: '预算内',
  over_10pct: '超10%',
  over_20pct: '超20%',
}[status] || status || '-')

const load = async () => {
  loading.value = true
  try {
    const [sum, list] = await Promise.all([
      Api.get('/key_components/price_diff/summary'),
      Api.get('/key_components/price_diff'),
    ])
    summary.value = sum || {}
    items.value = list?.items || []
  } catch (e: any) {
    ElMessage.error('加载采购价差失败: ' + (e?.message || e))
    summary.value = {}
    items.value = []
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.page{padding:16px 24px}
.page-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.page-title{font-size:20px;font-weight:600}
.page-subtitle{color:var(--el-text-color-secondary);font-size:13px;margin-top:4px}
.kpi-row{margin-bottom:16px}
.card-header{display:flex;justify-content:space-between;align-items:center;gap:12px}
.summary-line{display:flex;gap:8px;flex-wrap:wrap}
.danger{color:var(--el-color-danger);font-weight:600}
.success{color:var(--el-color-success);font-weight:600}
</style>
