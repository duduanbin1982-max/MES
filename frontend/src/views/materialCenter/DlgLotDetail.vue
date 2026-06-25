<template>
  <el-dialog v-model="visible" :title="'批次详情: ' + (lotDetail?.lot_no || '')" width="640px">
    <div v-if="lotDetail" v-loading="loading">
      <el-descriptions :column="2" border size="small">
        <el-descriptions-item label="物料编码">{{ lotDetail.material_code }}</el-descriptions-item>
        <el-descriptions-item label="物料名称">{{ lotDetail.material_name }}</el-descriptions-item>
        <el-descriptions-item label="规格">{{ lotDetail.spec || '-' }}</el-descriptions-item>
        <el-descriptions-item label="单位">{{ lotDetail.material_unit || lotDetail.unit || '-' }}</el-descriptions-item>
        <el-descriptions-item label="批次号">{{ lotDetail.lot_no }}</el-descriptions-item>
        <el-descriptions-item label="供应商">{{ lotDetail.supplier || '-' }}</el-descriptions-item>
        <el-descriptions-item label="炉号">{{ lotDetail.heat_no || '-' }}</el-descriptions-item>
        <el-descriptions-item label="证书号">{{ lotDetail.certificate_no || '-' }}</el-descriptions-item>
        <el-descriptions-item label="到货日期">{{ lotDetail.received_date || '-' }}</el-descriptions-item>
        <el-descriptions-item label="总库存"><strong style="color: #409eff">{{ lotDetail.inventory_total }}</strong></el-descriptions-item>
      </el-descriptions>
      <h4 style="margin-top: 16px">📍 各库位库存</h4>
      <el-table :data="lotDetail.inventory" size="small" border>
        <el-table-column prop="location" label="库位" />
        <el-table-column prop="quantity" label="数量" align="right" />
        <el-table-column prop="unit" label="单位" width="80" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'available' ? 'success' : 'warning'" size="small">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="last_updated" label="更新" width="170" />
      </el-table>
      <h4 style="margin-top: 16px">📊 移动汇总</h4>
      <el-table :data="movStatRows" size="small" border>
        <el-table-column prop="type_label" label="类型" />
        <el-table-column prop="qty" label="累计数量" align="right" />
        <el-table-column prop="cnt" label="次数" align="right" />
      </el-table>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../../api'

const props = defineProps<{ modelValue: boolean; lotId: number | null; movTypeLabel: (s: string) => string }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

const visible = ref(props.modelValue)
const lotDetail = ref<any>(null)
const loading = ref(false)
watch(() => props.modelValue, v => visible.value = v)
watch(visible, v => emit('update:modelValue', v))
watch(() => props.lotId, async (id) => {
  if (!id) return
  loading.value = true; lotDetail.value = null
  try { lotDetail.value = await api.materialLot(id) }
  catch (e: any) { ElMessage.error('加载失败: ' + (e.response?.data?.error || e.message)); visible.value = false }
  finally { loading.value = false }
})

const movStatRows = computed(() => {
  if (!lotDetail.value?.movement_stats) return []
  return Object.entries(lotDetail.value.movement_stats).map(([k, v]: any) => ({
    type_label: props.movTypeLabel(k), qty: v.qty, cnt: v.cnt
  }))
})
</script>