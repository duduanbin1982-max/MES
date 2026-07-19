<template>
  <div class="page">
    <PageToolbar
      title="工位/资源配置"
      subtitle="维护装配、焊接、机加、检验等工位能力、容量、技能要求和占用状态。"
      aria-label="工位资源配置工具栏"
    >
      <template #icon>
        <el-icon><OfficeBuilding /></el-icon>
      </template>
      <template #actions>
        <el-input v-model="keyword" clearable placeholder="搜索工位编码/名称/车间" class="toolbar-search" :prefix-icon="Search" />
        <el-select v-model="stationTypeFilter" clearable placeholder="工位类型" class="toolbar-select" @change="loadWorkstations">
          <el-option v-for="type in stationTypes" :key="type.value" :label="type.label" :value="type.value" />
        </el-select>
        <el-select v-model="statusFilter" clearable placeholder="状态" class="toolbar-select" @change="loadWorkstations">
          <el-option label="可用" value="available" />
          <el-option label="占用" value="occupied" />
          <el-option label="维护" value="maintenance" />
          <el-option label="阻塞" value="blocked" />
          <el-option label="停用" value="disabled" />
        </el-select>
        <el-button type="primary" @click="openWorkstationForm()">新建工位</el-button>
        <el-button :icon="Refresh" :loading="loading" @click="loadAll">刷新</el-button>
      </template>
    </PageToolbar>

    <el-alert
      v-for="alert in overview.alerts || []"
      :key="alert.message"
      :title="alert.message"
      :type="alert.type"
      show-icon
      class="resource-alert"
    />

    <PageState
      v-if="loadError"
      state="error"
      title="工位资源加载失败"
      :description="loadError"
      action-text="重新加载"
      @retry="loadAll"
    />
    <PageState
      v-else-if="loading && !workstations.length"
      state="loading"
      title="正在加载工位资源"
      description="正在获取工位、人员占用和能力标签。"
    />
    <PageState
      v-else-if="!loading && !workstations.length"
      state="empty"
      title="暂无工位资源"
      description="请先创建装配、焊接、机加或检验工位。"
      action-text="新建工位"
      @retry="openWorkstationForm"
    />
    <template v-else>
      <ResourceSummaryGrid :overview="overview" :core-types="coreTypes" />

      <el-card>
        <template #header>
          <div class="card-header">
            <span>工位资源清单</span>
            <span class="header-hint">共 {{ filteredWorkstations.length }} 个工位</span>
          </div>
        </template>
        <el-table :data="filteredWorkstations" stripe @row-click="openStationDialog">
          <el-table-column prop="code" label="工位编码" width="120" />
          <el-table-column prop="name" label="工位名称" min-width="150" />
          <el-table-column prop="workshop" label="车间" min-width="120">
            <template #default="{ row }">{{ row.workshop || '-' }}</template>
          </el-table-column>
          <el-table-column label="类型" width="120">
            <template #default="{ row }">
              <el-tag size="small">{{ row.station_type_label || stationTypeLabel(row.station_type) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="stationStatusType(row.status)" size="small">{{ stationStatusLabel(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="人员占用" min-width="150">
            <template #default="{ row }">
              <el-progress :percentage="row.utilization || 0" :stroke-width="8">
                <span class="progress-label">{{ row.assigned_count ?? 0 }}/{{ row.max_workers }}</span>
              </el-progress>
            </template>
          </el-table-column>
          <el-table-column label="能力标签" min-width="180">
            <template #default="{ row }">
              <el-tag v-for="tag in (row.capability_tags || []).slice(0, 4)" :key="tag" size="small" class="tag-gap">{{ tag }}</el-tag>
              <span v-if="!(row.capability_tags || []).length" class="text-muted">-</span>
            </template>
          </el-table-column>
          <el-table-column label="要求技能" min-width="180">
            <template #default="{ row }">
              <el-tag v-for="tag in (row.required_skills || []).slice(0, 4)" :key="tag" size="small" type="info" class="tag-gap">{{ tag }}</el-tag>
              <span v-if="!(row.required_skills || []).length" class="text-muted">-</span>
            </template>
          </el-table-column>
          <el-table-column prop="location" label="位置" min-width="120">
            <template #default="{ row }">{{ row.location || '-' }}</template>
          </el-table-column>
          <el-table-column label="操作" width="130" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click.stop="openWorkstationForm(row)">编辑</el-button>
              <el-button link @click.stop="openStationDialog(row)">详情</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </template>

    <WorkstationFormDialog
      v-model="workstationFormVisible"
      :form="workstationForm"
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
import { computed, onMounted, reactive, ref } from 'vue'
import { OfficeBuilding, Refresh, Search } from '@element-plus/icons-vue'
import { Api } from '../api'
import PageState from '../components/PageState.vue'
import PageToolbar from '../components/PageToolbar.vue'
import ResourceSummaryGrid from './resources/ResourceSummaryGrid.vue'
import StationDetailDialog from './resources/StationDetailDialog.vue'
import WorkstationFormDialog from './resources/WorkstationFormDialog.vue'

const loading = ref(false)
const loadError = ref('')
const keyword = ref('')
const stationTypeFilter = ref('')
const statusFilter = ref('')
const stationTypes = ref<any[]>([])
const workstations = ref<any[]>([])
const overview = reactive<any>({
  workers: { available: 0, total: 0, busy: 0 },
  equipment: { running: 0, total: 0 },
  workstations: { occupied: 0, total: 0, by_type: [] },
  alerts: []
})
const coreTypes = computed(() => stationTypes.value.filter((type: any) => ['assembly', 'welding', 'machining', 'inspection'].includes(type.value)))
const commonTags = ['assembly', 'welding', 'machining', 'cnc', 'cutting', 'forming', 'qc', 'ndt', 'measurement', 'crane', 'hydraulic', 'electric', 'commissioning', 'warehouse', 'forklift']

const stationDialogVisible = ref(false)
const currentStation = ref<any>(null)
const workstationFormVisible = ref(false)
const workstationSaving = ref(false)
const workstationForm = reactive<any>({
  id: null, code: '', name: '', workshop: '', station_type: 'assembly', status: 'available',
  capability_tags: [], required_skills: [], capacity_per_day: 1, max_workers: 1,
  location: '', shift: 'day', is_active: true, notes: ''
})

const filteredWorkstations = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  if (!text) return workstations.value
  return workstations.value.filter((item) => [item.code, item.name, item.workshop, item.location]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(text)))
})

async function loadAll() {
  loading.value = true
  loadError.value = ''
  try {
    const [types, ov] = await Promise.all([
      Api.get('/resources/workstation-types'),
      Api.get('/resources/overview'),
    ])
    stationTypes.value = types
    Object.assign(overview, ov)
    await loadWorkstations(false)
  } catch (error: any) {
    console.error('Failed to load workstation resources:', error)
    loadError.value = error?.message || '工位资源接口暂时不可用，请稍后重试。'
  } finally {
    loading.value = false
  }
}

async function loadWorkstations(toggleLoading = true) {
  if (toggleLoading) loading.value = true
  loadError.value = ''
  try {
    const params: any = {}
    if (stationTypeFilter.value) params.station_type = stationTypeFilter.value
    if (statusFilter.value) params.status = statusFilter.value
    const data = await Api.get('/resources/workstations', { params })
    workstations.value = data.workstations || data || []
  } catch (error: any) {
    console.error('Failed to load workstations:', error)
    loadError.value = error?.message || '工位资源接口暂时不可用，请稍后重试。'
  } finally {
    if (toggleLoading) loading.value = false
  }
}

function openStationDialog(row: any) {
  currentStation.value = row
  stationDialogVisible.value = true
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

function fillTypeDefaults() {
  const type = stationTypes.value.find((item: any) => item.value === workstationForm.station_type)
  if (type?.default_skills?.length && (!workstationForm.capability_tags || workstationForm.capability_tags.length === 0)) {
    workstationForm.capability_tags = [...type.default_skills]
    workstationForm.required_skills = [...type.default_skills]
  }
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

function stationTypeLabel(type: string) {
  return stationTypes.value.find((item: any) => item.value === type)?.label || type || '通用工位'
}

function stationStatusType(value: string) {
  const map: Record<string, string> = { available: 'success', occupied: 'warning', maintenance: 'info', blocked: 'danger', disabled: 'info' }
  return map[value] || 'info'
}

function stationStatusLabel(value: string) {
  const map: Record<string, string> = { available: '可用', occupied: '占用', maintenance: '维护', blocked: '阻塞', disabled: '停用' }
  return map[value] || value
}

onMounted(loadAll)
</script>

<style scoped>
.page {
  padding: 16px;
}

.toolbar-search {
  width: 240px;
}

.toolbar-select {
  width: 132px;
}

.resource-alert {
  margin-bottom: 8px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.header-hint,
.text-muted {
  color: var(--el-text-color-placeholder);
}

.tag-gap {
  margin: 2px;
}

.progress-label {
  font-size: 12px;
}
</style>
