<template>
  <div class="shopfloor-page">
    <div class="mobile-header">
      <div>
        <div class="page-title">车间工作台</div>
        <div class="page-subtitle">扫码领料、报工、图纸、质检、异常上报</div>
      </div>
      <el-button :icon="Refresh" circle :loading="loading" @click="loadAll" />
    </div>

    <el-row :gutter="10" class="kpi-row">
      <el-col :span="8"><el-card shadow="never" class="kpi"><div>工单</div><strong>{{ summary.active_work_orders || 0 }}</strong></el-card></el-col>
      <el-col :span="8"><el-card shadow="never" class="kpi"><div>待签图纸</div><strong>{{ summary.pending_docs || 0 }}</strong></el-card></el-col>
      <el-col :span="8"><el-card shadow="never" class="kpi danger"><div>异常</div><strong>{{ summary.open_exceptions || 0 }}</strong></el-card></el-col>
    </el-row>

    <el-card shadow="never" class="panel role-panel">
      <template #header>
        <div class="card-header">
          <span>我的工作入口</span>
          <el-tag size="small">{{ roleLabel }}</el-tag>
        </div>
      </template>
      <el-tabs v-model="activeTab" stretch>
        <el-tab-pane label="扫码报工" name="scan">
          <el-input aria-label="扫描或输入工单号 / PN节点号" v-model="scanCode" size="large" placeholder="扫描或输入工单号 / PN节点号" clearable @keyup.enter="lookupScan">
            <template #append><el-button type="primary" @click="lookupScan">识别</el-button></template>
          </el-input>
          <div v-if="scanResult" class="scan-result">
            <el-alert :title="scanResult.type === 'work_order' ? `工单：${scanResult.data.wo_code}` : `工序节点：${scanResult.data.operation_name || scanResult.data.id}`" type="success" :closable="false" />
            <div class="action-grid">
              <el-button type="primary" @click="executeScan('start')">开始</el-button>
              <el-button type="success" @click="executeScan('complete')">完成</el-button>
              <el-button type="warning" @click="executeScan('pause')">暂停</el-button>
              <el-button type="danger" @click="executeScan('block')">卡滞</el-button>
            </div>
          </div>
        </el-tab-pane>

        <el-tab-pane label="领料" name="pick">
          <el-empty v-if="!workOrders.length" description="暂无待领料工单" :image-size="48" />
          <div v-for="wo in workOrders.slice(0, 6)" :key="wo.id" class="wo-card">
            <div class="wo-main"><strong>{{ wo.wo_code }}</strong><el-tag size="small">{{ wo.status }}</el-tag></div>
            <div class="muted">{{ wo.instance_code || '-' }} · {{ wo.title }}</div>
            <div class="wo-actions">
              <el-button v-if="canPick" size="small" type="primary" @click="openPick(wo)">查看领料单</el-button>
              <el-button size="small" @click="go('/kit-closure')">缺料闭环</el-button>
            </div>
          </div>
        </el-tab-pane>

        <el-tab-pane label="质检" name="qc">
          <el-empty v-if="!workOrders.length" description="暂无可质检工单" :image-size="48" />
          <div v-for="wo in workOrders.slice(0, 6)" :key="wo.id" class="wo-card">
            <div class="wo-main"><strong>{{ wo.wo_code }}</strong><el-tag size="small">{{ wo.status }}</el-tag></div>
            <div class="muted">{{ wo.instance_code || '-' }} · {{ wo.title }}</div>
            <div class="wo-actions">
              <el-button v-if="canQc" size="small" type="success" @click="openQc(wo)">录入质检</el-button>
              <el-button size="small" @click="go('/quality')">质检台账</el-button>
            </div>
          </div>
        </el-tab-pane>

        <el-tab-pane label="图纸" name="docs">
          <el-empty v-if="!pendingDocs.length" description="暂无待签文档" :image-size="48" />
          <div v-for="doc in pendingDocs" :key="doc.id" class="doc-line">
            <div>
              <strong>{{ doc.title || doc.file_name }}</strong>
              <div class="muted">{{ doc.instance_code || '-' }} · {{ doc.doc_type }} · {{ doc.version || '-' }}</div>
            </div>
            <div>
              <el-button size="small" link @click="downloadDoc(doc)">查看</el-button>
              <el-button size="small" type="primary" @click="ackDoc(doc)">签收</el-button>
            </div>
          </div>
        </el-tab-pane>

        <el-tab-pane label="异常" name="exception">
          <el-form :model="andonForm" label-position="top">
            <el-form-item label="异常标题"><el-input v-model="andonForm.title" placeholder="例如：装配缺件 / 图纸不清 / 设备故障" /></el-form-item>
            <el-form-item label="说明"><el-input v-model="andonForm.message" type="textarea" :rows="3" /></el-form-item>
            <el-form-item>
              <el-button type="danger" style="width:100%" :loading="saving" @click="raiseException">一键上报异常</el-button>
            </el-form-item>
          </el-form>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-card shadow="never" class="panel">
      <template #header><div class="card-header"><span>当前工单</span><el-button link @click="go('/work-orders')">全部</el-button></div></template>
      <el-empty v-if="!workOrders.length" description="暂无待处理工单" :image-size="48" />
      <div v-for="wo in workOrders.slice(0, 3)" :key="wo.id" class="wo-card">
        <div class="wo-main">
          <strong>{{ wo.wo_code }}</strong>
          <el-tag size="small">{{ wo.status }}</el-tag>
        </div>
        <div class="muted">{{ wo.instance_code || '-' }} · {{ wo.title }}</div>
        <div class="wo-actions">
          <el-button v-if="canPick" size="small" @click="openPick(wo)">领料</el-button>
          <el-button size="small" type="primary" @click="openReport(wo)">报工</el-button>
          <el-button v-if="canQc" size="small" type="success" @click="openQc(wo)">质检</el-button>
        </div>
      </div>
    </el-card>

    <el-dialog v-model="reportVisible" title="现场报工" width="420px">
      <el-form :model="reportForm" label-width="90px">
        <el-form-item label="工单">{{ currentWo?.wo_code }}</el-form-item>
        <el-form-item label="工时"><el-input-number v-model="reportForm.hours_spent" :min="0.1" :step="0.5" style="width:100%" /></el-form-item>
        <el-form-item label="完成数量"><el-input-number v-model="reportForm.quantity_completed" :min="0" style="width:100%" /></el-form-item>
        <el-form-item label="质量"><el-select v-model="reportForm.quality_result" style="width:100%"><el-option label="合格" value="pass" /><el-option label="不合格" value="fail" /></el-select></el-form-item>
      </el-form>
      <template #footer><el-button @click="reportVisible=false">取消</el-button><el-button type="primary" :loading="saving" @click="submitReport">提交</el-button></template>
    </el-dialog>

    <el-dialog v-model="qcVisible" title="现场质检" width="420px">
      <el-form :model="qcForm" label-width="90px">
        <el-form-item label="工单">{{ currentWo?.wo_code }}</el-form-item>
        <el-form-item label="类型"><el-select v-model="qcForm.inspection_type" style="width:100%"><el-option label="工序检验" value="in_process" /><el-option label="终检" value="final" /></el-select></el-form-item>
        <el-form-item label="结果"><el-radio-group v-model="qcForm.result"><el-radio-button label="pass">合格</el-radio-button><el-radio-button label="fail">不合格</el-radio-button></el-radio-group></el-form-item>
        <el-form-item label="备注"><el-input v-model="qcForm.notes" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="qcVisible=false">取消</el-button><el-button type="primary" :loading="saving" @click="submitQc">提交</el-button></template>
    </el-dialog>

    <el-drawer v-model="pickVisible" size="96%" title="工单领料 / 退料">
      <el-alert
        v-if="pickList"
        :title="`${pickList.wo_code}：工单数量 ${pickList.work_order_qty || 1}，已齐套 ${pickList.done_items || 0}/${pickList.total_items || 0}，短缺 ${pickList.short_items || 0}`"
        type="info"
        :closable="false"
        style="margin-bottom:12px"
      />
      <div class="pick-actions">
        <el-button size="small" :loading="pickLoading" @click="refreshPick">刷新领料单</el-button>
        <el-button size="small" type="primary" @click="fillSuggestedPick">一键填入建议量</el-button>
        <el-button size="small" type="success" :loading="pickSubmitting" @click="submitPick">提交领料</el-button>
        <el-button size="small" @click="go('/kit-closure')">缺料闭环</el-button>
      </div>
      <el-tabs model-value="pick">
        <el-tab-pane label="领料单" name="pick">
          <el-table :data="pickList?.items || []" size="small" height="430">
            <el-table-column prop="material_code" label="物料" width="120" />
            <el-table-column prop="material_name" label="名称" min-width="160" show-overflow-tooltip />
            <el-table-column prop="bom_required" label="需求" width="80" />
            <el-table-column prop="already_picked" label="已领" width="80" />
            <el-table-column prop="remaining" label="待领" width="80" />
            <el-table-column prop="available_qty" label="可用" width="80" />
            <el-table-column label="建议批次" min-width="220" show-overflow-tooltip>
              <template #default="{ row }">
                <span v-if="row.suggested_allocations?.length">
                  {{ row.suggested_allocations.map((a: any) => `${a.lot_no}@${a.location}×${a.quantity}`).join('，') }}
                </span>
                <span v-else class="muted">—</span>
              </template>
            </el-table-column>
            <el-table-column label="本次领料" width="150">
              <template #default="{ row }">
                <el-input-number
                  v-model="pickQuantities[row.material_id]"
                  :min="0"
                  :max="Number(row.suggested_pick_qty || row.remaining || 0)"
                  :step="1"
                  size="small"
                  controls-position="right"
                  :disabled="row.status === 'done' || row.status === 'empty'"
                />
              </template>
            </el-table-column>
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="pickStatusType(row.status)" size="small">{{ pickStatusLabel(row.status) }}</el-tag>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="退料" name="return">
          <el-empty v-if="!pickList?.returnable_lots?.length" description="暂无可退批次" :image-size="64" />
          <el-table v-else :data="pickList.returnable_lots" size="small" height="360">
            <el-table-column prop="material_code" label="物料" width="120" />
            <el-table-column prop="material_name" label="名称" min-width="150" />
            <el-table-column prop="lot_no" label="批次" width="120" />
            <el-table-column prop="returnable_qty" label="可退" width="80" />
            <el-table-column label="退料数量" width="150">
              <template #default="{ row }">
                <el-input-number v-model="returnQuantities[row.lot_id]" :min="0" :max="Number(row.returnable_qty || 0)" :step="1" size="small" controls-position="right" />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="90">
              <template #default="{ row }">
                <el-button size="small" type="warning" link :loading="pickSubmitting" @click="submitReturn(row)">退料</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="历史" name="history">
          <el-empty v-if="!pickHistory.length" description="暂无领退料历史" :image-size="64" />
          <el-timeline v-else>
            <el-timeline-item v-for="m in pickHistory" :key="m.id" :timestamp="m.created_at" :type="m.movement_type === 'issue' ? 'success' : 'warning'">
              <div class="history-line">
                <el-tag size="small" :type="m.movement_type === 'issue' ? 'success' : 'warning'">{{ m.movement_type === 'issue' ? '领料' : '退料' }}</el-tag>
                <span>{{ m.material_code }} · {{ m.material_name }} · {{ m.lot_no }}</span>
                <b>{{ m.quantity }} {{ m.unit }}</b>
              </div>
              <div class="muted">{{ m.from_location || m.to_location || '-' }} · {{ m.operator_name || '未记录操作人' }} · {{ m.notes || '' }}</div>
            </el-timeline-item>
          </el-timeline>
        </el-tab-pane>
      </el-tabs>
      <template #footer><el-button @click="pickVisible=false">关闭</el-button></template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { Refresh } from '@element-plus/icons-vue'
import { useShopfloorWorkspacePage } from '../composables/useShopfloorWorkspacePage'

const {
  loading,
  saving,
  activeTab,
  summary,
  workOrders,
  pendingDocs,
  scanCode,
  scanResult,
  currentWo,
  reportVisible,
  qcVisible,
  pickVisible,
  pickLoading,
  pickSubmitting,
  pickList,
  pickHistory,
  pickQuantities,
  returnQuantities,
  reportForm,
  qcForm,
  andonForm,
  roleLabel,
  canQc,
  canPick,
  go,
  loadAll,
  lookupScan,
  executeScan,
  openPick,
  refreshPick,
  pickStatusType,
  pickStatusLabel,
  fillSuggestedPick,
  submitPick,
  submitReturn,
  openReport,
  submitReport,
  openQc,
  submitQc,
  ackDoc,
  downloadDoc,
  raiseException } = useShopfloorWorkspacePage()
</script>

<style scoped>
.shopfloor-page { padding: 12px; max-width: 780px; margin: 0 auto; }
.mobile-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; }
.page-title { font-size: 22px; font-weight: 700; }
.page-subtitle, .muted { color: var(--el-text-color-secondary); font-size: 12px; }
.kpi-row { margin-bottom: 10px; }
.kpi { text-align:center; min-height:78px; }
.kpi strong { font-size:26px; display:block; margin-top:6px; }
.kpi.danger strong { color: var(--el-color-danger); }
.panel { margin-bottom: 10px; border-radius: 12px; }
.role-panel :deep(.el-tabs__item) { font-weight: 600; }
.card-header { display:flex; justify-content:space-between; align-items:center; }
.scan-result { margin-top: 10px; }
.action-grid { display:grid; grid-template-columns: repeat(4, 1fr); gap:8px; margin-top:10px; }
.wo-card { padding: 10px 0; border-bottom:1px solid var(--el-border-color-lighter); }
.wo-main, .doc-line { display:flex; justify-content:space-between; align-items:center; gap:8px; }
.wo-actions { display:flex; gap:8px; margin-top:8px; flex-wrap:wrap; }
.doc-line { padding: 8px 0; border-bottom:1px solid var(--el-border-color-lighter); }
.pick-actions { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px; }
.history-line { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
@media (max-width: 640px) {
  .action-grid { grid-template-columns: repeat(2, 1fr); }
  .wo-actions .el-button { flex: 1; }
}
</style>
