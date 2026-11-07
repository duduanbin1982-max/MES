<template>
  <el-dialog v-model="visible" :title="`ITP 检验点 · ${node?.operation_name || ''}`" width="640px">
    <div class="itp-head">
      <el-tag size="small" type="info">节点 #{{ node?.id }}</el-tag>
      <el-tag v-if="node?.qc_required" size="small" type="danger">QC 必检</el-tag>
      <el-button size="small" type="primary" :loading="loading" @click="seed">生成检验点</el-button>
    </div>
    <el-alert v-if="!points.length" type="info" :closable="false" show-icon title="暂无检验点；QC 工序开工时会自动生成，也可手动生成。" />
    <el-table v-else :data="points" size="small">
      <el-table-column prop="point_no" label="#" width="50" />
      <el-table-column prop="point_type" label="类型" width="80">
        <template #default="{ row }"><el-tag size="small" :type="row.point_type === 'hold' ? 'danger' : 'info'">{{ row.point_type }}</el-tag></template>
      </el-table-column>
      <el-table-column prop="requirement" label="检验要求" min-width="220" />
      <el-table-column prop="status" label="状态" width="90">
        <template #default="{ row }">
          <el-tag size="small" :type="row.status === 'passed' ? 'success' : row.status === 'failed' ? 'danger' : row.status === 'waived' ? 'info' : 'warning'">{{ row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="150">
        <template #default="{ row }">
          <el-button size="small" link type="success" :disabled="row.status === 'passed'" @click="check(row, 'passed')">通过</el-button>
          <el-button size="small" link type="danger" :disabled="row.status === 'failed'" @click="check(row, 'failed')">不通过</el-button>
        </template>
      </el-table-column>
    </el-table>
    <template #footer><el-button @click="visible = false">关闭</el-button></template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { processItpApi } from '../services/processRouteUpgradeApi'

const props = defineProps<{ modelValue: boolean; node: any | null }>()
const emit = defineEmits<{ (event: 'update:modelValue', value: boolean): void; (event: 'changed'): void }>()
const visible = computed({ get: () => props.modelValue, set: (value: boolean) => emit('update:modelValue', value) })
const loading = ref(false)
const points = ref<any[]>([])

async function load() {
  if (!props.node?.id) return
  loading.value = true
  try {
    const data = await processItpApi.get(props.node.id)
    points.value = data.points || []
  } catch (error: any) {
    ElMessage.error('加载检验点失败：' + (error?.message || error))
  } finally {
    loading.value = false
  }
}

async function seed() {
  loading.value = true
  try {
    const data = await processItpApi.seed(props.node.id)
    points.value = data.points || []
    ElMessage.success('已生成 ITP 检验点')
    emit('changed')
  } catch (error: any) {
    ElMessage.error('生成失败：' + (error?.message || error))
  } finally {
    loading.value = false
  }
}

async function check(row: any, status: string) {
  try {
    await processItpApi.check(row.id, status, '')
    ElMessage.success(status === 'passed' ? '已通过' : '已标记不通过')
    await load()
    emit('changed')
  } catch (error: any) {
    ElMessage.error('检验点更新失败：' + (error?.message || error))
  }
}

watch(() => [props.modelValue, props.node?.id], ([open]) => { if (open) load() }, { immediate: true })
</script>

<style scoped>
.itp-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
</style>
