<template>
  <div style="margin-bottom: 12px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap">
    <span style="font-weight: 500">树形视图 (颜色编码状态)</span>
    <el-tag size="small">待开始</el-tag>
    <el-tag type="primary" size="small">可开始</el-tag>
    <el-tag type="success" size="small">已完成</el-tag>
    <el-tag type="danger" size="small">卡住</el-tag>
    <el-tag type="warning" size="small">已暂停</el-tag>

    <el-divider direction="vertical" />

    <el-input v-model="searchKeyLocal" placeholder="搜索 操作/物料/备注" clearable size="small" style="width: 220px" @input="emitChange" />

    <el-select v-model="workstationLocal" placeholder="工位筛选" clearable size="small" style="width: 140px" @change="emitChange">
      <el-option v-for="w in workstations" :key="w.id" :label="w.name" :value="w.id" />
    </el-select>

    <el-checkbox v-model="onlyCriticalLocal" @change="emitChange">只看关键路径</el-checkbox>
    <el-checkbox v-model="onlyMineLocal" @change="emitChange">只看我负责</el-checkbox>

    <el-button size="small" @click="$emit('expand-toggle')">{{ allExpanded ? '折叠全部' : '展开全部' }}</el-button>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  searchKey: String,
  workstationId: { type: [Number, null], default: null },
  onlyCritical: Boolean,
  onlyMine: Boolean,
  allExpanded: Boolean,
  workstations: { type: Array, default: () => [] },
  currentUserId: { type: [Number, null], default: null }
})
const emit = defineEmits(['update:searchKey', 'update:workstationId', 'update:onlyCritical', 'update:onlyMine', 'expand-toggle', 'change'])

const searchKeyLocal = ref(props.searchKey || '')
const workstationLocal = ref(props.workstationId)
const onlyCriticalLocal = ref(props.onlyCritical)
const onlyMineLocal = ref(props.onlyMine)

watch(() => props.searchKey, v => searchKeyLocal.value = v || '')
watch(() => props.workstationId, v => workstationLocal.value = v)
watch(() => props.onlyCritical, v => onlyCriticalLocal.value = v)
watch(() => props.onlyMine, v => onlyMineLocal.value = v)

const emitChange = () => {
  emit('update:searchKey', searchKeyLocal.value)
  emit('update:workstationId', workstationLocal.value)
  emit('update:onlyCritical', onlyCriticalLocal.value)
  emit('update:onlyMine', onlyMineLocal.value)
  emit('change')
}
</script>
