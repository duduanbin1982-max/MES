<template>
  <el-dialog v-model="visible" title="人员详情 / 分配工位" width="560px">
    <template v-if="worker">
      <el-descriptions :column="2" border size="small">
        <el-descriptions-item label="姓名">{{ worker.full_name }}</el-descriptions-item>
        <el-descriptions-item label="角色">{{ worker.role_code }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="availabilityType(worker.availability)" size="small">{{ availabilityLabel(worker.availability) }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="当前工位">{{ worker.workstation_name || '-' }}</el-descriptions-item>
        <el-descriptions-item label="技能" :span="2">
          <template v-if="worker.skills && worker.skills.length">
            <el-tag v-for="skill in worker.skills" :key="skill" size="small" class="tag-gap">{{ skill }}</el-tag>
          </template>
          <span v-else>-</span>
        </el-descriptions-item>
        <el-descriptions-item label="资质">{{ worker.cert_type || '-' }}</el-descriptions-item>
      </el-descriptions>

      <el-divider />
      <el-form label-width="90px" size="small">
        <el-form-item label="分配工位">
          <el-select v-model="stationIdValue" placeholder="选择工位" clearable filterable style="width: 100%">
            <el-option
              v-for="station in workstations"
              :key="station.id"
              :label="`${station.code} ${station.name} · ${station.station_type_label || stationTypeLabel(station.station_type)} · 空位${station.available_slots}`"
              :value="station.id"
              :disabled="station.available_slots <= 0"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="可用状态">
          <el-select v-model="availabilityValue" placeholder="选择状态" style="width: 100%">
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
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="$emit('assign')" :loading="assignLoading">分配工位</el-button>
      <el-button type="warning" @click="$emit('release')" :loading="releaseLoading">释放</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  modelValue: boolean
  worker: any
  workstations: any[]
  stationTypes: any[]
  assignStationId: number | null
  assignAvailability: string
  assignLoading: boolean
  releaseLoading: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'update:assignStationId': [value: number | null]
  'update:assignAvailability': [value: string]
  assign: []
  release: []
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const stationIdValue = computed({
  get: () => props.assignStationId,
  set: (value: number | null) => emit('update:assignStationId', value),
})

const availabilityValue = computed({
  get: () => props.assignAvailability,
  set: (value: string) => emit('update:assignAvailability', value),
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
</script>

<style scoped>
.tag-gap {
  margin: 2px;
}
</style>
