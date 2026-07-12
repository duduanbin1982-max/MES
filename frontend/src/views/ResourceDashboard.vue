<template>
  <div class="page">
    <div class="page-header">
      <div>
        <div class="page-title">资源看板</div>
        <div class="page-subtitle">人员、设备、工位能力与占用状态统一管理。</div>
      </div>
      <el-button @click="loadAll" :loading="loading" size="small">刷新</el-button>
    </div>

    <el-alert
      v-for="alert in overview.alerts || []"
      :key="alert.message"
      :title="alert.message"
      :type="alert.type"
      show-icon
      style="margin-bottom: 8px"
    />

    <el-row :gutter="16" style="margin-bottom: 16px">
      <el-col :span="6">
        <el-card class="kpi-card kpi-green">
          <div class="stat-card">
            <div class="stat-label">可用人员</div>
            <div class="stat-value">{{ overview.workers?.available ?? 0 }} / {{ overview.workers?.total ?? 0 }}</div>
            <div class="stat-sub">空闲/在线可分配</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="kpi-card kpi-orange">
          <div class="stat-card">
            <div class="stat-label">忙碌人员</div>
            <div class="stat-value">{{ overview.workers?.busy ?? 0 }}</div>
            <div class="stat-sub">正在作业</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="kpi-card kpi-blue">
          <div class="stat-card">
            <div class="stat-label">工位可用</div>
            <div class="stat-value">{{ overview.workstations?.available ?? 0 }} / {{ overview.workstations?.total ?? 0 }}</div>
            <div class="stat-sub">可用 / 总数</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="kpi-card kpi-purple">
          <div class="stat-card">
            <div class="stat-label">工位占用</div>
            <div class="stat-value">{{ overview.workstations?.occupied ?? 0 }}</div>
            <div class="stat-sub">已分配人员的工位</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16" style="margin-bottom: 16px">
      <el-col v-for="type in coreTypes" :key="type.value" :span="6">
        <el-card shadow="hover" class="type-card">
          <div class="type-title">{{ type.label }}</div>
          <div class="type-value">{{ typeCount(type.value)?.total || 0 }}</div>
          <div class="type-sub">可用 {{ typeCount(type.value)?.available || 0 }}</div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16">
      <el-col :span="8">
        <el-card>
          <template #header>人员状态</template>
          <el-table :data="workers" size="small" max-height="520" @row-click="openWorkerDialog">
            <el-table-column prop="full_name" label="姓名" min-width="80" />
            <el-table-column prop="role_code" label="角色" width="75" />
            <el-table-column prop="availability" label="状态" width="82">
              <template #default="{ row }">
                <el-tag :type="availabilityType(row.availability)" size="small">{{ availabilityLabel(row.availability) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="workstation_name" label="工位" min-width="95" />
            <el-table-column prop="skills" label="技能" min-width="120">
              <template #default="{ row }">
                <template v-if="row.skills && row.skills.length">
                  <el-tag v-for="sk in row.skills.slice(0, 2)" :key="sk" size="small" style="margin: 1px">{{ sk }}</el-tag>
                </template>
                <span v-else class="text-muted">-</span>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>

      <el-col :span="7">
        <el-card>
          <template #header>装备状态</template>
          <div class="equipment-grid">
            <el-card v-for="eq in equipment" :key="eq.id" class="equipment-card" shadow="hover">
              <div class="eq-header">
                <span class="eq-code">{{ eq.instance_code }}</span>
                <el-tag :type="stageTagType(eq.lifecycle_stage || eq.status)" size="small">{{ eq.lifecycle_stage || eq.status }}</el-tag>
              </div>
              <div class="eq-name">{{ eq.instance_name }}</div>
              <el-progress :percentage="eq.progress_pct ?? 0" :color="progressColor(eq.lifecycle_stage || eq.status)" :stroke-width="8" style="margin-top: 8px" />
            </el-card>
            <el-empty v-if="!equipment.length" description="暂无装备数据" />
          </div>
        </el-card>
      </el-col>

      <el-col :span="9">
        <el-card>
          <template #header>
            <div class="card-header">
              <span>工位资源</span>
              <div>
                <el-select v-model="stationTypeFilter" clearable placeholder="工位类型" size="small" style="width: 130px; margin-right: 8px" @change="loadAll">
                  <el-option v-for="t in stationTypes" :key="t.value" :label="t.label" :value="t.value" />
                </el-select>
                <el-button size="small" type="primary" @click="openWorkstationForm()">+ 新建工位</el-button>
              </div>
            </div>
          </template>
          <el-table :data="workstations" size="small" max-height="520" @row-click="openStationDialog">
            <el-table-column prop="code" label="编码" width="82" />
            <el-table-column prop="name" label="名称" min-width="100" />
            <el-table-column label="类型" width="88">
              <template #default="{ row }">
                <el-tag size="small">{{ row.station_type_label || stationTypeLabel(row.station_type) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="能力" min-width="120">
              <template #default="{ row }">
                <el-tag v-for="tag in (row.capability_tags || []).slice(0, 2)" :key="tag" size="small" style="margin: 1px">{{ tag }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="占用" width="105">
              <template #default="{ row }">
                <el-progress :percentage="row.utilization || 0" :stroke-width="6" :color="row.utilization >= 100 ? 'var(--el-color-danger)' : 'var(--el-color-success)'">
                  <span style="font-size: 11px">{{ row.assigned_count ?? 0 }}/{{ row.max_workers }}</span>
                </el-progress>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="80">
              <template #default="{ row }">
                <el-tag :type="stationStatusType(row.status)" size="small">{{ stationStatusLabel(row.status) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="72">
              <template #default="{ row }">
                <el-button size="small" link type="primary" @click.stop="openWorkstationForm(row)">编辑</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>

    <el-dialog v-model="workerDialogVisible" title="人员详情 / 分配工位" width="560px">
      <template v-if="currentWorker">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="姓名">{{ currentWorker.full_name }}</el-descriptions-item>
          <el-descriptions-item label="角色">{{ currentWorker.role_code }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="availabilityType(currentWorker.availability)" size="small">{{ availabilityLabel(currentWorker.availability) }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="当前工位">{{ currentWorker.workstation_name || '-' }}</el-descriptions-item>
          <el-descriptions-item label="技能" :span="2">
            <template v-if="currentWorker.skills && currentWorker.skills.length">
              <el-tag v-for="sk in currentWorker.skills" :key="sk" size="small" style="margin: 2px">{{ sk }}</el-tag>
            </template>
            <span v-else>-</span>
          </el-descriptions-item>
          <el-descriptions-item label="资质">{{ currentWorker.cert_type || '-' }}</el-descriptions-item>
        </el-descriptions>

        <el-divider />
        <el-form label-width="90px" size="small">
          <el-form-item label="分配工位">
            <el-select v-model="assignStationId" placeholder="选择工位" clearable filterable style="width: 100%">
              <el-option
                v-for="ws in workstations"
                :key="ws.id"
                :label="`${ws.code} ${ws.name} · ${ws.station_type_label || stationTypeLabel(ws.station_type)} · 空位${ws.available_slots}`"
                :value="ws.id"
                :disabled="ws.available_slots <= 0"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="可用状态">
            <el-select v-model="assignAvailability" placeholder="选择状态" style="width: 100%">
              <el-option label="空闲" value="idle" />
              <el-option label="在线" value="online" />
              <el-option label="忙碌" value="busy" />
              <el-option label="离线" value="offline" />
              <el-option label="请假" value="leave" />
            </el-select>
          </el-form-item>
        </el-form>
      </template>

      <template #footer>
        <el-button @click="workerDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="assignWorkerStation" :loading="assignLoading">分配工位</el-button>
        <el-button type="warning" @click="releaseWorker" :loading="releaseLoading">释放</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="workstationFormVisible" :title="workstationForm.id ? '编辑工位' : '新建工位'" width="620px">
      <el-form :model="workstationForm" label-width="100px">
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="工位编码" required><el-input v-model="workstationForm.code" :disabled="!!workstationForm.id" placeholder="WS-ASM-01" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="工位名称" required><el-input v-model="workstationForm.name" placeholder="总装工位1" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="工位类型" required>
              <el-select v-model="workstationForm.station_type" style="width: 100%" @change="fillTypeDefaults">
                <el-option v-for="t in stationTypes" :key="t.value" :label="t.label" :value="t.value" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="工位状态">
              <el-select v-model="workstationForm.status" style="width: 100%">
                <el-option label="可用" value="available" />
                <el-option label="占用" value="occupied" />
                <el-option label="维护" value="maintenance" />
                <el-option label="阻塞" value="blocked" />
                <el-option label="停用" value="disabled" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="车间"><el-input v-model="workstationForm.workshop" placeholder="总装/焊接/机加/质检" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="位置"><el-input v-model="workstationForm.location" placeholder="A 区 / 质检区" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="日产能"><el-input-number v-model="workstationForm.capacity_per_day" :min="1" style="width: 100%" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="人数上限"><el-input-number v-model="workstationForm.max_workers" :min="1" style="width: 100%" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="班次">
              <el-select v-model="workstationForm.shift" style="width: 100%">
                <el-option label="白班" value="day" />
                <el-option label="夜班" value="night" />
                <el-option label="双班" value="double" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="状态"><el-switch v-model="workstationForm.is_active" active-text="启用" inactive-text="停用" /></el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="能力标签">
              <el-select v-model="workstationForm.capability_tags" multiple filterable allow-create default-first-option style="width: 100%">
                <el-option v-for="tag in commonTags" :key="tag" :label="tag" :value="tag" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="要求技能">
              <el-select v-model="workstationForm.required_skills" multiple filterable allow-create default-first-option style="width: 100%">
                <el-option v-for="tag in commonTags" :key="tag" :label="tag" :value="tag" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="备注"><el-input v-model="workstationForm.notes" type="textarea" :rows="2" /></el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="workstationFormVisible = false">取消</el-button>
        <el-button type="primary" @click="saveWorkstation" :loading="workstationSaving">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="stationDialogVisible" title="工位详情" width="560px">
      <template v-if="currentStation">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="编码">{{ currentStation.code }}</el-descriptions-item>
          <el-descriptions-item label="名称">{{ currentStation.name }}</el-descriptions-item>
          <el-descriptions-item label="类型">{{ currentStation.station_type_label || stationTypeLabel(currentStation.station_type) }}</el-descriptions-item>
          <el-descriptions-item label="状态">{{ stationStatusLabel(currentStation.status) }}</el-descriptions-item>
          <el-descriptions-item label="车间">{{ currentStation.workshop || '-' }}</el-descriptions-item>
          <el-descriptions-item label="位置">{{ currentStation.location || '-' }}</el-descriptions-item>
          <el-descriptions-item label="人数">{{ currentStation.assigned_count || 0 }} / {{ currentStation.max_workers }}</el-descriptions-item>
          <el-descriptions-item label="设备">{{ currentStation.equipment_count || 0 }} 台</el-descriptions-item>
          <el-descriptions-item label="能力" :span="2">
            <el-tag v-for="tag in currentStation.capability_tags || []" :key="tag" size="small" style="margin: 2px">{{ tag }}</el-tag>
          </el-descriptions-item>
        </el-descriptions>
        <el-divider />
        <div class="section-title">已分配人员</div>
        <template v-if="currentStation.assigned_workers && currentStation.assigned_workers.length">
          <el-tag v-for="w in currentStation.assigned_workers" :key="w.id" style="margin: 2px" size="small">{{ w.full_name || w.name }}</el-tag>
        </template>
        <el-empty v-else description="暂无人员" :image-size="40" />
        <el-divider />
        <div class="section-title">关联设备 / 工单</div>
        <div v-if="currentStation.equipment?.length">
          <el-tag v-for="eq in currentStation.equipment" :key="eq.id" style="margin: 2px" type="info">{{ eq.code }} {{ eq.name }}</el-tag>
        </div>
        <div v-if="currentStation.active_work_orders?.length" style="margin-top: 8px">
          <el-tag v-for="wo in currentStation.active_work_orders" :key="wo.id" style="margin: 2px" type="warning">{{ wo.wo_code }} {{ wo.title }}</el-tag>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { Api } from '../api'

const loading = ref(false)
const overview = reactive<any>({
  workers: { available: 0, total: 0, busy: 0 },
  equipment: { running: 0, total: 0 },
  workstations: { occupied: 0, total: 0, by_type: [] },
  alerts: []
})
const workers = ref<any[]>([])
const equipment = ref<any[]>([])
const workstations = ref<any[]>([])
const stationTypes = ref<any[]>([])
const stationTypeFilter = ref('')
const coreTypes = computed(() => stationTypes.value.filter((t: any) => ['assembly', 'welding', 'machining', 'inspection'].includes(t.value)))
const commonTags = ['assembly', 'welding', 'machining', 'cnc', 'cutting', 'forming', 'qc', 'ndt', 'measurement', 'crane', 'hydraulic', 'electric', 'commissioning', 'warehouse', 'forklift']

const workerDialogVisible = ref(false)
const currentWorker = ref<any>(null)
const assignStationId = ref<number | null>(null)
const assignAvailability = ref('')
const assignLoading = ref(false)
const releaseLoading = ref(false)

const stationDialogVisible = ref(false)
const currentStation = ref<any>(null)
const workstationFormVisible = ref(false)
const workstationSaving = ref(false)
const workstationForm = reactive<any>({
  id: null, code: '', name: '', workshop: '', station_type: 'assembly', status: 'available',
  capability_tags: [], required_skills: [], capacity_per_day: 1, max_workers: 1,
  location: '', shift: 'day', is_active: true, notes: ''
})

function typeCount(type: string) {
  return (overview.workstations?.by_type || []).find((row: any) => row.station_type === type) || { total: 0, available: 0 }
}

function stationTypeLabel(type: string) {
  return stationTypes.value.find((t: any) => t.value === type)?.label || type || '通用工位'
}

async function loadAll() {
  loading.value = true
  try {
    const [types, ov, wk, eq, ws] = await Promise.all([
      Api.get('/resources/workstation-types'),
      Api.get('/resources/overview'),
      Api.get('/resources/workers'),
      Api.get('/resources/equipment'),
      Api.get('/resources/workstations', { params: stationTypeFilter.value ? { station_type: stationTypeFilter.value } : {} })
    ])
    stationTypes.value = types
    Object.assign(overview, ov)
    workers.value = wk.workers || wk || []
    equipment.value = eq.equipment || eq || []
    workstations.value = ws.workstations || ws || []
  } catch (e: any) {
    console.error('Failed to load resource data:', e)
  } finally {
    loading.value = false
  }
}

function availabilityType(val: string) {
  const map: Record<string, string> = { idle: 'success', online: 'success', busy: 'warning', offline: 'info', leave: 'danger' }
  return map[val] || 'info'
}
function availabilityLabel(val: string) {
  const map: Record<string, string> = { idle: '空闲', online: '在线', busy: '忙碌', offline: '离线', leave: '请假' }
  return map[val] || val
}
function stationStatusType(val: string) {
  const map: Record<string, string> = { available: 'success', occupied: 'warning', maintenance: 'info', blocked: 'danger', disabled: 'info' }
  return map[val] || 'info'
}
function stationStatusLabel(val: string) {
  const map: Record<string, string> = { available: '可用', occupied: '占用', maintenance: '维护', blocked: '阻塞', disabled: '停用' }
  return map[val] || val
}
function stageTagType(stage: string) {
  const map: Record<string, string> = { manufacturing: '', assembly: '', commissioning: 'warning', delivered: 'success', operation: 'success', delayed: 'danger' }
  return map[stage] || 'info'
}
function progressColor(stage: string) {
  const map: Record<string, string> = { manufacturing: 'var(--el-color-primary)', assembly: 'var(--el-color-primary)', commissioning: 'var(--el-color-warning)', delivered: 'var(--el-color-success)', delayed: 'var(--el-color-danger)' }
  return map[stage] || 'var(--el-color-primary)'
}

function openWorkerDialog(row: any) {
  currentWorker.value = row
  assignStationId.value = row.workstation_id || null
  assignAvailability.value = row.availability || 'idle'
  workerDialogVisible.value = true
}
async function assignWorkerStation() {
  if (!currentWorker.value) return
  assignLoading.value = true
  try {
    await Api.put('/resources/workers/' + currentWorker.value.id + '/station', { workstation_id: assignStationId.value })
    workerDialogVisible.value = false
    await loadAll()
  } finally {
    assignLoading.value = false
  }
}
async function releaseWorker() {
  if (!currentWorker.value) return
  releaseLoading.value = true
  try {
    await Api.put('/resources/workers/' + currentWorker.value.id + '/release')
    workerDialogVisible.value = false
    await loadAll()
  } finally {
    releaseLoading.value = false
  }
}

function openStationDialog(row: any) {
  currentStation.value = row
  stationDialogVisible.value = true
}

function fillTypeDefaults() {
  const type = stationTypes.value.find((t: any) => t.value === workstationForm.station_type)
  if (type?.default_skills?.length && (!workstationForm.capability_tags || workstationForm.capability_tags.length === 0)) {
    workstationForm.capability_tags = [...type.default_skills]
    workstationForm.required_skills = [...type.default_skills]
  }
}

function openWorkstationForm(row?: any) {
  Object.assign(workstationForm, row ? {
    ...row,
    capability_tags: [...(row.capability_tags || [])],
    required_skills: [...(row.required_skills || [])],
    is_active: row.is_active !== 0
  } : {
    id: null, code: '', name: '', workshop: '', station_type: 'assembly', status: 'available',
    capability_tags: ['assembly'], required_skills: ['assembly'], capacity_per_day: 1, max_workers: 1,
    location: '', shift: 'day', is_active: true, notes: ''
  })
  workstationFormVisible.value = true
}

async function saveWorkstation() {
  if (!workstationForm.code || !workstationForm.name) return
  workstationSaving.value = true
  try {
    const body = {
      code: workstationForm.code,
      name: workstationForm.name,
      workshop: workstationForm.workshop,
      station_type: workstationForm.station_type,
      status: workstationForm.status,
      capability_tags: workstationForm.capability_tags,
      required_skills: workstationForm.required_skills,
      capacity_per_day: workstationForm.capacity_per_day,
      max_workers: workstationForm.max_workers,
      location: workstationForm.location,
      shift: workstationForm.shift,
      is_active: workstationForm.is_active,
      notes: workstationForm.notes
    }
    if (workstationForm.id) await Api.put('/resources/workstations/' + workstationForm.id, body)
    else await Api.post('/resources/workstations', body)
    workstationFormVisible.value = false
    await loadAll()
  } finally {
    workstationSaving.value = false
  }
}

onMounted(loadAll)
</script>

<style scoped>
.page { padding: 16px; }
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.page-title { font-size: 20px; font-weight: 600; }
.page-subtitle { color: var(--el-text-color-secondary); font-size: 13px; margin-top: 4px; }
.card-header { display: flex; align-items: center; justify-content: space-between; }
.stat-card { text-align: center; padding: 8px 0; }
.stat-label, .type-title { font-size: 13px; color: var(--el-color-info); margin-bottom: 6px; }
.stat-value, .type-value { font-size: 28px; font-weight: bold; line-height: 1.3; }
.stat-sub, .type-sub { font-size: 11px; color: var(--el-text-color-placeholder); margin-top: 4px; }
.kpi-card, .type-card { border-top: 3px solid; }
.kpi-green { border-top-color: var(--el-color-success); }
.kpi-orange { border-top-color: var(--el-color-warning); }
.kpi-blue { border-top-color: var(--el-color-primary); }
.kpi-purple { border-top-color: var(--color-purple); }
.type-card { border-top-color: var(--el-color-primary); text-align: center; }
.equipment-grid { display: grid; grid-template-columns: 1fr; gap: 10px; max-height: 520px; overflow-y: auto; }
.equipment-card { cursor: default; }
.eq-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.eq-code { font-weight: 600; font-size: 14px; }
.eq-name { font-size: 12px; color: var(--el-color-info); }
.section-title { font-size: 14px; font-weight: 600; margin-bottom: 8px; }
.text-muted { color: var(--el-text-color-placeholder); }
</style>
