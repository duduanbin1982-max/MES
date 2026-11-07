<template>
  <div class="page">
    <PageToolbar class="page-header">
      <div>
        <div class="page-title">异常中心</div>
        <div class="page-subtitle">统一汇聚延期、质量、安灯、库存、ECO 与采购风险</div>
      </div>
      <div class="header-actions"><el-button type="warning" size="small" :loading="saving" @click="escalateDue">升级到期异常</el-button><el-button :icon="Refresh" size="small" :loading="loading" @click="loadAll">刷新</el-button></div>
    </PageToolbar>

    <el-row :gutter="16" class="kpi-row">
      <el-col :span="6"><el-card class="kpi-card"><div class="stat-label">待处理异常</div><div class="stat-value">{{ summary.total || 0 }}</div></el-card></el-col>
      <el-col :span="6"><el-card class="kpi-card"><div class="stat-label">严重</div><div class="stat-value danger">{{ summary.by_severity?.critical || 0 }}</div></el-card></el-col>
      <el-col :span="6"><el-card class="kpi-card"><div class="stat-label">高风险</div><div class="stat-value danger">{{ summary.by_severity?.high || 0 }}</div></el-card></el-col>
      <el-col :span="6"><el-card class="kpi-card"><div class="stat-label">处理中</div><div class="stat-value warning">{{ (summary.by_status?.assigned || 0) + (summary.by_status?.processing || 0) }}</div></el-card></el-col>
    </el-row>

    <el-card>
      <template #header>
        <div class="toolbar">
          <div class="filters">
            <el-segmented v-model="filters.severity" :options="severityOptions" size="small" @change="loadAll" />
            <el-select v-model="filters.status" clearable placeholder="处理状态" size="small" style="width: 140px" @change="loadAll">
              <el-option label="未关闭" value="" />
              <el-option label="未分派" value="open" />
              <el-option label="已分派" value="assigned" />
              <el-option label="处理中" value="processing" />
              <el-option label="已关闭" value="closed" />
            </el-select>
            <el-select v-model="filters.type" clearable placeholder="异常类型" size="small" style="width: 180px" @change="loadAll">
              <el-option v-for="t in typeOptions" :key="t.value" :label="t.label" :value="t.value" />
            </el-select>
            <el-checkbox v-model="filters.include_closed" @change="loadAll">含已关闭</el-checkbox>
          </div>
        </div>
      </template>

      <el-table :data="items" size="small" height="640" @row-click="openDetail">
        <el-table-column label="级别" width="80"><template #default="{ row }"><el-tag :type="severityTag(row.severity)" size="small">{{ severityLabel(row.severity) }}</el-tag></template></el-table-column>
        <el-table-column prop="title" label="异常" min-width="220" show-overflow-tooltip />
        <el-table-column prop="message" label="说明" min-width="260" show-overflow-tooltip />
        <el-table-column prop="instance_code" label="项目" width="140"><template #default="{ row }">{{ row.instance_code || '-' }}</template></el-table-column>
        <el-table-column label="状态" width="120"><template #default="{ row }"><el-tag :type="statusTag(row.case_status)" size="small">{{ statusLabel(row.case_status) }}</el-tag><el-tag v-if="row.escalation_due" type="danger" size="small" style="margin-left:4px">待升级</el-tag></template></el-table-column>
        <el-table-column label="责任人" width="110"><template #default="{ row }">{{ row.owner_name || '-' }}</template></el-table-column>
        <el-table-column label="类型" width="120"><template #default="{ row }">{{ typeLabel(row.type) }}</template></el-table-column>
        <el-table-column prop="due_at" label="期限" width="120"><template #default="{ row }">{{ shortDate(row.due_at) }}</template></el-table-column>
        <el-table-column label="操作" width="170" fixed="right">
          <template #default="{ row }">
            <el-button link size="small" @click.stop="openDetail(row)">处理</el-button>
            <el-button v-if="row.type === 'kit_shortage'" link size="small" @click.stop="restartFollowup(row)">重新催办</el-button>
            <el-button link size="small" @click.stop="go(row.source_path)">{{ row.action_label || '查看' }}</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" title="异常处理" width="760px">
      <template v-if="current">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="异常">{{ current.title }}</el-descriptions-item>
          <el-descriptions-item label="项目">{{ current.instance_code || '-' }}</el-descriptions-item>
          <el-descriptions-item label="级别"><el-tag :type="severityTag(current.severity)" size="small">{{ severityLabel(current.severity) }}</el-tag></el-descriptions-item>
          <el-descriptions-item label="状态"><el-tag :type="statusTag(current.case_status)" size="small">{{ statusLabel(current.case_status) }}</el-tag></el-descriptions-item>
          <el-descriptions-item label="责任人">{{ detail.case?.owner_name || current.owner_name || '-' }}</el-descriptions-item>
          <el-descriptions-item label="期限">{{ shortDate(detail.case?.due_at || current.due_at) }}</el-descriptions-item><el-descriptions-item label="升级规则">{{ current.escalation_rule_name || "-" }}</el-descriptions-item><el-descriptions-item label="升级对象">{{ current.escalation_to_role || "-" }}</el-descriptions-item>
          <el-descriptions-item label="说明" :span="2">{{ current.message }}</el-descriptions-item>
        </el-descriptions>

        <el-tabs v-model="activeTab" class="detail-tabs">
          <el-tab-pane label="处理" name="handle">
            <el-form label-width="90px" size="small">
              <el-form-item label="责任人">
                <el-select v-model="form.owner_id" filterable placeholder="选择责任人" style="width: 260px">
                  <el-option v-for="u in users" :key="u.id" :label="u.full_name || u.username" :value="u.id" />
                </el-select>
                <el-button type="primary" :disabled="!form.owner_id" :loading="saving" style="margin-left: 8px" @click="assign">分派</el-button>
              </el-form-item>
              <el-form-item label="处理记录">
                <el-input v-model="form.note" type="textarea" :rows="3" placeholder="填写处理进展、原因或关闭说明" />
              </el-form-item>
              <el-form-item>
                <el-button :loading="saving" @click="startProcess">开始处理</el-button>
                <el-button type="success" :loading="saving" @click="closeCase">关闭异常</el-button>
                <el-button v-if="current.case_status === 'closed'" type="warning" :loading="saving" @click="reopenCase">重新打开</el-button>
                <el-button v-if="current.type === 'kit_shortage'" type="primary" :loading="saving" @click="restartCurrentFollowup">重新发起采购催办</el-button>
                <el-button @click="go(current.source_path)">查看来源</el-button><el-button type="warning" :loading="saving" @click="notifyCurrent">发送提醒</el-button><el-button type="danger" :loading="saving" @click="escalateCurrent">升级</el-button>
              </el-form-item>
            </el-form>
          </el-tab-pane>
          <el-tab-pane label="记录" name="logs">
            <el-timeline>
              <el-timeline-item v-for="a in detail.actions" :key="a.id" :timestamp="a.created_at" placement="top">
                <div class="action-title">{{ actionLabel(a.action) }} <span class="muted">{{ a.created_by_name || '-' }}</span></div>
                <div class="muted">{{ a.note || '-' }}</div>
              </el-timeline-item>
            </el-timeline>
            <PageState state="empty" compact :show-action="false" v-if="!detail.actions?.length" description="暂无处理记录" />
          </el-tab-pane>
        </el-tabs>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { Api } from '../api'

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const saving = ref(false)
const dialogVisible = ref(false)
const activeTab = ref('handle')
const items = ref<any[]>([])
const users = ref<any[]>([])
const current = ref<any | null>(null)
const detail = reactive<any>({ case: null, actions: [] })
const summary = reactive<any>({ by_severity: {}, by_type: {}, by_status: {} })
const form = reactive<any>({ owner_id: null, note: '' })
const filters = reactive({
  severity: route.query.severity ? String(route.query.severity) : 'all',
  type: route.query.type ? String(route.query.type) : '',
  status: route.query.status ? String(route.query.status) : '',
  include_closed: route.query.include_closed === '1',
  instance_id: route.query.instance_id ? String(route.query.instance_id) : '',
})

watch(() => route.query, async (query) => {
  filters.severity = query.severity ? String(query.severity) : 'all'
  filters.type = query.type ? String(query.type) : ''
  filters.status = query.status ? String(query.status) : ''
  filters.include_closed = query.include_closed === '1'
  filters.instance_id = query.instance_id ? String(query.instance_id) : ''
  await loadAll()
})

const severityOptions = [{ label: '全部', value: 'all' }, { label: '严重', value: 'critical' }, { label: '高风险', value: 'high' }, { label: '预警', value: 'warning' }, { label: '提示', value: 'info' }]
const typeLabels: Record<string, string> = { delivery_delay: '工单延期', process_delay: '工序延期', process_blocked: '工序卡滞', eco_pending: 'ECO', andon: 'ANDON', quality_ncr: '质量NCR', kit_shortage: '齐套缺料', low_stock: '库存预警', purchase_delay: '采购延期', mdm_materials: '主数据-物料', mdm_bom: '主数据-BOM', mdm_documents: '主数据-图纸', mdm_suppliers: '主数据-供应商', mdm_process: '主数据-工序工位', mdm_labor: '主数据-人员资质', closed_source: '已归档' }
const typeOptions = computed(() => Object.keys(summary.by_type || {}).map((k) => ({ value: k, label: `${typeLabel(k)} (${summary.by_type[k]})` })))

function typeLabel(type: string) { return typeLabels[type] || type || '-' }
function severityTag(severity: string) { return severity === 'critical' || severity === 'high' ? 'danger' : severity === 'warning' ? 'warning' : 'info' }
function severityLabel(severity: string) { return ({ critical: '严重', high: '高', warning: '中', info: '低' } as any)[severity] || severity }
function statusTag(status: string) { return status === 'closed' ? 'success' : status === 'processing' ? 'warning' : status === 'assigned' ? 'primary' : 'info' }
function statusLabel(status: string) { return ({ open: '未分派', assigned: '已分派', processing: '处理中', closed: '已关闭' } as any)[status] || status || '未分派' }
function actionLabel(action: string) { return ({ assign: '分派', start: '开始处理', comment: '记录', close: '关闭', reopen: '重开', restart_followup: '重新发起采购催办' } as any)[action] || action }
function shortDate(value?: string) { return value ? String(value).slice(0, 10) : '-' }
function go(path?: string) { if (path) router.push(path) }

async function loadUsers() {
  const data: any = await Api.users()
  users.value = data.items || data.rows || []
}

async function loadAll() {
  loading.value = true
  try {
    const params: any = {}
    if (filters.severity !== 'all') params.severity = filters.severity
    if (filters.type) params.type = filters.type
    if (filters.status) params.status = filters.status
    if (filters.include_closed) params.include_closed = 1
    if (filters.instance_id) params.instance_id = filters.instance_id
    const data: any = await Api.exceptions(params)
    items.value = data.items || []
    Object.assign(summary, data.summary || {})
  } finally {
    loading.value = false
  }
}

async function openDetail(row: any) {
  current.value = row
  activeTab.value = 'handle'
  form.owner_id = row.owner_id || null
  form.note = ''
  const data: any = await Api.exceptionDetail(row.id)
  detail.case = data.case || null
  detail.actions = data.actions || []
  if (detail.case?.owner_id) form.owner_id = detail.case.owner_id
  dialogVisible.value = true
}

async function saveAction(fn: () => Promise<any>, okMsg: string) {
  if (!current.value) return
  saving.value = true
  try {
    await fn()
    ElMessage.success(okMsg)
    await loadAll()
    const row = items.value.find((i) => i.id === current.value.id)
    if (row) await openDetail(row)
    else dialogVisible.value = false
  } finally {
    saving.value = false
  }
}

function assign() {
  saveAction(() => Api.assignException(current.value.id, { owner_id: form.owner_id, note: form.note }), '已分派')
}
function startProcess() {
  saveAction(() => Api.addExceptionAction(current.value.id, { action: 'start', note: form.note }), '已记录处理')
}
function closeCase() {
  saveAction(() => Api.closeException(current.value.id, { note: form.note }), '已关闭')
}
function reopenCase() {
  saveAction(() => Api.reopenException(current.value.id, { note: form.note }), '已重新打开')
}
function restartCurrentFollowup() {
  saveAction(() => Api.post(`/exceptions/${current.value.id}/restart-purchase-followup`, { note: form.note }), '已重新发起采购催办')
}
function restartFollowup(row: any) {
  current.value = row
  saveAction(() => Api.post(`/exceptions/${row.id}/restart-purchase-followup`, { note: form.note || '异常中心重新发起采购催办' }), '已重新发起采购催办')
}
function notifyCurrent() {
  saveAction(() => Api.notifyException(current.value.id, { note: form.note }), '已发送提醒')
}
function escalateCurrent() {
  saveAction(() => Api.escalateException(current.value.id, { note: form.note }), '已升级')
}
async function escalateDue() {
  saving.value = true
  try {
    const data: any = await Api.escalateDueExceptions({ limit: 50 })
    ElMessage.success(`已处理 ${data.sent?.length || 0} 条升级`)
    await loadAll()
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  await Promise.all([loadUsers(), loadAll()])
})
</script>

<style scoped>
.page-subtitle { color: var(--el-text-color-secondary); font-size: 13px; margin-top: 4px; }
.kpi-row { margin-bottom: 16px; }
.kpi-card { min-height: 92px; }
.stat-label { color: var(--el-text-color-secondary); font-size: 13px; }
.stat-value { font-size: 30px; font-weight: 700; margin-top: 10px; }
.stat-value.danger { color: var(--el-color-danger); }
.stat-value.warning { color: var(--el-color-warning); }
.toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.header-actions { display:flex; align-items:center; gap:8px; }
.filters { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.detail-tabs { margin-top: 16px; }
.action-title { font-weight: 600; margin-bottom: 4px; }
.muted { color: var(--el-text-color-secondary); font-size: 12px; }
</style>
