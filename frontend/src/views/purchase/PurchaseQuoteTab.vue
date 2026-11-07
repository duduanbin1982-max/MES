<template>
      <!-- ===== Tab 3: 询价对比 ===== -->
      <el-tab-pane label="询价对比" name="quote">
        <div class="tb">
          <span style="font-weight:600">选择供应商:</span>
          <el-select v-model="quoteForm.supplier_ids" multiple filterable placeholder="请选择供应商" style="width:350px">
            <el-option v-for="s in suppliers" :key="s.id" :label="supplierName(s)" :value="s.id" />
          </el-select>
        </div>
        <div class="tb">
          <span style="font-weight:600">选择物料:</span>
          <el-select v-model="quoteForm.material_ids" multiple filterable placeholder="请选择物料" style="width:350px">
            <el-option v-for="m in materials" :key="m.id" :label="m.material_code + ' ' + m.material_name" :value="m.id" />
          </el-select>
        </div>
        <div class="tb">
          <el-button type="primary" @click="emit('compare-quotes')" :loading="quoteLoading" :disabled="!quoteForm.supplier_ids.length || !quoteForm.material_ids.length">对比报价</el-button>
        </div>
        <el-table v-if="quoteResults.length" :data="quoteResults" size="small" max-height="500" stripe border>
          <el-table-column prop="material_name" label="物料" width="160" fixed="left" />
          <el-table-column v-for="s in quoteSuppliers" :key="s.id" :label="s.name" min-width="140" align="right">
            <template #default="{ row }">¥{{ (row[s.id] || 0).toLocaleString() }}</template>
          </el-table-column>
        </el-table>
        <PageState state="empty" compact :show-action="false" v-if="!quoteResults.length && quoteLoaded" description="暂无对比数据，请选择供应商和物料后点击对比报价" />
      </el-tab-pane>
</template>

<script setup lang="ts">
defineProps<{
  suppliers: any[]
  supplierName: (row: any) => string
  materials: any[]
  quoteLoading: boolean
  quoteResults: any[]
  quoteSuppliers: any[]
  quoteLoaded: boolean
}>()
// 2026-10-17（前端 eslint 棘轮）：被模板改写的对象 prop 改为 defineModel，
// 父组件用 v-model:xxx 绑定；改的仍是父组件同一对象，行为不变。
const quoteForm = defineModel<any>('quoteForm', { required: true })


const emit = defineEmits<{
  (event: 'compare-quotes'): void
}>()
</script>

<style scoped>
.tb { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
</style>
