<template>
  <el-card shadow="never">
    <el-form :inline="true" size="small" style="margin-bottom: 12px">
      <el-form-item label="类型">
        <el-select v-model="data.movFilter.movement_type" clearable placeholder="全部" style="width: 120px">
          <el-option v-for="t in data.movTypeOptions" :key="t.value" :label="t.label" :value="t.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="批次">
        <el-select v-model="data.movFilter.material_lot_id" clearable filterable placeholder="全部" style="width: 200px">
          <el-option v-for="l in data.lots" :key="l.id" :label="l.lot_no + ' | ' + l.material_name" :value="l.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="日期">
        <el-date-picker v-model="data.movFilter.dateRange" type="daterange" range-separator="→" start-placeholder="起" end-placeholder="止" value-format="YYYY-MM-DD" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="onSearch">查询</el-button>
        <el-button @click="onReset">重置</el-button>
      </el-form-item>
    </el-form>
    <el-table :data="data.movs" stripe size="small">
      <el-table-column prop="material_name" label="物料" min-width="180" />
      <el-table-column prop="lot_no" label="批次" width="120" />
      <el-table-column label="类型" width="100">
        <template #default="{ row }">
          <el-tag :type="data.movTypeColor(row.movement_type)" size="small">{{ data.movTypeLabel(row.movement_type) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="quantity" label="数量" width="80" align="right" />
      <el-table-column prop="from_location" label="源库位" width="100" />
      <el-table-column prop="to_location" label="目标库位" width="100" />
      <el-table-column prop="created_at" label="时间" width="170" />
      <el-table-column prop="notes" label="备注" min-width="150" />
    </el-table>
    <el-pagination
      v-model:current-page="data.movPage"
      v-model:page-size="data.movLimit"
      :total="data.movTotal"
      :page-sizes="[20, 50, 100, 200]"
      layout="total, sizes, prev, pager, next, jumper"
      style="margin-top: 12px; text-align: right"
      @current-change="data.loadMovs"
      @size-change="(s: number) => { data.movLimit = s; data.movPage = 1; data.loadMovs() }"
    />
  </el-card>
</template>

<script setup lang="ts">
defineProps<{ tab: string }>()

// 直接用 useInvData 拿 (由父组件 provide, 这里重新 import 复用 - 但 composable 需独立实例)
import { useInvData } from './useInvData'
const data = useInvData()
const emit = defineEmits<{ (e: 'refresh'): void }>()
const onSearch = () => { data.movPage.value = 1; data.loadMovs() }
const onReset = () => {
  data.movFilter.movement_type = undefined
  data.movFilter.material_lot_id = undefined
  data.movFilter.dateRange = undefined
  data.movPage.value = 1
  data.loadMovs()
}
</script>