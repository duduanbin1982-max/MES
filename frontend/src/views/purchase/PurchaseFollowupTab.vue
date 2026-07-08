<template>
      <el-tab-pane label="采购跟催" name="followup">
        <el-row :gutter="12" class="followup-row">
          <el-col :span="6">
            <el-card shadow="never" class="followup-card">
              <div class="followup-label">跟催总数</div>
              <div class="followup-value">{{ followUpSummary.total || 0 }}</div>
              <div class="followup-sub">采购订单跟催项</div>
            </el-card>
          </el-col>
          <el-col :span="6">
            <el-card shadow="never" class="followup-card">
              <div class="followup-label">延期项</div>
              <div class="followup-value danger">{{ followUpSummary.overdue || 0 }}</div>
              <div class="followup-sub">已超过计划到货</div>
            </el-card>
          </el-col>
          <el-col :span="6">
            <el-card shadow="never" class="followup-card">
              <div class="followup-label">影响缺料</div>
              <div class="followup-value warning">{{ followUpSummary.impacted_shortages || 0 }}</div>
              <div class="followup-sub">关联 shortage cases</div>
            </el-card>
          </el-col>
          <el-col :span="6">
            <el-card shadow="never" class="followup-card">
              <div class="followup-label">影响工单</div>
              <div class="followup-value">{{ followUpSummary.impacted_work_orders || 0 }}</div>
              <div class="followup-sub">被卡住的工单数</div>
            </el-card>
          </el-col>
        </el-row>

        <div class="tb">
          <el-select v-model="followUpFilter.status" clearable placeholder="跟催状态" style="width: 160px" @change="emit('load-purchase-follow-up')">
            <el-option label="待跟催" value="pending" />
            <el-option label="跟催中" value="following" />
            <el-option label="已交付" value="delivered" />
            <el-option label="已取消" value="cancelled" />
          </el-select>
          <el-select v-model="followUpFilter.sourceType" clearable placeholder="来源" style="width: 140px" @change="emit('load-purchase-follow-up')">
            <el-option label="全部来源" value="" />
            <el-option label="采购订单" value="purchase_order" />
            <el-option label="BOM风险催办" value="shortage" />
          </el-select>
          <el-input v-model="followUpFilter.purchaseRequestNo" clearable placeholder="采购申请号 / PR" style="width: 180px" @change="emit('load-purchase-follow-up')" />
          <el-switch v-model="followUpFilter.onlyOverdue" inline-prompt active-text="仅延期" inactive-text="全部" @change="emit('load-purchase-follow-up')" />
        </div>

        <el-table :data="filteredFollowUps" v-loading="followUpLoading" size="small" max-height="520" stripe>
          <el-table-column prop="po_no" label="PO编号" width="150" />
          <el-table-column label="来源" width="120">
            <template #default="{ row }">
              <el-tag :type="row.source_type === 'shortage' ? 'warning' : 'info'" size="small">{{ row.source_label || (row.source_type === 'shortage' ? 'BOM风险催办' : '采购订单') }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="supplier_name" label="供应商" min-width="160" />
          <el-table-column prop="instance_code" label="TBM" width="140" />
          <el-table-column prop="purchase_request_no" label="采购申请" width="150">
            <template #default="{ row }">{{ row.purchase_request_no || '-' }}</template>
          </el-table-column>
          <el-table-column prop="planned_delivery" label="计划到货" width="120" />
          <el-table-column label="延期" width="80">
            <template #default="{ row }">
              <el-tag :type="Number(row.delay_days || 0) > 0 ? 'danger' : 'success'" size="small">{{ Number(row.delay_days || 0) }}天</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="followUpStatusTag(row.tracking_status)" size="small">{{ followUpStatusLabel(row.tracking_status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="影响范围" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">{{ row.impact_summary }}</template>
          </el-table-column>
          <el-table-column prop="owner_name" label="责任人" width="110">
            <template #default="{ row }">{{ row.owner_name || '-' }}</template>
          </el-table-column>
          <el-table-column label="紧急标签" width="140" show-overflow-tooltip>
            <template #default="{ row }">{{ row.urgent_tags || '-' }}</template>
          </el-table-column>
          <el-table-column label="操作" width="180" fixed="right">
            <template #default="{ row }">
              <el-button size="small" link type="primary" @click="emit('open-follow-up-dialog', row)">更新</el-button>
              <el-button size="small" link type="warning" @click="emit('go-kit-from-follow-up', row)" :disabled="!row.shortages?.length">看缺料</el-button>
              <el-button size="small" link :disabled="!row.purchase_order_id" @click="emit('show-order-detail', { id: row.purchase_order_id })">看PO</el-button>
            </template>
          </el-table-column>
        </el-table>

        <el-dialog v-model="followUpDlg.visible" title="采购跟催更新" width="560px">
          <el-form v-if="currentFollowUp" :model="followUpForm" label-width="96px">
            <el-form-item :label="currentFollowUp.source_type === 'shortage' ? '催办编号' : 'PO编号'"><el-input :model-value="currentFollowUp.po_no" disabled /></el-form-item>
            <el-form-item label="供应商"><el-input :model-value="currentFollowUp.supplier_name || '待指定/待下单'" disabled /></el-form-item>
            <el-form-item v-if="currentFollowUp.purchase_request_no" label="采购申请"><el-input :model-value="currentFollowUp.purchase_request_no" disabled /></el-form-item>
            <el-form-item label="来源类型"><el-input :model-value="currentFollowUp.source_label || (currentFollowUp.source_type === 'shortage' ? 'BOM风险催办' : '采购订单')" disabled /></el-form-item>
            <el-form-item label="状态">
              <el-select v-model="followUpForm.status" style="width:100%">
                <el-option label="待跟催" value="pending" />
                <el-option label="跟催中" value="following" />
                <el-option label="已交付" value="delivered" />
                <el-option label="已取消" value="cancelled" />
              </el-select>
            </el-form-item>
            <el-form-item label="计划到货">
              <el-date-picker v-model="followUpForm.planned_delivery" type="date" value-format="YYYY-MM-DD" style="width:100%" />
            </el-form-item>
            <el-form-item label="实际到货">
              <el-date-picker v-model="followUpForm.actual_delivery" type="date" value-format="YYYY-MM-DD" style="width:100%" />
            </el-form-item>
            <el-form-item label="责任人">
              <el-input v-model="followUpForm.owner_name" placeholder="采购负责人/跟单人" />
            </el-form-item>
            <el-form-item label="紧急标签">
              <el-input v-model="followUpForm.urgent_tags" placeholder="延期 / 影响齐套 / 影响工单" />
            </el-form-item>
            <el-form-item label="跟催备注">
              <el-input v-model="followUpForm.remarks" type="textarea" :rows="3" placeholder="供应商承诺、运输状态、风险说明" />
            </el-form-item>
            <el-alert
              v-if="currentFollowUp.shortages?.length"
              type="warning"
              :closable="false"
              show-icon
              style="margin-top: 8px"
            >
              <template #title>当前跟催项影响 {{ currentFollowUp.shortages.length }} 条缺料</template>
              <template #default>
                <div v-for="item in currentFollowUp.shortages.slice(0, 4)" :key="item.id">
                  {{ item.wo_code || '-' }} · {{ item.material_code }} {{ item.material_name }} · 缺 {{ item.shortage_qty }}
                </div>
              </template>
            </el-alert>
          </el-form>
          <template #footer>
            <el-button @click="followUpDlg.visible = false">取消</el-button>
            <el-button type="primary" :loading="saving" @click="emit('save-follow-up')">保存</el-button>
          </template>
        </el-dialog>
      </el-tab-pane>
</template>

<script setup lang="ts">
defineProps<{
  followUpSummary: any
  followUpFilter: any
  filteredFollowUps: any[]
  followUpLoading: boolean
  followUpStatusTag: (value: string) => string
  followUpStatusLabel: (value: string) => string
  followUpDlg: any
  currentFollowUp: any
  followUpForm: any
  saving: boolean
}>()

const emit = defineEmits<{
  (event: 'load-purchase-follow-up'): void
  (event: 'open-follow-up-dialog', row: any): void
  (event: 'go-kit-from-follow-up', row: any): void
  (event: 'show-order-detail', row: any): void
  (event: 'save-follow-up'): void
}>()
</script>

<style scoped>
.tb { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
.followup-row { margin-bottom: 12px; }
.followup-card { min-height: 96px; }
.followup-label { color: var(--el-text-color-secondary); font-size: 12px; }
.followup-value { font-size: 28px; font-weight: 700; margin-top: 8px; }
.followup-value.danger { color: var(--el-color-danger); }
.followup-value.warning { color: var(--el-color-warning); }
.followup-sub { color: var(--el-text-color-secondary); font-size: 12px; margin-top: 6px; }
</style>
