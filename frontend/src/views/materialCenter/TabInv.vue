<template>
  <div style="margin-bottom: 12px; display: flex; gap: 8px; align-items: center">
    <el-input v-model="filter" placeholder="搜索物料/批次/位置" size="small" style="width: 300px" clearable />
    <el-button type="success" size="small" @click="emit('open-receive')"><el-icon><Download /></el-icon> 一键入库</el-button>
    <el-button v-if="auth.hasPerm('material:admin')" type="warning" size="small" @click="emit('open-allocate')"><el-icon><Refresh /></el-icon> 调拨/预留</el-button>
    <el-button v-if="auth.hasPerm('material:admin')" type="info" size="small" @click="emit('open-release')"><el-icon><Unlock /></el-icon> 释放预留</el-button>
    <el-button v-if="auth.hasPerm('material:write')" type="primary" size="small" @click="emit('open-batch')"><el-icon><Lightning /></el-icon> 批量入库</el-button>
  </div>
  <el-card shadow="never">
    <el-table :data="filtered" stripe size="small">
      <el-table-column prop="material_code" label="编码" width="140" />
      <el-table-column prop="material_name" label="名称" min-width="180" />
      <el-table-column prop="lot_no" label="批次" width="140" />
      <el-table-column prop="location" label="库位" width="140" />
      <el-table-column prop="quantity" label="数量" width="80" align="right" />
      <el-table-column prop="unit" label="单位" width="60" />
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.status === 'available' ? 'success' : (row.status === 'allocated' ? 'warning' : 'info')" size="small">{{ row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="220" fixed="right">
        <template #default="{ row }">
          <el-button size="small" link type="primary" @click="emit('open-detail', row)">详情</el-button>
          <el-button v-if="auth.hasPerm('material:write')" size="small" link type="warning" @click="emit('open-split', row)" :disabled="!row.quantity || row.quantity <= 0">拆批</el-button>
          <el-button v-if="auth.hasPerm('material:write')" size="small" link type="success" @click="emit('open-merge', row)">合批</el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAuthStore } from '../../stores/auth'

const props = defineProps<{ inv: any[] }>()
const emit = defineEmits<{
  (e: 'open-receive'): void
  (e: 'open-allocate'): void
  (e: 'open-release'): void
  (e: 'open-batch'): void
  (e: 'open-detail', row: any): void
  (e: 'open-split', row: any): void
  (e: 'open-merge', row: any): void
}>()

const auth = useAuthStore()
const filter = ref('')
const filtered = computed(() => {
  if (!filter.value) return props.inv
  const f = filter.value.toLowerCase()
  return props.inv.filter((i: any) =>
    (i.material_name || '').toLowerCase().includes(f) ||
    (i.lot_no || '').toLowerCase().includes(f) ||
    (i.location || '').toLowerCase().includes(f)
  )
})
</script>