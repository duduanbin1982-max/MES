<template>
  <span style="display: flex; align-items: center; gap: 6px; width: 100%" :class="{ 'node-row': true, 'is-critical': data.is_critical }">
    <el-tag v-if="data.is_critical" type="danger" size="small" effect="dark">⭐</el-tag>
    <el-tag :type="statusTagType(effectiveStatus)" size="small" effect="dark" style="min-width: 50px; text-align: center">
      {{ statusLabel(effectiveStatus) }}
    </el-tag>
    <span v-if="data.material_name" style="flex: 1; font-weight: 500">{{ data.material_name }}</span>
    <span v-else style="flex: 1; font-weight: 500">{{ data.notes || data.operation_name }}</span>
    <span style="color: #909399; font-size: 12px">{{ data.operation_name }}</span>
    <span v-if="data.bom_is_key" style="color: #f56c6c; font-size: 12px">⭐</span>
    <span style="color: #909399; font-size: 12px">qty={{ data.bom_quantity || 1 }}</span>
    <span style="color: #909399; font-size: 12px">{{ data.estimated_hours || 0 }}h</span>
    <span v-if="data.assigned_to" style="color: #67c23a; font-size: 12px">👷#{{ data.assigned_to }}</span>
    <el-button v-if="effectiveStatus === 'ready'" size="small" type="primary" @click.stop="$emit('start', data)">开始</el-button>
    <el-button v-else-if="effectiveStatus === 'in_progress'" size="small" type="success" @click.stop="$emit('complete', data)">完成</el-button>
    <el-dropdown @command="(c) => $emit('cmd', c, data)" trigger="click">
      <el-button size="small" text @click.stop>⋯</el-button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item command="edit">✏️ 编辑</el-dropdown-item>
          <el-dropdown-item command="assign">👷 分配</el-dropdown-item>
          <el-dropdown-item command="addchild">➕ 加子节点</el-dropdown-item>
          <el-dropdown-item command="adddep">🔗 加依赖</el-dropdown-item>
          <el-dropdown-item command="delete" divided><span style="color: #f56c6c">🗑 删除</span></el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </span>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  data: { type: Object, required: true },
  node: Object
})
defineEmits(['start', 'complete', 'cmd'])

// 派生状态：blocked 用 derived，否则用 db 状态
const effectiveStatus = computed(() => props.data.derived_status || props.data.status || 'pending')

const statusLabel = (s) => ({ pending: '待开始', ready: '可开始', in_progress: '进行中', completed: '已完成', blocked: '卡住', paused: '已暂停', skipped: '跳过' }[s] || s)
const statusTagType = (s) => ({ pending: 'info', ready: 'primary', in_progress: 'success', completed: 'success', blocked: 'danger', paused: 'warning', skipped: 'info' }[s] || 'info')
</script>

<style scoped>
.node-row.is-critical { background: #fef0f0; }
</style>
