<template>
  <div class="page">
    <PageToolbar
      title="资源看板"
      subtitle="人员、设备、工位能力与占用状态统一管理。"
      aria-label="资源看板工具栏"
    >
      <template #icon>
        <el-icon><OfficeBuilding /></el-icon>
      </template>
      <template #actions>
        <el-button :icon="Refresh" :loading="loading" @click="loadAll">刷新</el-button>
      </template>
    </PageToolbar>

    <el-alert
      v-for="alert in overview.alerts || []"
      :key="alert.message"
      :title="alert.message"
      :type="alert.type"
      show-icon
      style="margin-bottom: 8px"
    />

    <PageState
      v-if="loadError"
      state="error"
      title="资源看板加载失败"
      :description="loadError"
      action-text="重新加载"
      @retry="loadAll"
    />
    <PageState
      v-else-if="loading && !hasResourceData"
      state="loading"
      title="正在加载资源状态"
      description="正在获取人员、设备、工位和资源告警。"
    />
    <PageState
      v-else-if="!loading && !hasResourceData"
      state="empty"
      title="暂无资源数据"
      description="请先维护人员、设备实例或工位资源，然后刷新资源看板。"
      action-text="刷新"
      @retry="loadAll"
    />
    <template v-else>
    <ResourceSummaryGrid :overview="overview" :core-types="coreTypes" />
    <ResourceMainPanels
      v-model:station-type-filter="stationTypeFilter"
      :workers="workers"
      :equipment="equipment"
      :workstations="workstations"
      :station-types="stationTypes"
      @load="loadAll"
      @worker-click="openWorkerDialog"
      @station-click="openStationDialog"
      @workstation-form="openWorkstationForm"
    />
    </template>

    <WorkerAssignmentDialog
      v-model="workerDialogVisible"
      v-model:assign-station-id="assignStationId"
      v-model:assign-availability="assignAvailability"
      :worker="currentWorker"
      :workstations="workstations"
      :station-types="stationTypes"
      :assign-loading="assignLoading"
      :release-loading="releaseLoading"
      @assign="assignWorkerStation"
      @release="releaseWorker"
    />

    <WorkstationFormDialog
      v-model="workstationFormVisible"
      v-model:form="workstationForm"
      :station-types="stationTypes"
      :common-tags="commonTags"
      :saving="workstationSaving"
      @fill-defaults="fillTypeDefaults"
      @save="saveWorkstation"
    />

    <StationDetailDialog
      v-model="stationDialogVisible"
      :station="currentStation"
      :station-types="stationTypes"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { OfficeBuilding, Refresh } from '@element-plus/icons-vue'
import { Api } from '../api'
import PageState from '../components/PageState.vue'
import PageToolbar from '../components/PageToolbar.vue'
import ResourceMainPanels from './resources/ResourceMainPanels.vue'
import ResourceSummaryGrid from './resources/ResourceSummaryGrid.vue'
import StationDetailDialog from './resources/StationDetailDialog.vue'
import WorkerAssignmentDialog from './resources/WorkerAssignmentDialog.vue'
import WorkstationFormDialog from './resources/WorkstationFormDialog.vue'

const loading = ref(false)
const loadError = ref('')
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
const hasResourceData = computed(() => workers.value.length > 0 || equipment.value.length > 0 || workstations.value.length > 0)
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

async function loadAll() {
  loading.value = true
  loadError.value = ''
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
    loadError.value = e?.message || '资源接口暂时不可用，请稍后重试。'
  } finally {
    loading.value = false
  }
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
.page {
  padding: 16px;
}
</style>
