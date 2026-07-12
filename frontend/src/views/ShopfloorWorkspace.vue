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
              <el-button size="small" type="primary" @click="openPick(wo)">查看领料单</el-button>
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
              <el-button size="small" type="success" @click="openQc(wo)">录入质检</el-button>
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
          <el-button size="small" @click="openPick(wo)">领料</el-button>
          <el-button size="small" type="primary" @click="openReport(wo)">报工</el-button>
          <el-button size="small" type="success" @click="openQc(wo)">质检</el-button>
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

    <el-drawer v-model="pickVisible" size="90%" title="工单领料">
      <el-alert v-if="pickList" :title="`${pickList.wo_code}：齐套 ${pickList.done_items || 0}/${pickList.total_items || 0}，短缺 ${pickList.short_items || 0}`" type="info" :closable="false" style="margin-bottom:12px" />
      <el-table :data="pickList?.items || []" size="small" height="520">
        <el-table-column prop="material_code" label="物料" width="120" />
        <el-table-column prop="material_name" label="名称" min-width="160" show-overflow-tooltip />
        <el-table-column prop="remaining" label="待领" width="80" />
        <el-table-column prop="available_qty" label="可用" width="80" />
        <el-table-column label="状态" width="80"><template #default="{ row }"><el-tag :type="row.status === 'ready' ? 'success' : row.status === 'done' ? 'info' : 'danger'" size="small">{{ row.status }}</el-tag></template></el-table-column>
      </el-table>
      <template #footer><el-button @click="pickVisible=false">关闭</el-button><el-button type="primary" @click="go('/kit-closure')">缺料闭环</el-button></template>
    </el-drawer>
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
const activeTab = ref('scan')
const summary = reactive<any>({})
const workOrders = ref<any[]>([])
const pendingDocs = ref<any[]>([])
const scanCode = ref('')
const scanResult = ref<any | null>(null)
const currentWo = ref<any | null>(null)
const reportVisible = ref(false)
const qcVisible = ref(false)
const pickVisible = ref(false)
const pickList = ref<any | null>(null)
const reportForm = reactive({ hours_spent: 1, quantity_completed: 1, quality_result: 'pass' })
const qcForm = reactive({ inspection_type: 'in_process', result: 'pass', notes: '' })
const andonForm = reactive({ title: '', message: '' })

const currentUser = computed(() => {
  try { return JSON.parse(localStorage.getItem('tbm_user') || '{}') } catch { return {} }
})
const roleCode = computed(() => String(currentUser.value.role || currentUser.value.role_code || '').toLowerCase())
const roleLabel = computed(() => {
  const map: any = { admin: '管理员', foreman: '车间主任', worker: '工人', welder: '焊工', qc: '质检员', warehouse: '仓库员', storekeeper: '仓库员', material: '仓库员' }
  return map[roleCode.value] || currentUser.value.role_name || '现场人员'
})

function defaultTabByRole(role: string) {
  if (['warehouse', 'storekeeper', 'material', 'inventory'].includes(role)) return 'pick'
  if (role === 'qc' || role.includes('quality')) return 'qc'
  if (role === 'worker' || role === 'welder' || role === 'foreman') return 'scan'
  return 'scan'
}

function applyDefaultTab() {
  const urlTab = typeof route.query.tab === 'string' ? route.query.tab : ''
  activeTab.value = urlTab || defaultTabByRole(roleCode.value)
}

watch(activeTab, (value) => {
  if (route.query.tab !== value) router.replace({ query: { ...route.query, tab: value } })
})

watch(() => route.query.tab, () => {
  const next = typeof route.query.tab === 'string' ? route.query.tab : defaultTabByRole(roleCode.value)
  if (next !== activeTab.value) activeTab.value = next
})

function go(path: string) { router.push(path) }

async function loadAll() {
  loading.value = true
  try {
    const data: any = await Api.shopfloorOverview()
    Object.assign(summary, data.summary || {})
    workOrders.value = data.work_orders || []
    pendingDocs.value = data.pending_documents || []
  } finally { loading.value = false }
}

async function lookupScan() {
  if (!scanCode.value) return
  scanResult.value = await Api.get('/scan/lookup', { params: { code: scanCode.value } })
}

async function executeScan(action: string) {
  if (!scanCode.value) return
  saving.value = true
  try {
    await Api.post('/scan/execute', { code: scanCode.value, action, quantity_completed: 1, hours_worked: 1 })
    ElMessage.success('已记录')
    await loadAll()
  } finally { saving.value = false }
}

async function openPick(wo: any) {
  currentWo.value = wo
  pickVisible.value = true
  pickList.value = await Api.get(`/work_orders/${wo.id}/pick-list`)
}

function openReport(wo: any) {
  currentWo.value = wo
  Object.assign(reportForm, { hours_spent: 1, quantity_completed: 1, quality_result: 'pass' })
  reportVisible.value = true
}

async function submitReport() {
  if (!currentWo.value) return
  saving.value = true
  try {
    await Api.post('/work-reports', { work_order_id: currentWo.value.id, worker_id: 1, ...reportForm })
    ElMessage.success('报工已提交')
    reportVisible.value = false
    await loadAll()
  } finally { saving.value = false }
}

function openQc(wo: any) {
  currentWo.value = wo
  Object.assign(qcForm, { inspection_type: 'in_process', result: 'pass', notes: '' })
  qcVisible.value = true
}

async function submitQc() {
  if (!currentWo.value) return
  saving.value = true
  try {
    await Api.post('/qc_inspections', {
      equipment_instance_id: currentWo.value.equipment_instance_id,
      work_order_id: currentWo.value.id,
      ...qcForm,
    })
    ElMessage.success('质检已提交')
    qcVisible.value = false
    await loadAll()
  } finally { saving.value = false }
}

async function ackDoc(doc: any) {
  await Api.acknowledgeDocument(doc.id)
  ElMessage.success('已签收')
  await loadAll()
}

function downloadDoc(doc: any) {
  window.open(Api.documentDownloadUrl(doc.id), '_blank')
}

async function raiseException() {
  if (!andonForm.title) { ElMessage.warning('请填写异常标题'); return }
  saving.value = true
  try {
    await Api.post('/exceptions/shopfloor_manual/action', { action: 'comment', status: 'open', note: `${andonForm.title}：${andonForm.message || ''}` })
    ElMessage.success('异常已上报到异常中心')
    Object.assign(andonForm, { title: '', message: '' })
    await loadAll()
  } finally { saving.value = false }
}

onMounted(async () => { applyDefaultTab(); await loadAll() })
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
@media (max-width: 640px) {
  .action-grid { grid-template-columns: repeat(2, 1fr); }
  .wo-actions .el-button { flex: 1; }
}
</style>
