<template>
  <el-dialog v-model="dlgCompareModel" title="ECO 版本对比" width="600px">
    <el-form label-width="80px" size="small">
      <el-form-item label="旧版本"><el-input v-model="compareV1Model" /></el-form-item>
      <el-form-item label="新版本"><el-input v-model="compareV2Model" /></el-form-item>
      <el-button type="primary" @click="emit('compare')" :loading="comparing">对比</el-button>
    </el-form>
    <el-row :gutter="12" v-if="compareResult" style="margin-top: 16px">
      <el-col :span="8"><el-statistic title="新增" :value="compareResult.added.length" :value-style="{ color: 'var(--el-color-success)' }" /></el-col>
      <el-col :span="8"><el-statistic title="删除" :value="compareResult.removed.length" :value-style="{ color: 'var(--el-color-danger)' }" /></el-col>
      <el-col :span="8"><el-statistic title="修改" :value="compareResult.changed.length" :value-style="{ color: 'var(--el-color-warning)' }" /></el-col>
    </el-row>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  dlgCompare: boolean
  compareV1: string
  compareV2: string
  comparing: boolean
  compareResult: any
}>()

const emit = defineEmits<{
  (event: 'update:dlgCompare', value: boolean): void
  (event: 'update:compareV1', value: string): void
  (event: 'update:compareV2', value: string): void
  (event: 'compare'): void
}>()

const dlgCompareModel = computed({ get: () => props.dlgCompare, set: (value: boolean) => emit('update:dlgCompare', value) })
const compareV1Model = computed({ get: () => props.compareV1, set: (value: string) => emit('update:compareV1', value) })
const compareV2Model = computed({ get: () => props.compareV2, set: (value: string) => emit('update:compareV2', value) })
</script>
