<template>
  <el-card class="process-toolbar" shadow="never">
    <div class="toolbar-main">
      <div class="toolbar-title">
        <strong>树形视图</strong>
        <span>按状态、工位、责任人快速收敛现场任务</span>
      </div>
      <div class="status-legend" aria-label="工艺节点状态图例">
        <el-tag size="small" effect="plain">待开始</el-tag>
        <el-tag type="primary" size="small" effect="plain">可开始</el-tag>
        <el-tag type="success" size="small" effect="plain">已完成</el-tag>
        <el-tag type="danger" size="small" effect="plain">卡住</el-tag>
        <el-tag type="warning" size="small" effect="plain">已暂停</el-tag>
      </div>
    </div>
    <div class="toolbar-controls">
      <el-input aria-label="搜索 操作/物料/备注" v-model="searchKeyLocal" placeholder="搜索操作、物料、备注" clearable size="small" class="search-input" @input="emitChange" />
      <el-select v-model="workstationLocal" placeholder="工位筛选" clearable filterable size="small" class="station-select" @change="emitChange">
        <el-option v-for="w in workstations" :key="w.id" :label="w.name" :value="w.id" />
      </el-select>
      <el-checkbox v-model="onlyCriticalLocal" @change="emitChange">关键路径</el-checkbox>
      <el-checkbox v-model="onlyMineLocal" @change="emitChange" :disabled="!currentUserId">我负责</el-checkbox>
      <el-button size="small" @click="resetFilters">重置</el-button>
      <el-button size="small" type="primary" plain @click="$emit('expand-toggle')">{{ allExpanded ? '折叠全部' : '展开全部' }}</el-button>
    </div>
  </el-card>
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

const resetFilters = () => {
  searchKeyLocal.value = ''
  workstationLocal.value = null
  onlyCriticalLocal.value = false
  onlyMineLocal.value = false
  emitChange()
}
</script>

<style scoped>
.process-toolbar {
  position: sticky;
  top: 12px;
  z-index: 5;
  margin-bottom: var(--space-md);
  border-color: var(--color-border);
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(10px);
}
.toolbar-main,
.toolbar-controls,
.status-legend {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-sm);
}
.toolbar-main {
  justify-content: space-between;
  margin-bottom: var(--space-sm);
}
.toolbar-title {
  display: flex;
  align-items: baseline;
  gap: var(--space-sm);
}
.toolbar-title strong { color: var(--color-text); }
.toolbar-title span {
  color: var(--color-text-secondary);
  font-size: 12px;
}
.toolbar-controls { gap: 10px; }
.search-input { width: 260px; }
.station-select { width: 170px; }
@media (max-width: 760px) {
  .process-toolbar { position: static; }
  .search-input,
  .station-select { width: 100%; }
}
</style>
