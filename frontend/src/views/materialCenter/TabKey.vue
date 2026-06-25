<template>
  <el-card shadow="never">
    <el-table :data="kc" stripe v-loading="loading" size="small">
      <el-table-column prop="material_code" label="编码" width="140" />
      <el-table-column prop="material_name" label="名称" min-width="200" />
      <el-table-column prop="component_type" label="类型" width="120" />
      <el-table-column prop="supplier" label="供应商" width="120" />
      <el-table-column label="交期(周)" width="100" align="right">
        <template #default="{ row }">
          <el-tag :type="row.lead_time_weeks >= 12 ? 'danger' : (row.lead_time_weeks >= 8 ? 'warning' : 'success')" size="small">
            {{ row.lead_time_weeks }}w
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="风险" width="80">
        <template #default="{ row }">
          <el-tag :type="row.risk_level === 'high' ? 'danger' : (row.risk_level === 'medium' ? 'warning' : 'info')" size="small">
            {{ row.risk_level }}
          </el-tag>
        </template>
      </el-table-column>
    </el-table>
  </el-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import api from '../../api'

defineProps<{ tab: string }>()
const kc = ref<any[]>([])
const loading = ref(false)
const load = async () => { loading.value = true; try { kc.value = await api.keyComponents() } finally { loading.value = false } }
onMounted(load)
</script>