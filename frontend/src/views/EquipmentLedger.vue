<template>
  <div class="page">
    <PageToolbar
      title="设备台账"
      subtitle="车间生产设备主数据：设备、工位、IoT 状态与基础资产信息；项目装备见“项目装备台账”。"
      aria-label="车间设备台账工具栏"
    >
      <template #icon><el-icon><Monitor /></el-icon></template>
      <template #actions>
        <el-input v-model="filters.keyword" clearable placeholder="编码/名称/资产/型号/序列号" class="toolbar-search" :prefix-icon="Search" @keyup.enter="load" @clear="load" />
        <el-select v-model="filters.equipment_type" clearable placeholder="设备类型" class="toolbar-select" @change="load">
          <el-option v-for="item in meta.types" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <el-select v-model="filters.status" clearable placeholder="状态" class="toolbar-select" @change="load">
          <el-option v-for="item in meta.statuses" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <el-select v-model="filters.workshop_id" clearable placeholder="工位" class="toolbar-select" @change="load">
          <el-option v-for="item in meta.workstations" :key="item.id" :label="item.workshop + ' / ' + item.name" :value="item.id" />
        </el-select>
        <el-switch v-model="includeRetired" active-text="含退役" @change="load" />
        <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
        <el-button v-if="canWrite" type="primary" :icon="Plus" @click="openCreate">新增设备</el-button>
      </template>
    </PageToolbar>

    <PageState v-if="loadError" state="error" title="设备台账加载失败" :description="loadError" action-text="重新加载" @retry="load" />
    <PageState v-else-if="loading && !equipment.length" state="loading" title="正在加载车间设备台账" description="正在获取设备、工位与 IoT 状态。" />
    <PageState v-else-if="!equipment.length" state="empty" title="暂无车间设备" description="请新增设备或调整筛选条件。" action-text="刷新" @retry="load" />

    <template v-else>
      <el-row :gutter="14" class="summary-row">
        <el-col :span="6"><el-card class="metric-card"><div class="metric-label">设备总数</div><div class="metric-value">{{ summary.total || 0 }}</div><div class="metric-sub">当前筛选；含退役 {{ summary.retired || 0 }}</div></el-card></el-col>
        <el-col :span="6"><el-card class="metric-card"><div class="metric-label">运行中</div><div class="metric-value">{{ summary.running || 0 }}</div><div class="metric-sub">空闲 {{ summary.idle || 0 }}</div></el-card></el-col>
        <el-col :span="6"><el-card class="metric-card"><div class="metric-label">维保/故障</div><div class="metric-value">{{ (summary.maintenance || 0) + (summary.fault || 0) }}</div><div class="metric-sub">维保 {{ summary.maintenance || 0 }} · 故障 {{ summary.fault || 0 }}</div></el-card></el-col>
        <el-col :span="6"><el-card class="metric-card"><div class="metric-label">IoT 在线</div><div class="metric-value">{{ summary.iot_online || 0 }}</div><div class="metric-sub">共 {{ summary.iot_total || 0 }} 个采集设备</div></el-card></el-col>
      </el-row>

      <el-card>
        <template #header>
          <div class="card-header">
            <span>车间设备清单</span>
            <span class="header-hint">共 {{ equipment.length }} 台</span>
          </div>
        </template>
        <el-table :data="equipment" stripe style="width:100%">
          <el-table-column label="设备" min-width="200">
            <template #default="{ row }">
              <div class="device-name">{{ row.name }}</div>
              <div class="muted">{{ row.code }}<span v-if="row.asset_no"> · 资产 {{ row.asset_no }}</span></div>
            </template>
          </el-table-column>
          <el-table-column label="类型/工位" min-width="180">
            <template #default="{ row }">
              <div>{{ typeLabel(row.equipment_type) }}</div>
              <div class="muted">{{ row.workshop || '-' }} / {{ row.workstation_name || '未绑定工位' }}</div>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="110">
            <template #default="{ row }"><el-tag :type="statusMeta(row.status).type" size="small">{{ statusMeta(row.status).label }}</el-tag></template>
          </el-table-column>
          <el-table-column label="型号/序列号" min-width="170">
            <template #default="{ row }">
              <div>{{ row.model || '-' }}</div>
              <div class="muted">{{ row.serial_no || '-' }}</div>
            </template>
          </el-table-column>
          <el-table-column label="厂商/关键度" min-width="150">
            <template #default="{ row }">
              <div>{{ row.manufacturer || '-' }}</div>
              <div class="muted">关键度 {{ row.criticality || '-' }}</div>
            </template>
          </el-table-column>
          <el-table-column label="最近保养" width="120"><template #default="{ row }">{{ row.last_maintenance || '-' }}</template></el-table-column>
          <el-table-column label="IoT" width="150">
            <template #default="{ row }">
              <el-tag v-if="row.iot_count" size="small" :type="row.iot_online ? 'success' : 'info'">{{ row.iot_online }}/{{ row.iot_count }} 在线</el-tag>
              <span v-else class="muted">未接入</span>
              <div v-if="row.iot_last_seen" class="muted">{{ row.iot_last_seen }}</div>
            </template>
          </el-table-column>
          <el-table-column v-if="canWrite" label="操作" width="190" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
              <el-button link @click="openStatus(row)">状态</el-button>
              <el-popconfirm title="确认删除该设备？" @confirm="removeEquipment(row)"><template #reference><el-button link type="danger">删除</el-button></template></el-popconfirm>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </template>

    <el-dialog v-model="formDlg.show" :title="formDlg.id ? '编辑设备' : '新增设备'" width="720px">
      <el-form label-width="95px">
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item label="设备编码" required><el-input v-model="form.code" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="设备名称" required><el-input v-model="form.name" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="设备类型"><el-select v-model="form.equipment_type" style="width:100%"><el-option v-for="item in meta.types" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="资产编号"><el-input v-model="form.asset_no" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="工位"><el-select v-model="form.workstation_id" clearable style="width:100%"><el-option v-for="item in meta.workstations" :key="item.id" :label="item.workshop + ' / ' + item.name" :value="item.id" /></el-select></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="状态"><el-select v-model="form.status" style="width:100%"><el-option v-for="item in meta.statuses" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="厂商"><el-input v-model="form.manufacturer" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="型号"><el-input v-model="form.model" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="序列号"><el-input v-model="form.serial_no" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="关键度"><el-select v-model="form.criticality" style="width:100%"><el-option v-for="item in meta.criticalities" :key="item" :label="item" :value="item" /></el-select></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="存放位置"><el-input v-model="form.location" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="最近保养"><el-date-picker v-model="form.last_maintenance" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="购置日期"><el-date-picker v-model="form.purchase_date" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="保修到期"><el-date-picker v-model="form.warranty_end" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item></el-col>
          <el-col :span="24"><el-form-item label="备注"><el-input v-model="form.notes" type="textarea" :rows="2" /></el-form-item></el-col>
        </el-row>
      </el-form>
      <template #footer><el-button @click="formDlg.show = false">取消</el-button><el-button type="primary" :loading="formDlg.saving" @click="saveEquipment">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="statusDlg.show" title="变更设备状态" width="420px">
      <el-form label-width="80px"><el-form-item label="设备"><strong>{{ statusDlg.name }}</strong></el-form-item><el-form-item label="新状态"><el-select v-model="statusDlg.status" style="width:100%"><el-option v-for="item in meta.statuses" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item></el-form>
      <template #footer><el-button @click="statusDlg.show = false">取消</el-button><el-button type="primary" :loading="statusDlg.saving" @click="saveStatus">保存</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { Monitor, Plus, Refresh, Search } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { Api } from '../api'
import PageState from '../components/PageState.vue'
import PageToolbar from '../components/PageToolbar.vue'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const canWrite = computed(() => auth.role === 'admin' || auth.role === 'foreman')
const statusMap: Record<string, { label: string; type: string }> = {
  running: { label: '运行', type: 'success' }, idle: { label: '空闲', type: 'info' },
  maintenance: { label: '维保', type: 'warning' }, fault: { label: '故障', type: 'danger' },
  offline: { label: '离线', type: 'info' }, retired: { label: '退役', type: 'info' },
}
const statusMeta = (status: string) => statusMap[status] || { label: status || '-', type: 'info' }
const typeLabel = (value: string) => meta.types.find((item: any) => item.value === value)?.label || value || '-'
const errText = (error: any) => error?.response?.data?.error || error?.response?.data?.message || error?.message || String(error)
const filters = reactive({ keyword: '', equipment_type: '', status: '', workshop_id: null as any })
const includeRetired = ref(true)
const loading = ref(false)
const loadError = ref('')
const equipment = ref<any[]>([])
const summary = reactive<any>({ total: 0, running: 0, idle: 0, maintenance: 0, fault: 0, offline: 0, retired: 0, iot_online: 0, iot_total: 0 })
const meta = reactive<any>({ types: [], statuses: [], criticalities: ['A', 'B', 'C'], workstations: [] })
const emptyForm = () => ({ code: '', name: '', equipment_type: 'other', workstation_id: null, status: 'idle', asset_no: '', manufacturer: '', model: '', serial_no: '', location: '', criticality: 'B', purchase_date: null, warranty_end: null, last_maintenance: null, notes: '' })
const form = reactive<any>(emptyForm())
const formDlg = reactive<any>({ show: false, id: null, saving: false })
const statusDlg = reactive<any>({ show: false, id: null, name: '', status: 'idle', saving: false })

async function loadMeta() {
  try { Object.assign(meta, await Api.get('/equipment-ledger/meta')) } catch (error: any) { ElMessage.error('加载元数据失败：' + errText(error)) }
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const data: any = await Api.get('/equipment-ledger', { params: { keyword: filters.keyword || undefined, equipment_type: filters.equipment_type || undefined, status: filters.status || undefined, workshop_id: filters.workshop_id || undefined, include_retired: includeRetired.value } })
    equipment.value = data.equipment || []
    Object.assign(summary, data.summary || {})
  } catch (error: any) { loadError.value = errText(error) } finally { loading.value = false }
}

function openCreate() {
  Object.assign(form, emptyForm())
  formDlg.id = null
  formDlg.show = true
}

function openEdit(row: any) {
  Object.assign(form, emptyForm(), row)
  formDlg.id = row.id
  formDlg.show = true
}

async function saveEquipment() {
  if (!form.code.trim() || !form.name.trim()) { ElMessage.warning('设备编码和名称必填'); return }
  formDlg.saving = true
  try {
    if (formDlg.id) await Api.put('/equipment-ledger/' + formDlg.id, form)
    else await Api.post('/equipment-ledger', form)
    ElMessage.success('设备已保存')
    formDlg.show = false
    await Promise.all([loadMeta(), load()])
  } catch (error: any) { ElMessage.error('保存失败：' + errText(error)) } finally { formDlg.saving = false }
}

function openStatus(row: any) { Object.assign(statusDlg, { show: true, id: row.id, name: row.name, status: row.status, saving: false }) }

async function saveStatus() {
  statusDlg.saving = true
  try {
    await Api.post('/equipment-ledger/' + statusDlg.id + '/status', { status: statusDlg.status })
    ElMessage.success('状态已更新')
    statusDlg.show = false
    await load()
  } catch (error: any) { ElMessage.error('更新失败：' + errText(error)) } finally { statusDlg.saving = false }
}

async function removeEquipment(row: any) {
  try {
    await Api.del('/equipment-ledger/' + row.id)
    ElMessage.success('设备已删除')
    await load()
  } catch (error: any) { ElMessage.error('删除失败：' + errText(error)) }
}

onMounted(async () => { await loadMeta(); await load() })
</script>

<style scoped>
.page { padding: 16px; }
.toolbar-search { width: 230px; }
.toolbar-select { width: 150px; }
.summary-row { margin-bottom: 16px; }
.metric-card { min-height: 110px; }
.metric-label { color: var(--el-text-color-secondary); font-size: 13px; margin-bottom: 8px; }
.metric-value { color: var(--el-text-color-primary); font-size: 28px; font-weight: 700; line-height: 1.2; }
.metric-sub, .header-hint, .muted { color: var(--el-text-color-secondary); font-size: 12px; margin-top: 6px; }
.device-name { font-weight: 600; }
.card-header { display: flex; align-items: center; justify-content: space-between; }
</style>
