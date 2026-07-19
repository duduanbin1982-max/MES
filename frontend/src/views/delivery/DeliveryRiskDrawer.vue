<template>
  <el-drawer v-model="visible" size="62%" :title="data?.project?.instance_code ? `${data.project.instance_code} 风险钻取` : '风险钻取'">
    <template v-if="data">
      <el-row :gutter="12" class="risk-kpis">
        <el-col v-for="milestone in data.milestones" :key="milestone.key" :span="6">
          <el-card shadow="never"><div class="stat-label">{{ milestone.label }}</div><div class="stat-value" :class="{ danger: milestone.level === 'critical' || milestone.level === 'high', warning: milestone.level === 'warning' }">{{ milestone.value }}{{ milestone.suffix || '' }}</div></el-card>
        </el-col>
      </el-row>

      <el-tabs v-model="activeTab">
        <el-tab-pane label="异常中心" name="exceptions">
          <el-table :data="data.exceptions" size="small" height="360" empty-text="暂无异常">
            <el-table-column label="级别" width="80"><template #default="{ row }"><el-tag :type="severityTag(row.severity)" size="small">{{ severityLabel(row.severity) }}</el-tag></template></el-table-column>
            <el-table-column prop="title" label="异常" min-width="180" show-overflow-tooltip />
            <el-table-column prop="message" label="说明" min-width="260" show-overflow-tooltip />
            <el-table-column label="状态" width="90"><template #default="{ row }">{{ row.case_status || 'open' }}</template></el-table-column>
            <el-table-column label="操作" width="90"><template #default="{ row }"><el-button link size="small" @click="emit('navigate', row.source_path)">处理</el-button></template></el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="缺料" name="shortages">
          <el-table :data="data.shortages" size="small" height="360" empty-text="暂无缺料">
            <el-table-column prop="material_code" label="物料编码" width="140" />
            <el-table-column prop="material_name" label="物料名称" min-width="180" show-overflow-tooltip />
            <el-table-column prop="wo_code" label="工单" width="160" />
            <el-table-column prop="shortage_qty" label="缺口" width="90" />
            <el-table-column prop="expected_date" label="预计到货" width="110" />
            <el-table-column prop="owner_name" label="责任人" width="100" />
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="采购跟催" name="followups">
          <el-table :data="data.purchase_followups" size="small" height="360" empty-text="暂无采购跟催">
            <el-table-column prop="po_no" label="编号" width="150" />
            <el-table-column label="来源" width="120"><template #default="{ row }"><el-tag :type="row.source_type === 'shortage' ? 'warning' : 'info'" size="small">{{ row.source_type === 'shortage' ? 'BOM风险催办' : '采购订单' }}</el-tag></template></el-table-column>
            <el-table-column prop="item_name" label="物料/事项" min-width="180" show-overflow-tooltip />
            <el-table-column prop="planned_delivery" label="计划到货" width="110" />
            <el-table-column label="延期" width="80"><template #default="{ row }"><el-tag :type="Number(row.delay_days || 0) > 0 ? 'danger' : 'success'" size="small">{{ Number(row.delay_days || 0) }}天</el-tag></template></el-table-column>
            <el-table-column prop="owner_name" label="责任人" width="100" />
            <el-table-column label="状态" width="90"><template #default="{ row }"><el-tag :type="row.tracking_status === 'following' ? 'warning' : row.tracking_status === 'pending' ? 'info' : 'success'" size="small">{{ row.tracking_status || '-' }}</el-tag></template></el-table-column>
            <el-table-column label="操作" width="90"><template #default="{ row }"><el-button link size="small" @click="emit('navigate', row.source_path)">跟催</el-button></template></el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="NCR" name="ncr">
          <el-table :data="data.ncrs" size="small" height="360" empty-text="暂无NCR">
            <el-table-column prop="ncr_code" label="NCR" width="150" />
            <el-table-column prop="part_name" label="部件" width="140" />
            <el-table-column prop="defect_desc" label="缺陷" min-width="220" show-overflow-tooltip />
            <el-table-column prop="severity" label="级别" width="80" />
            <el-table-column prop="disposition" label="处置" width="100" />
            <el-table-column prop="open_capa_count" label="未完CAPA" width="100" />
            <el-table-column prop="pass_recheck_count" label="通过复检" width="100" />
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="成本偏差" name="cost">
          <el-descriptions :column="2" border size="small" style="margin-bottom:12px">
            <el-descriptions-item label="合同预算">{{ money(data.cost.budget_amount) }}</el-descriptions-item>
            <el-descriptions-item label="按进度预算">{{ money(data.cost.earned_budget) }}</el-descriptions-item>
            <el-descriptions-item label="实际归集">{{ money(data.cost.actual_amount) }}</el-descriptions-item>
            <el-descriptions-item label="偏差">{{ money(data.cost.variance_amount) }} / {{ data.cost.variance_pct }}%</el-descriptions-item>
          </el-descriptions>
          <el-table :data="data.cost.by_account" size="small" height="280" empty-text="暂无成本归集">
            <el-table-column prop="gl_account_code" label="科目" width="100" />
            <el-table-column prop="source_type" label="来源" width="140" />
            <el-table-column prop="entry_count" label="笔数" width="80" />
            <el-table-column label="金额" min-width="120"><template #default="{ row }">{{ money(row.amount) }}</template></el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>

      <div class="quick-actions"><el-button v-for="action in data.summary.quick_actions" :key="action.type" size="small" type="primary" plain @click="emit('navigate', action.path)">{{ action.label }} ({{ action.count }})</el-button></div>
    </template>
    <el-skeleton v-else :rows="8" animated />
  </el-drawer>
</template>

<script setup lang="ts">
import { money, severityLabel, severityTag } from './deliveryShared'

defineProps<{ data: any | null }>()
const visible = defineModel<boolean>({ required: true })
const activeTab = defineModel<string>('activeTab', { required: true })
const emit = defineEmits<{ navigate: [path?: string] }>()
</script>

<style scoped>
.risk-kpis { margin-bottom: 12px; }
.stat-label { color: var(--el-text-color-secondary); font-size: 13px; }
.stat-value { font-size: 30px; font-weight: 700; margin-top: 10px; }
.stat-value.danger { color: var(--el-color-danger); }
.stat-value.warning { color: var(--el-color-warning); }
.quick-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
</style>
