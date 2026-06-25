<template>
  <el-card shadow="never">
    <el-table :data="mats" stripe v-loading="loading" size="small">
      <el-table-column prop="material_code" label="编码" width="140" />
      <el-table-column prop="material_name" label="名称" min-width="200" />
      <el-table-column prop="material_type" label="类型" width="100" />
      <el-table-column prop="spec" label="规格" width="150" />
      <el-table-column prop="unit" label="单位" width="60" />
      <el-table-column label="自制" width="70">
        <template #default="{ row }">
          <el-tag v-if="row.is_self_made" type="success" size="small">自制</el-tag>
          <el-tag v-else size="small">外购</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="关键件" width="80">
        <template #default="{ row }">
          <el-tag v-if="row.is_key_component" type="danger" size="small">⭐ 关键</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="default_supplier" label="默认供应商" width="140" />
    </el-table>
  </el-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import api from '../../api'

defineProps<{ tab: string }>()
const mats = ref<any[]>([])
const loading = ref(false)
const load = async () => { loading.value = true; try { mats.value = await api.materials() } finally { loading.value = false } }
onMounted(load)
</script>