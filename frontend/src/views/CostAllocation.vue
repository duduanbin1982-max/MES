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
          <el-card shadow="hover"><el-statistic title="估算总成本" :value="fmtMoney(data.totals?.estimated_cost_full ?? data.totals?.estimated_cost)" /></el-card>
        </el-col>
        <el-col :span="6">
          <el-card shadow="hover"><el-statistic title="实际总成本（含人工/台账）" :value="fmtMoney(data.totals?.actual_cost_full ?? data.totals?.actual_cost)" /></el-card>
        </el-col>
        <el-col :span="6">
          <el-card shadow="hover">
            <el-statistic title="成本偏差" :value="fmtMoney(data.totals?.cost_diff_full ?? data.totals?.cost_diff)">
              <template #suffix>
                <el-tag :type="(data.totals?.cost_diff_full ?? data.totals?.cost_diff ?? 0) > 0 ? 'danger' : 'success'" size="small">{{ (data.totals?.cost_diff_full ?? data.totals?.cost_diff ?? 0) > 0 ? '超支' : '节约' }}</el-tag>
              </template>
            </el-statistic>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card shadow="hover"><el-statistic title="合同毛利" :value="fmtMoney(data.contract_margin_full ?? data.contract_margin)">
            <template #suffix><span style="font-size:14px">{{ (data.contract_margin_pct_full ?? data.contract_margin_pct) != null ? '('+(data.contract_margin_pct_full ?? data.contract_margin_pct)+'%)' : '' }}</span></template>
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
            <span style="font-weight: 500"><el-icon><Money /></el-icon> 成本台账（{{ entriesTotal }} 条 / {{ fmtMoney(entrySummary.total) }} 元）</span>
            <div v-if="canWriteCost">
              <el-button size="small" @click="backfillCost" :loading="entryDlg.backfilling">回填材料/人工</el-button>
              <el-button size="small" type="primary" @click="openEntry">新增成本</el-button>
            </div>
          </div>
        </template>
        <div class="ledger-summary">
          <span>材料 {{ fmtMoney(entrySummary.by_type?.material?.amount) }} 元</span>
          <span>人工 {{ fmtMoney(entrySummary.by_type?.labor?.amount) }} 元</span>
          <span>外协 {{ fmtMoney(entrySummary.by_type?.outsourcing?.amount) }} 元</span>
          <span>折旧 {{ fmtMoney(entrySummary.by_type?.depreciation?.amount) }} 元</span>
          <span>返工 {{ fmtMoney(entrySummary.by_type?.rework?.amount) }} 元</span>
          <span>质量损失 {{ fmtMoney(entrySummary.by_type?.quality_loss?.amount) }} 元</span>
        </div>
        <el-table :data="entries" size="small" max-height="300" empty-text="暂无成本台账">
          <el-table-column prop="cost_type_label" label="类型" width="90" />
          <el-table-column prop="description" label="说明" min-width="220" show-overflow-tooltip />
          <el-table-column label="金额" width="130" align="right"><template #default="{ row }">{{ fmtMoney(row.amount) }}</template></el-table-column>
          <el-table-column prop="occurred_on" label="发生日" width="110" />
          <el-table-column label="状态" width="80"><template #default="{ row }"><el-tag size="small" :type="row.status === 'posted' ? 'success' : row.status === 'void' ? 'info' : 'warning'">{{ row.status }}</el-tag></template></el-table-column>
          <el-table-column prop="source_ref" label="来源" min-width="160" show-overflow-tooltip />
          <el-table-column v-if="canWriteCost" label="操作" width="80" fixed="right">
            <template #default="{ row }"><el-button link size="small" type="danger" @click="voidEntry(row)">作废</el-button></template>
          </el-table-column>
        </el-table>
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

    <el-dialog v-model="entryDlg.show" title="新增成本台账" width="560px">
      <el-form :model="entryDlg.form" label-width="90px" size="small">
        <el-form-item label="成本类型" required>
          <el-select v-model="entryDlg.form.cost_type" style="width:100%">
            <el-option v-for="item in costTypeOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="说明" required><el-input v-model="entryDlg.form.description" maxlength="500" show-word-limit /></el-form-item>
        <el-form-item label="金额(元)" required><el-input-number v-model="entryDlg.form.amount" :min="0" :precision="2" :max="1000000000000" style="width:100%" /></el-form-item>
        <el-form-item label="发生日期" required><el-date-picker v-model="entryDlg.form.occurred_on" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item>
        <el-form-item label="供应商/外协"><el-input v-model="entryDlg.form.vendor" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="entryDlg.form.notes" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="entryDlg.show=false">取消</el-button><el-button type="primary" :loading="entryDlg.saving" @click="saveEntry">保存</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { Api } from '../api'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { ApiRecord } from '../types/api'
import { useAuthStore } from '../stores/auth'
import {
  confidenceTag,
  contributorText,
  notComputedSummary,
  signedMoney,
  varianceKind,
  varianceLabel,
  varianceTone,
} from '../domain/costVariance'

const auth = useAuthStore()
const route = useRoute()
const instances = ref<ApiRecord[]>([])
const selectedInstance = ref<number | null>(null)
const data = ref<ApiRecord>({})
// P2-2：三层差异（量差 / 价差 / 效率差）
const variance = ref<ApiRecord>({})
const loading = ref(false)
const entries = ref<ApiRecord[]>([])
const entriesTotal = ref(0)
const entrySummary = ref<ApiRecord>({ by_type: {} })
const canWriteCost = computed(() => auth.role === 'admin' || auth.role === 'foreman')
const costTypeOptions = [
  { value: 'material', label: '材料' }, { value: 'labor', label: '人工' },
  { value: 'outsourcing', label: '外协' }, { value: 'depreciation', label: '折旧' },
  { value: 'rework', label: '返工' }, { value: 'quality_loss', label: '质量损失' },
]
const entryDlg = reactive<any>({ show: false, saving: false, backfilling: false, form: { cost_type: 'material', description: '', amount: 0, occurred_on: '' } })
const todayText = () => new Date().toISOString().slice(0, 10)
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
  try { await loadEntries() } finally { loading.value = false }
}

const loadEntries = async () => {
  if (!selectedInstance.value) { entries.value = []; entriesTotal.value = 0; entrySummary.value = { by_type: {} }; return }
  try {
    const [list, summary]: any[] = await Promise.all([
      Api.get('/project_cost_entries', { params: { equipment_instance_id: selectedInstance.value, limit: 500 } }),
      Api.get('/project_cost_entries/summary', { params: { equipment_instance_id: selectedInstance.value } }),
    ])
    entries.value = list.items || []
    entriesTotal.value = Number(list.total ?? entries.value.length)
    entrySummary.value = summary || { by_type: {} }
  } catch (_error) {
    entries.value = []
    entriesTotal.value = 0
    entrySummary.value = { by_type: {} }
  }
}

const openEntry = () => {
  entryDlg.form = { cost_type: 'material', description: '', amount: 0, occurred_on: todayText(), vendor: '', notes: '' }
  entryDlg.show = true
}

const saveEntry = async () => {
  if (!entryDlg.form.description || !entryDlg.form.amount) return ElMessage.warning('请填写说明和金额')
  entryDlg.saving = true
  try {
    await Api.post('/project_cost_entries', { ...entryDlg.form, currency: 'CNY', status: 'posted' })
    ElMessage.success('成本已入账')
    entryDlg.show = false
    await load()
  } catch (error: any) {
    ElMessage.error('保存失败：' + (error?.response?.data?.error || error.message))
  } finally { entryDlg.saving = false }
}

const voidEntry = async (row: any) => {
  try {
    await ElMessageBox.confirm('作废成本 ' + row.description + '（' + fmtMoney(row.amount) + ' 元）？作废后不再计入归集。', '确认作废', { type: 'warning' })
    await Api.del('/project_cost_entries/' + row.id)
    ElMessage.success('已作废')
    await load()
  } catch (error: any) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error('作废失败：' + (error?.response?.data?.error || error.message))
  }
}

const backfillCost = async () => {
  try {
    await ElMessageBox.confirm('按采购订单明细回填材料成本、按工单工时回填人工成本？已存在的来源会自动跳过。', '确认回填', { type: 'warning' })
    entryDlg.backfilling = true
    const result: any = await Api.post('/project_cost_entries/backfill', { include: ['material', 'labor'], hourly_rate: variance.value?.labor_rate?.rate || 200 })
    ElMessage.success('回填完成：材料 ' + (result.created?.material || 0) + ' 条，人工 ' + (result.created?.labor || 0) + ' 条')
    await load()
  } catch (error: any) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error('回填失败：' + (error?.response?.data?.error || error.message))
  } finally { entryDlg.backfilling = false }
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
.ledger-summary{display:flex;flex-wrap:wrap;gap:16px;margin-bottom:10px;color:var(--el-text-color-secondary);font-size:13px}
</style>
