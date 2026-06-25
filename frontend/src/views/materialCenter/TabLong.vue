<template>
  <el-card shadow="never">
    <el-alert type="warning" :closable="false" style="margin-bottom: 16px">
      以下物料交期 ≥12 周，请提前下单，避免影响项目进度。
    </el-alert>
    <el-table :data="rows" stripe v-loading="loading" size="small">
      <el-table-column prop="material_name" label="物料" min-width="200" />
      <el-table-column prop="component_type" label="类型" width="120" />
      <el-table-column prop="supplier" label="供应商" width="120" />
      <el-table-column label="交期" width="100">
        <template #default="{ row }">
          <el-tag type="danger" size="small">{{ row.lead_time_weeks }} 周</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="risk_level" label="风险" width="100" />
    </el-table>
  </el-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import api from '../../api'

defineProps<{ tab: string }>()
const rows = ref<any[]>([])
const loading = ref(false)
const load = async () => { loading.value = true; try { rows.value = await api.longLeadtime() } finally { loading.value = false } }
onMounted(load)
</script>