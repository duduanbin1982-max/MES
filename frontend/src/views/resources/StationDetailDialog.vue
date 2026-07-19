<template>
  <el-dialog v-model="visible" title="工位详情" width="560px">
    <template v-if="station">
      <el-descriptions :column="2" border size="small">
        <el-descriptions-item label="编码">{{ station.code }}</el-descriptions-item>
        <el-descriptions-item label="名称">{{ station.name }}</el-descriptions-item>
        <el-descriptions-item label="类型">{{ station.station_type_label || stationTypeLabel(station.station_type) }}</el-descriptions-item>
        <el-descriptions-item label="状态">{{ stationStatusLabel(station.status) }}</el-descriptions-item>
        <el-descriptions-item label="车间">{{ station.workshop || '-' }}</el-descriptions-item>
        <el-descriptions-item label="位置">{{ station.location || '-' }}</el-descriptions-item>
        <el-descriptions-item label="人数">{{ station.assigned_count || 0 }} / {{ station.max_workers }}</el-descriptions-item>
        <el-descriptions-item label="设备">{{ station.equipment_count || 0 }} 台</el-descriptions-item>
        <el-descriptions-item label="能力" :span="2">
          <el-tag v-for="tag in station.capability_tags || []" :key="tag" size="small" class="tag-gap">{{ tag }}</el-tag>
        </el-descriptions-item>
      </el-descriptions>
      <el-divider />
      <div class="section-title">已分配人员</div>
      <template v-if="station.assigned_workers && station.assigned_workers.length">
        <el-tag v-for="worker in station.assigned_workers" :key="worker.id" class="tag-gap" size="small">{{ worker.full_name || worker.name }}</el-tag>
      </template>
      <el-empty v-else description="暂无人员" :image-size="40" />
      <el-divider />
      <div class="section-title">关联设备 / 工单</div>
      <div v-if="station.equipment?.length">
        <el-tag v-for="equipment in station.equipment" :key="equipment.id" class="tag-gap" type="info">{{ equipment.code }} {{ equipment.name }}</el-tag>
      </div>
      <div v-if="station.active_work_orders?.length" class="workorder-tags">
        <el-tag v-for="order in station.active_work_orders" :key="order.id" class="tag-gap" type="warning">{{ order.wo_code }} {{ order.title }}</el-tag>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  modelValue: boolean
  station: any
  stationTypes: any[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

function stationTypeLabel(type: string) {
  return props.stationTypes.find((item: any) => item.value === type)?.label || type || '通用工位'
}
function stationStatusLabel(value: string) {
  const map: Record<string, string> = { available: '可用', occupied: '占用', maintenance: '维护', blocked: '阻塞', disabled: '停用' }
  return map[value] || value
}
</script>

<style scoped>
.section-title {
  font-weight: 600;
  margin-bottom: 8px;
}

.tag-gap {
  margin: 2px;
}

.workorder-tags {
  margin-top: 8px;
}
</style>
