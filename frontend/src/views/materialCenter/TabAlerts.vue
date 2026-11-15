<template>
  <el-card shadow="never">
    <div class="alerts-toolbar">
      <div>
        <el-tag type="danger" size="small">P1 关键/A类</el-tag>
        <el-tag type="warning" size="small" style="margin-left:6px">P2 关键或A类</el-tag>
        <el-tag type="info" size="small" style="margin-left:6px">P3 其他</el-tag>
      </div>
      <el-button size="small" @click="load">刷新</el-button>
    </div>
    <el-table :data="items" stripe v-loading="loading" size="small" max-height="560">
      <el-table-column label="优先级" width="90">
        <template #default="{ row }"><el-tag :type="priorityTag(row.priority)" size="small">{{ row.priority }}</el-tag></template>
      </el-table-column>
      <el-table-column prop="material_code" label="物料编码" width="150" />
      <el-table-column prop="material_name" label="物料名称" min-width="180" />
      <el-table-column label="关键性" width="80"><template #default="{ row }">{{ criticalityLabel(row.criticality) }}</template></el-table-column>
      <el-table-column prop="abc_class" label="ABC" width="60" />
      <el-table-column prop="available_qty" label="当前可用" width="90" align="right" />
      <el-table-column prop="threshold" label="补货线" width="90" align="right" />
      <el-table-column prop="shortage_qty" label="缺口" width="90" align="right" />
      <el-table-column label="预警级别" width="90">
        <template #default="{ row }"><el-tag :type="row.severity === 'critical' ? 'danger' : row.severity === 'high' ? 'warning' : 'info'" size="small">{{ severityLabel(row.severity) }}</el-tag></template>
      </el-table-column>
    </el-table>
    <div v-if="!loading && !items.length" class="alerts-empty">暂无低于补货线的常备物料</div>
  </el-card>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import api from '../../api'

const items = ref<any[]>([])
const loading = ref(false)
const priorityTag = (value: string) => value === 'P1' ? 'danger' : value === 'P2' ? 'warning' : 'info'
const criticalityLabel = (value: string) => ({ normal: '普通', important: '重要', critical: '关键' } as any)[value] || value || '-'
const severityLabel = (value: string) => ({ critical: '紧急', high: '高', warning: '警告' } as any)[value] || value || '-'
const load = async () => {
  loading.value = true
  try { const result: any = await api.get('/inventory/alerts'); items.value = result.items || [] } catch { items.value = [] } finally { loading.value = false }
}
onMounted(load)
</script>

<style scoped>
.alerts-toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.alerts-empty { padding: 24px; text-align: center; color: var(--el-text-color-secondary); }
</style>
