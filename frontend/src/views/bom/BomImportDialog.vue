<template>
  <el-dialog v-model="dlgImportModel" title="CSV 导入" width="700px">
    <el-alert type="info" :closable="false" style="margin-bottom: 12px">
      推荐工业模板列：node_ref, parent_ref, tier, node_type, material_id/material_code, part_number, quantity, unit, category<br>
      自制件强制补齐：material_grade, surface_treatment；外购件建议补齐：brand_recommend, brand_grade
    </el-alert>
    <el-space wrap style="margin-bottom: 12px">
      <el-button size="small" @click="emit('fill-template')">载入标准模板</el-button>
      <el-button size="small" @click="emit('fill-sample')">载入示例数据</el-button>
      <el-button size="small" @click="emit('copy-template')">复制模板到剪贴板</el-button>
    </el-space>
    <el-table :data="templateColumns" size="small" max-height="180" style="margin-bottom: 12px">
      <el-table-column prop="name" label="列名" width="160" />
      <el-table-column prop="required" label="建议" width="90">
        <template #default="{ row }">
          <el-tag size="small" :type="row.required ? 'danger' : 'info'">{{ row.required ? '核心' : '可选' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="desc" label="说明" min-width="280" />
    </el-table>
    <el-input v-model="csvTextModel" type="textarea" :rows="10" placeholder="tier,parent_id,material_id,quantity,unit,category,material_grade,scrap_factor" />
    <template #footer>
      <el-button @click="dlgImportModel = false">取消</el-button>
      <el-button type="primary" :loading="importing" @click="emit('import-csv')">导入</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  dlgImport: boolean
  csvText: string
  templateColumns: any[]
  importing: boolean
}>()

const emit = defineEmits<{
  (event: 'update:dlgImport', value: boolean): void
  (event: 'update:csvText', value: string): void
  (event: 'fill-template'): void
  (event: 'fill-sample'): void
  (event: 'copy-template'): void
  (event: 'import-csv'): void
}>()

const dlgImportModel = computed({ get: () => props.dlgImport, set: (value: boolean) => emit('update:dlgImport', value) })
const csvTextModel = computed({ get: () => props.csvText, set: (value: string) => emit('update:csvText', value) })
</script>
