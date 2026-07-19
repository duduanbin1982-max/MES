<template>
  <el-row :gutter="16">
    <el-col :span="8">
      <el-card>
        <template #header>人员状态</template>
        <el-table :data="workers" size="small" max-height="520" @row-click="$emit('worker-click', $event)">
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
                <el-tag v-for="skill in row.skills.slice(0, 2)" :key="skill" size="small" class="tag-gap">{{ skill }}</el-tag>
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
          <el-card v-for="item in equipment" :key="item.id" class="equipment-card" shadow="hover">
            <div class="eq-header">
              <span class="eq-code">{{ item.instance_code }}</span>
              <el-tag :type="stageTagType(item.lifecycle_stage || item.status)" size="small">{{ item.lifecycle_stage || item.status }}</el-tag>
            </div>
            <div class="eq-name">{{ item.instance_name }}</div>
            <el-progress :percentage="item.progress_pct ?? 0" :color="progressColor(item.lifecycle_stage || item.status)" :stroke-width="8" class="eq-progress" />
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
              <el-select v-model="stationTypeValue" clearable placeholder="工位类型" size="small" class="station-filter" @change="$emit('load')">
                <el-option v-for="type in stationTypes" :key="type.value" :label="type.label" :value="type.value" />
              </el-select>
              <el-button size="small" type="primary" @click="$emit('workstation-form')">+ 新建工位</el-button>
            </div>
          </div>
        </template>
        <el-table :data="workstations" size="small" max-height="520" @row-click="$emit('station-click', $event)">
          <el-table-column prop="code" label="编码" width="82" />
          <el-table-column prop="name" label="名称" min-width="100" />
          <el-table-column label="类型" width="88">
            <template #default="{ row }">
              <el-tag size="small">{{ row.station_type_label || stationTypeLabel(row.station_type) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="能力" min-width="120">
            <template #default="{ row }">
              <el-tag v-for="tag in (row.capability_tags || []).slice(0, 2)" :key="tag" size="small" class="tag-gap">{{ tag }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="占用" width="105">
            <template #default="{ row }">
              <el-progress :percentage="row.utilization || 0" :stroke-width="6" :color="row.utilization >= 100 ? 'var(--el-color-danger)' : 'var(--el-color-success)'">
                <span class="progress-label">{{ row.assigned_count ?? 0 }}/{{ row.max_workers }}</span>
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
              <el-button size="small" link type="primary" @click.stop="$emit('workstation-form', row)">编辑</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </el-col>
  </el-row>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  workers: any[]
  equipment: any[]
  workstations: any[]
  stationTypes: any[]
  stationTypeFilter: string
}>()

const emit = defineEmits<{
  'update:stationTypeFilter': [value: string]
  load: []
  'worker-click': [row: any]
  'station-click': [row: any]
  'workstation-form': [row?: any]
}>()

const stationTypeValue = computed({
  get: () => props.stationTypeFilter,
  set: (value: string) => emit('update:stationTypeFilter', value),
})

function stationTypeLabel(type: string) {
  return props.stationTypes.find((item: any) => item.value === type)?.label || type || '通用工位'
}
function availabilityType(value: string) {
  const map: Record<string, string> = { idle: 'success', online: 'success', busy: 'warning', offline: 'info', leave: 'danger' }
  return map[value] || 'info'
}
function availabilityLabel(value: string) {
  const map: Record<string, string> = { idle: '空闲', online: '在线', busy: '忙碌', offline: '离线', leave: '请假' }
  return map[value] || value
}
function stationStatusType(value: string) {
  const map: Record<string, string> = { available: 'success', occupied: 'warning', maintenance: 'info', blocked: 'danger', disabled: 'info' }
  return map[value] || 'info'
}
function stationStatusLabel(value: string) {
  const map: Record<string, string> = { available: '可用', occupied: '占用', maintenance: '维护', blocked: '阻塞', disabled: '停用' }
  return map[value] || value
}
function stageTagType(stage: string) {
  const map: Record<string, string> = { manufacturing: '', assembly: '', commissioning: 'warning', delivered: 'success', operation: 'success', delayed: 'danger' }
  return map[stage] || 'info'
}
function progressColor(stage: string) {
  const map: Record<string, string> = { manufacturing: 'var(--el-color-primary)', assembly: 'var(--el-color-primary)', commissioning: 'var(--el-color-warning)', delivered: 'var(--el-color-success)', delayed: 'var(--el-color-danger)' }
  return map[stage] || 'var(--el-color-primary)'
}
</script>

<style scoped>
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.equipment-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
  max-height: 520px;
  overflow-y: auto;
}

.equipment-card {
  cursor: default;
}

.eq-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.eq-code {
  font-weight: 600;
  font-size: 14px;
}

.eq-name {
  font-size: 12px;
  color: var(--el-color-info);
}

.eq-progress {
  margin-top: 8px;
}

.tag-gap {
  margin: 1px;
}

.station-filter {
  width: 130px;
  margin-right: 8px;
}

.progress-label {
  font-size: 11px;
}

.text-muted {
  color: var(--el-text-color-placeholder);
}
</style>
