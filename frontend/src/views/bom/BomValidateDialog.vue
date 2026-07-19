<template>
  <el-dialog v-model="dlgValidateModel" title="校验结果" width="700px">
    <el-alert v-if="validateResult?.ok" type="success" :closable="false"><el-icon><CircleCheck /></el-icon> 校验通过 ({{ validateResult?.total || 0 }} 节点)</el-alert>
    <el-alert v-else type="error" :closable="false">{{ (validateResult?.errors || []).length }} 项错误</el-alert>
    <el-row :gutter="12" style="margin-top: 12px">
      <el-col :span="8"><el-statistic title="健康度" :value="validateResult?.health?.score || 0" /></el-col>
      <el-col :span="8"><el-statistic title="错误" :value="(validateResult?.errors || []).length" /></el-col>
      <el-col :span="8"><el-statistic title="提醒" :value="(validateResult?.warnings || []).length" /></el-col>
    </el-row>
    <el-descriptions v-if="validateResult?.tier_summary" :column="4" border size="small" style="margin-top: 12px">
      <el-descriptions-item label="0级项目装备">{{ validateResult.tier_summary[0] || 0 }}</el-descriptions-item>
      <el-descriptions-item label="1级主要部件">{{ validateResult.tier_summary[1] || 0 }}</el-descriptions-item>
      <el-descriptions-item label="2级子部件">{{ validateResult.tier_summary[2] || 0 }}</el-descriptions-item>
      <el-descriptions-item label="3+基础层">{{ (validateResult.tier_summary[3] || 0) + (validateResult.tier_summary.deep || 0) }}</el-descriptions-item>
    </el-descriptions>
    <el-alert v-if="validateResult?.warnings?.length" type="warning" :closable="false" style="margin-top: 12px">
      <ul><li v-for="(w, i) in validateResult.warnings" :key="'w'+i">{{ w }}</li></ul>
    </el-alert>
    <ul style="margin-top: 12px"><li v-for="(e, i) in validateResult?.errors || []" :key="i">{{ e }}</li></ul>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { CircleCheck } from '@element-plus/icons-vue'

const props = defineProps<{
  dlgValidate: boolean
  validateResult: any
}>()

const emit = defineEmits<{
  (event: 'update:dlgValidate', value: boolean): void
}>()

const dlgValidateModel = computed({ get: () => props.dlgValidate, set: (value: boolean) => emit('update:dlgValidate', value) })
</script>
