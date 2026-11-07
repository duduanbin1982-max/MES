<template>
  <div class="page">
    <PageToolbar class="page-header">
      <div>
        <div class="page-title">齐套与缺料闭环</div>
        <div class="page-subtitle">工单齐套检查、缺料分派、采购跟催与补齐关闭</div>
      </div>
      <el-button :icon="Refresh" size="small" :loading="loading" @click="loadAll">刷新</el-button>
    </PageToolbar>

    <el-row :gutter="16" class="kpi-row">
      <el-col :span="6"><el-card class="kpi-card"><div class="stat-label">待处理缺料</div><div class="stat-value">{{ summary.total || 0 }}</div></el-card></el-col>
      <el-col :span="6"><el-card class="kpi-card"><div class="stat-label">关键/高优先</div><div class="stat-value danger">{{ (summary.by_priority?.critical || 0) + (summary.by_priority?.high || 0) }}</div></el-card></el-col>
      <el-col :span="6"><el-card class="kpi-card"><div class="stat-label">采购中</div><div class="stat-value warning">{{ summary.by_status?.purchasing || 0 }}</div></el-card></el-col>
      <el-col :span="6"><el-card class="kpi-card"><div class="stat-label">总缺口</div><div class="stat-value">{{ summary.shortage_qty || 0 }}</div></el-card></el-col>
    </el-row>

    <el-card class="sync-card">
      <div class="sync-row">
        <el-select v-model="selectedWoId" filterable placeholder="选择工单同步齐套" style="width: 360px" size="small">
          <el-option v-for="w in workOrders" :key="w.id" :label="`${w.wo_code} ${w.title || ''}`" :value="w.id" />
        </el-select>
        <el-button type="primary" size="small" :disabled="!selectedWoId" :loading="syncing" @click="syncKit">同步齐套检查</el-button>
      </div>
    </el-card>

    <el-card>
      <template #header>
        <div class="toolbar">
          <span>缺料单</span>
          <div class="filters">
            <el-select v-model="filters.status" clearable size="small" placeholder="状态" style="width: 130px" @change="loadAll">
              <el-option label="未关闭" value="" />
              <el-option label="未分派" value="open" />
              <el-option label="已分派" value="assigned" />
              <el-option label="采购中" value="purchasing" />
              <el-option label="已到货" value="arrived" />
              <el-option label="已关闭" value="closed" />
            </el-select>
            <el-select v-model="filters.priority" clearable size="small" placeholder="优先级" style="width: 130px" @change="loadAll">
              <el-option label="关键" value="critical" />
              <el-option label="高" value="high" />
              <el-option label="普通" value="normal" />
            </el-select>
            <el-checkbox v-model="filters.include_closed" @change="loadAll">含已关闭</el-checkbox>
          </div>
        </div>
      </template>
      <el-table :data="rows" size="small" height="590" @row-click="openDetail">
        <el-table-column label="优先级" width="90"><template #default="{ row }"><el-tag :type="priorityTag(row.priority)" size="small">{{ priorityLabel(row.priority) }}</el-tag></template></el-table-column>
        <el-table-column prop="wo_code" label="工单" width="160" />
        <el-table-column prop="material_code" label="物料编码" width="150" />
        <el-table-column prop="material_name" label="物料名称" min-width="180" show-overflow-tooltip />
        <el-table-column prop="shortage_qty" label="缺口" width="90" />
        <el-table-column prop="available_qty" label="可用" width="90" />
        <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="statusTag(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
        <el-table-column prop="owner_name" label="责任人" width="110"><template #default="{ row }">{{ row.owner_name || '-' }}</template></el-table-column>
        <el-table-column prop="expected_date" label="预计补齐" width="120"><template #default="{ row }">{{ shortDate(row.expected_date) }}</template></el-table-column>
        <el-table-column label="操作" width="190" fixed="right">
          <template #default="{ row }">
            <el-button link size="small" @click.stop="openDetail(row)">处理</el-button>
            <el-button link size="small" @click.stop="createPurchase(row)">采购申请</el-button>
            <el-button link size="small" @click.stop="closeRow(row)">关闭</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" title="缺料处理" width="720px">
      <template v-if="current">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="工单">{{ current.wo_code }}</el-descriptions-item>
          <el-descriptions-item label="项目">{{ current.instance_code || '-' }}</el-descriptions-item>
          <el-descriptions-item label="物料">{{ current.material_code }} {{ current.material_name }}</el-descriptions-item>
          <el-descriptions-item label="缺口">{{ current.shortage_qty }} {{ current.unit }}</el-descriptions-item>
          <el-descriptions-item label="状态"><el-tag :type="statusTag(current.status)" size="small">{{ statusLabel(current.status) }}</el-tag></el-descriptions-item>
          <el-descriptions-item label="采购申请">{{ current.purchase_request_no || '-' }}</el-descriptions-item>
        </el-descriptions>
        <el-form label-width="90px" size="small" class="handle-form">
          <el-form-item label="责任人">
            <el-select v-model="form.owner_id" filterable style="width: 260px">
              <el-option v-for="u in users" :key="u.id" :label="u.full_name || u.username" :value="u.id" />
            </el-select>
            <el-button type="primary" :disabled="!form.owner_id" :loading="saving" style="margin-left: 8px" @click="assign">分派</el-button>
          </el-form-item>
          <el-form-item label="预计补齐">
            <el-date-picker v-model="form.expected_date" value-format="YYYY-MM-DD" type="date" placeholder="预计日期" />
          </el-form-item>
          <el-form-item label="处理记录">
            <el-input v-model="form.note" type="textarea" :rows="3" />
          </el-form-item>
          <el-form-item>
            <el-button :loading="saving" @click="followUp('purchasing')">采购中</el-button>
            <el-button :loading="saving" @click="followUp('arrived')">标记到货</el-button>
            <el-button type="success" :loading="saving" @click="closeCurrent">补齐关闭</el-button>
            <el-button type="primary" :loading="saving" @click="purchaseCurrent">生成采购申请</el-button>
          </el-form-item>
        </el-form>
        <el-timeline>
          <el-timeline-item v-for="a in actions" :key="a.id" :timestamp="a.created_at">
            <b>{{ actionLabel(a.action) }}</b> <span class="muted">{{ a.created_by_name || '-' }}</span>
            <div class="muted">{{ a.note || '-' }}</div>
          </el-timeline-item>
        </el-timeline>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { Api } from '../api'
import { SHORTAGE_STATUS_META, statusLabel as catalogStatusLabel, statusTag as catalogStatusTag } from '../domain/statusCatalog'

const loading = ref(false)
const syncing = ref(false)
const saving = ref(false)
const dialogVisible = ref(false)
const rows = ref<any[]>([])
const workOrders = ref<any[]>([])
const users = ref<any[]>([])
const actions = ref<any[]>([])
const selectedWoId = ref<number | null>(null)
const current = ref<any | null>(null)
const summary = reactive<any>({ by_status: {}, by_priority: {} })
const filters = reactive({ status: '', priority: '', include_closed: false })
const form = reactive<any>({ owner_id: null, expected_date: '', note: '' })

function priorityTag(p: string) { return p === 'critical' || p === 'high' ? 'danger' : 'info' }
function priorityLabel(p: string) { return ({ critical: '关键', high: '高', normal: '普通', low: '低' } as any)[p] || p }
function statusTag(s: string) { return catalogStatusTag(SHORTAGE_STATUS_META, s) }
function statusLabel(s: string) { return catalogStatusLabel(SHORTAGE_STATUS_META, s) }
function actionLabel(a: string) { return ({ create: '创建', assign: '分派', follow_up: '跟催', purchase_request: '采购申请', close: '关闭', auto_close: '自动关闭' } as any)[a] || a }
function shortDate(v?: string) { return v ? String(v).slice(0, 10) : '-' }

async function loadAll() {
  loading.value = true
  try {
    const params: any = {}
    if (filters.status) params.status = filters.status
    if (filters.priority) params.priority = filters.priority
    if (filters.include_closed) params.include_closed = 1
    const [shortages, wo, userData]: any[] = await Promise.all([Api.shortages(params), Api.workOrders(), Api.users()])
    rows.value = shortages.rows || []
    Object.assign(summary, shortages.summary || {})
    workOrders.value = wo.rows || wo.items || wo || []
    users.value = userData.items || userData.rows || []
  } finally {
    loading.value = false
  }
}

async function syncKit() {
  if (!selectedWoId.value) return
  syncing.value = true
  try {
    const data: any = await Api.syncKit(selectedWoId.value)
    ElMessage.success(data.kit_ready ? '该工单已齐套' : `同步完成，缺料 ${data.short_items} 项`)
    await loadAll()
  } finally {
    syncing.value = false
  }
}

async function openDetail(row: any) {
  current.value = row
  form.owner_id = row.owner_id || null
  form.expected_date = shortDate(row.expected_date) === '-' ? '' : shortDate(row.expected_date)
  form.note = ''
  const detail: any = await Api.shortageDetail(row.id)
  actions.value = detail.actions || []
  dialogVisible.value = true
}

async function save(fn: () => Promise<any>, msg: string) {
  if (!current.value) return
  saving.value = true
  try {
    await fn()
    ElMessage.success(msg)
    await loadAll()
    const refreshed = rows.value.find((r) => r.id === current.value.id) || current.value
    await openDetail(refreshed)
  } finally {
    saving.value = false
  }
}
function assign() { save(() => Api.assignShortage(current.value.id, { owner_id: form.owner_id, expected_date: form.expected_date, note: form.note }), '已分派') }
function followUp(status: string) { save(() => Api.followShortage(current.value.id, { status, expected_date: form.expected_date, note: form.note }), '已更新') }
function closeCurrent() { save(() => Api.closeShortage(current.value.id, { note: form.note }), '已关闭') }
function purchaseCurrent() { save(() => Api.purchaseRequestShortage(current.value.id, { expected_date: form.expected_date, note: form.note }), '已生成采购申请') }
function createPurchase(row: any) { openDetail(row).then(() => purchaseCurrent()) }
function closeRow(row: any) { openDetail(row).then(() => closeCurrent()) }

onMounted(loadAll)
</script>

<style scoped>
.page-subtitle { color: var(--el-text-color-secondary); font-size: 13px; margin-top: 4px; }
.kpi-row { margin-bottom: 16px; }
.kpi-card { min-height: 92px; }
.stat-label { color: var(--el-text-color-secondary); font-size: 13px; }
.stat-value { font-size: 30px; font-weight: 700; margin-top: 10px; }
.stat-value.danger { color: var(--el-color-danger); }
.stat-value.warning { color: var(--el-color-warning); }
.sync-card { margin-bottom: 16px; }
.sync-row, .toolbar, .filters { display: flex; align-items: center; gap: 12px; justify-content: space-between; }
.filters { justify-content: flex-end; }
.handle-form { margin-top: 16px; }
.muted { color: var(--el-text-color-secondary); font-size: 12px; }
</style>
