<template>
  <div class="page">
    <PageToolbar class="page-header">
      <div class="page-title"><el-icon><Money /></el-icon> {{ pageTitle }}</div>
      <div>
        <el-select v-if="showInstancePicker" v-model="selectedInstance" placeholder="选择装备实例" style="width: 280px; margin-right: 8px" @change="load">
          <el-option v-for="i in instances" :key="i.id" :label="i.instance_code + ' | ' + (i.instance_name || '')" :value="i.id" />
        </el-select>
        <el-button type="primary" @click="load" :loading="loading">{{ showInstancePicker ? '查询' : '刷新' }}</el-button>
      </div>
    </PageToolbar>

    <div v-if="showInstancePicker && !selectedInstance" style="text-align: center; padding: 40px">
      <PageState state="empty" compact :show-action="false" description="选择装备实例查看成本归集" />
    </div>

    <div v-else v-loading="loading">
      <!-- 汇总卡片 -->
      <el-row :gutter="16" style="margin-bottom: 16px">
        <el-col :span="6">
          <el-card shadow="hover"><el-statistic title="估算总成本" :value="fmtMoney(data.totals?.estimated_cost)" /></el-card>
        </el-col>
        <el-col :span="6">
          <el-card shadow="hover"><el-statistic title="实际总成本" :value="fmtMoney(data.totals?.actual_cost)" /></el-card>
        </el-col>
        <el-col :span="6">
          <el-card shadow="hover">
            <el-statistic title="成本偏差" :value="fmtMoney(data.totals?.cost_diff)">
              <template #suffix>
                <el-tag :type="(data.totals?.cost_diff||0) > 0 ? 'danger' : 'success'" size="small">{{ (data.totals?.cost_diff||0) > 0 ? '超支' : '节约' }}</el-tag>
              </template>
            </el-statistic>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card shadow="hover"><el-statistic title="合同毛利" :value="fmtMoney(data.contract_margin)">
            <template #suffix><span style="font-size:14px">{{ data.contract_margin_pct != null ? '('+data.contract_margin_pct+'%)' : '' }}</span></template>
          </el-statistic></el-card>
        </el-col>
      </el-row>

      <!-- 关键件 -->
      <el-card style="margin-bottom: 16px">
        <template #header>
          <span style="font-weight: 500"><el-icon><Tools /></el-icon> 关键件成本 ({{ data.key_components?.count || 0 }} 项)</span>
          <el-tag size="small" style="margin-left: 8px" :type="data.project_status==='over_budget'?'danger':data.project_status==='partial'?'warning':'success'">
            {{ projectStatusLabels[data.project_status] || data.project_status }}
          </el-tag>
        </template>
        <el-row :gutter="16" style="margin-bottom: 8px">
          <el-col :span="4"><div class="stat-mini"><span class="stat-val">{{ data.key_components?.contract_signed_count || 0 }}</span><span class="stat-lbl">已签约</span></div></el-col>
          <el-col :span="4"><div class="stat-mini"><span class="stat-val" style="color:var(--el-color-warning)">{{ data.key_components?.pending_count || 0 }}</span><span class="stat-lbl">待签约</span></div></el-col>
          <el-col :span="4"><div class="stat-mini"><span class="stat-val" style="color:var(--el-color-danger)">{{ data.key_components?.over_budget_count || 0 }}</span><span class="stat-lbl">超预算</span></div></el-col>
          <el-col :span="6"><div class="stat-mini"><span class="stat-val">{{ fmtMoney(data.key_components?.estimated_total) }}</span><span class="stat-lbl">估算合计</span></div></el-col>
          <el-col :span="6"><div class="stat-mini"><span class="stat-val">{{ fmtMoney(data.key_components?.actual_total) }}</span><span class="stat-lbl">实际合计</span></div></el-col>
        </el-row>
      </el-card>

      <!-- 物料成本 -->
      <el-card style="margin-bottom: 16px">
        <template #header><span style="font-weight: 500"><el-icon><Box /></el-icon> 普通物料成本 ({{ data.materials?.count || 0 }} 项)</span></template>
        <el-row :gutter="16">
          <el-col :span="8"><div class="stat-mini"><span class="stat-val">{{ fmtMoney(data.materials?.estimated_total) }}</span><span class="stat-lbl">估算合计</span></div></el-col>
          <el-col :span="8"><div class="stat-mini"><span class="stat-val">{{ fmtMoney(data.materials?.actual_total) }}</span><span class="stat-lbl">实际合计</span></div></el-col>
        </el-row>
      </el-card>

      <!-- 工时成本 -->
      <el-card style="margin-bottom: 16px">
        <template #header><span style="font-weight: 500">⏱️ 工时成本</span></template>
        <el-row :gutter="16">
          <el-col :span="4"><div class="stat-mini"><span class="stat-val">{{ data.labor?.work_order_count || 0 }}</span><span class="stat-lbl">工单数</span></div></el-col>
          <el-col :span="4"><div class="stat-mini"><span class="stat-val" style="color:var(--el-color-success)">{{ data.labor?.completed_count || 0 }}</span><span class="stat-lbl">已完成</span></div></el-col>
          <el-col :span="4"><div class="stat-mini"><span class="stat-val">{{ data.labor?.estimated_hours || 0 }}h</span><span class="stat-lbl">估算工时</span></div></el-col>
          <el-col :span="4"><div class="stat-mini"><span class="stat-val">{{ data.labor?.actual_hours || 0 }}h</span><span class="stat-lbl">实际工时</span></div></el-col>
          <el-col :span="4"><div class="stat-mini"><span class="stat-val" :style="{color: (data.labor?.hours_diff||0) > 0 ? 'var(--el-color-danger)' : 'var(--el-color-success)'}">{{ (data.labor?.hours_diff||0) > 0 ? '+' : '' }}{{ data.labor?.hours_diff || 0 }}h</span><span class="stat-lbl">工时偏差</span></div></el-col>
        </el-row>
      </el-card>

      <!-- 合同信息 -->
      <el-card v-if="data.equipment_instance?.contract_no">
        <template #header><span style="font-weight: 500"><el-icon><Document /></el-icon> 合同信息</span></template>
        <el-descriptions :column="3" border size="small">
          <el-descriptions-item label="合同号">{{ data.equipment_instance.contract_no }}</el-descriptions-item>
          <el-descriptions-item label="客户">{{ data.equipment_instance.customer_name }}</el-descriptions-item>
          <el-descriptions-item label="合同金额">{{ data.contract_yuan != null ? fmtMoney(data.contract_yuan) + ' 元' : '-' }}</el-descriptions-item>
          <el-descriptions-item label="进度">{{ data.equipment_instance.progress_pct != null ? data.equipment_instance.progress_pct + '%' : '-' }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="data.equipment_instance.status==='active'?'success':''" size="small">{{ data.equipment_instance.status || '-' }}</el-tag>
          </el-descriptions-item>
        </el-descriptions>
      </el-card>

      <el-card v-if="selectedInstance" style="margin-bottom: 16px">
        <template #header>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-weight: 500"><el-icon><DataAnalysis /></el-icon> 三层差异（量差 / 价差 / 效率差）</span>
            <el-tag size="small" :type="confidenceTag(variance.totals?.confidence).type">{{ confidenceTag(variance.totals?.confidence).label }}</el-tag>
          </div>
        </template>
        <el-row :gutter="16" style="margin-bottom: 12px">
          <el-col :span="6"><div class="stat-mini"><span class="stat-val" :class="varianceTone(variance.totals?.quantity_variance)">{{ signedMoney(variance.totals?.quantity_variance) }}</span><span class="stat-lbl">量差（用多/用少）</span></div></el-col>
          <el-col :span="6"><div class="stat-mini"><span class="stat-val" :class="varianceTone(variance.totals?.price_variance)">{{ signedMoney(variance.totals?.price_variance) }}</span><span class="stat-lbl">价差（买贵/买便宜）</span></div></el-col>
          <el-col :span="6"><div class="stat-mini"><span class="stat-val" :class="varianceTone(variance.totals?.efficiency_variance)">{{ signedMoney(variance.totals?.efficiency_variance) }}</span><span class="stat-lbl">效率差（干慢/干快）</span></div></el-col>
          <el-col :span="6"><div class="stat-mini"><span class="stat-val" :class="varianceTone(variance.totals?.total_variance)">{{ signedMoney(variance.totals?.total_variance) }}</span><span class="stat-lbl">合计差异（{{ varianceLabel(variance.totals?.total_variance) }}）</span></div></el-col>
        </el-row>
        <el-descriptions :column="3" border size="small" style="margin-bottom: 12px">
          <el-descriptions-item label="标准成本">{{ fmtMoney(variance.totals?.standard_cost) }} 元</el-descriptions-item>
          <el-descriptions-item label="已发生实际">{{ fmtMoney(variance.totals?.actual_cost) }} 元</el-descriptions-item>
          <el-descriptions-item label="差异率">{{ variance.totals?.variance_pct != null ? variance.totals.variance_pct + '%' : '-' }}</el-descriptions-item>
          <el-descriptions-item label="人工费率">{{ variance.labor_rate?.rate || '-' }} 元/h（{{ variance.labor_rate?.source === 'system_settings' ? '系统设置' : variance.labor_rate?.source === 'env' ? '环境变量' : '默认值' }}）</el-descriptions-item>
          <el-descriptions-item label="标准/实际工时">{{ variance.labor?.standard_hours || 0 }}h / {{ variance.labor?.actual_hours || 0 }}h</el-descriptions-item>
          <el-descriptions-item label="报工覆盖">{{ variance.labor?.coverage_pct != null ? variance.labor.coverage_pct + '%' : '-' }}</el-descriptions-item>
        </el-descriptions>
        <div v-if="variance.top_contributors?.length" style="margin-bottom: 8px">
          <span class="stat-lbl">Top 影响项：</span>
          <el-tag v-for="item in variance.top_contributors" :key="item.kind + item.key" size="small" class="tag-gap"
            :type="varianceKind(item.total_variance) === 'over' ? 'danger' : 'success'">{{ contributorText(item) }}</el-tag>
        </div>
        <el-descriptions v-if="variance.ledger" :column="3" border size="small" style="margin-bottom: 8px">
          <el-descriptions-item label="台账其他成本">{{ fmtMoney(variance.ledger.other_costs) }} 元</el-descriptions-item>
          <el-descriptions-item label="台账合计（含其他）">{{ fmtMoney(variance.ledger.actual_total_including_other) }} 元</el-descriptions-item>
          <el-descriptions-item label="台账条目">{{ variance.ledger.entries || 0 }} 条（已过账）</el-descriptions-item>
          <el-descriptions-item label="材料台账 vs 计算">{{ signedMoney(variance.ledger.cross_check?.material_diff) }} 元</el-descriptions-item>
          <el-descriptions-item label="人工台账 vs 计算">{{ variance.ledger.cross_check?.labor_diff == null ? '-' : signedMoney(variance.ledger.cross_check.labor_diff) + ' 元' }}</el-descriptions-item>
          <el-descriptions-item label="其他成本构成">
            <span v-if="variance.ledger.other_costs">外协 {{ fmtMoney(variance.ledger.by_type?.outsourcing?.amount) }} ｜ 折旧 {{ fmtMoney(variance.ledger.by_type?.depreciation?.amount) }} ｜ 返工 {{ fmtMoney(variance.ledger.by_type?.rework?.amount) }} ｜ 质量 {{ fmtMoney(variance.ledger.by_type?.quality_loss?.amount) }}</span>
            <span v-else style="color: var(--el-color-info)">（无）</span>
          </el-descriptions-item>
        </el-descriptions>
        <el-alert v-if="variance.ledger && !variance.ledger.entries" type="info" :closable="false" style="margin-bottom: 8px"
          title="还没有成本台账数据：三层差异目前只包含材料+人工的推算值；导入台账后这里会显示外协/折旧/返工与账实核对" />
        <el-alert v-for="(line, index) in notComputedSummary(variance.not_computed)" :key="'nc' + index"
          type="warning" :closable="false" :title="line" style="margin-bottom: 6px" />
        <el-alert v-for="(gap, index) in (variance.data_gaps || [])" :key="'gap' + index"
          type="info" :closable="false" :title="gap" style="margin-bottom: 6px" />
      </el-card>

      <el-card v-if="isVarianceView" style="margin-top: 16px">
        <template #header><span style="font-weight: 500"><el-icon><DataAnalysis /></el-icon> 偏差诊断</span></template>
        <el-row :gutter="16">
          <el-col :span="8"><div class="stat-mini"><span class="stat-val">{{ data.totals?.budget_cost != null ? fmtMoney(data.totals.budget_cost) : '-' }}</span><span class="stat-lbl">预算基线</span></div></el-col>
          <el-col :span="8"><div class="stat-mini"><span class="stat-val">{{ data.totals?.actual_cost != null ? fmtMoney(data.totals.actual_cost) : '-' }}</span><span class="stat-lbl">实际归集</span></div></el-col>
          <el-col :span="8"><div class="stat-mini"><span class="stat-val" :style="{color: (data.totals?.cost_diff||0) > 0 ? 'var(--el-color-danger)' : 'var(--el-color-success)'}">{{ data.totals?.cost_diff != null ? fmtMoney(data.totals.cost_diff) : '-' }}</span><span class="stat-lbl">偏差</span></div></el-col>
        </el-row>
        <el-alert
          style="margin-top: 12px"
          :type="(data.totals?.cost_diff||0) > 0 ? 'error' : 'success'"
          :closable="false"
          show-icon
          :title="(data.totals?.cost_diff||0) > 0 ? '当前项目存在超支风险，建议从材料、外协、折旧和返工优先排查。' : '当前项目成本偏差受控，可继续按计划归集。'"
        />
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { Api } from '../api'
import { ElMessage } from 'element-plus'
import type { ApiRecord } from '../types/api'
import {
  confidenceTag,
  contributorText,
  notComputedSummary,
  signedMoney,
  varianceKind,
  varianceLabel,
  varianceTone,
} from '../domain/costVariance'

const route = useRoute()
const instances = ref<ApiRecord[]>([])
const selectedInstance = ref<number | null>(null)
const data = ref<ApiRecord>({})
// P2-2：三层差异（量差 / 价差 / 效率差）
const variance = ref<ApiRecord>({})
const loading = ref(false)
const isVarianceView = computed(() => route.path === '/cost-variance' || route.query.view === 'variance' || route.query.view === 'cost-variance')
const showInstancePicker = computed(() => !isVarianceView.value)
const pageTitle = computed(() => isVarianceView.value ? '项目成本偏差' : '成本归集')
const projectStatusLabels: Record<string, string> = { over_budget: '超预算', partial: '部分签约', fully_contracted: '全部签约', no_key_components: '无关键件' }

const loadInstances = async () => {
  try { const r = await Api.get('/equipment_instances'); instances.value = r.items || r || [] }
  catch(_) { instances.value = []; ElMessage.error('加载实例失败') }
}

const load = async () => {
  if (showInstancePicker.value && !selectedInstance.value) return
  loading.value = true
  try { data.value = await Api.get('/equipment_instances/' + selectedInstance.value + '/cost_rollup') }
  catch(_) { data.value = {}; ElMessage.error('加载成本数据失败') }
  try { variance.value = await Api.get('/equipment_instances/' + selectedInstance.value + '/cost_variance') }
  catch(_) { variance.value = {} }
  finally { loading.value = false }
}

const fmtMoney = (v: unknown) => {
  if (v == null) return '-'
  return Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

onMounted(async () => {
  await loadInstances()
  if (isVarianceView.value) {
    selectedInstance.value = Number(route.query.instance_id || instances.value[0]?.id || 0) || null
    if (selectedInstance.value) await load()
  }
})
</script>

<style scoped>
.page{padding:16px 24px}
.page-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.page-title{font-size:20px;font-weight:600}
.stat-mini{text-align:center;padding:8px}
.stat-val{display:block;font-size:22px;font-weight:600}
.stat-lbl{display:block;font-size:12px;color:var(--el-color-info);margin-top:2px}
</style>
