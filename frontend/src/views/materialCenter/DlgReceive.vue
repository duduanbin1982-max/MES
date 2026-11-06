<template>
  <el-dialog v-model="visible" title="一键入库" width="520px" @close="reset">
    <el-form :model="form" label-width="100px">
      <el-form-item label="物料"><el-select v-model="form.material_id" filterable style="width:100%"><el-option v-for="m in materials" :key="m.id" :label="m.material_code+' | '+m.material_name" :value="m.id" /></el-select></el-form-item>
      <el-form-item label="批次号"><el-input v-model="form.lot_no" /></el-form-item>
      <el-form-item label="供应商"><el-input v-model="form.supplier" /></el-form-item>
      <el-form-item label="炉号"><el-input v-model="form.heat_no" /></el-form-item>
      <el-form-item label="数量"><el-input-number v-model="form.quantity" :min="0" :step="1" /></el-form-item>
      <el-form-item label="单位"><el-input v-model="form.unit" /></el-form-item>
      <el-form-item label="库位"><el-input v-model="form.location" /></el-form-item>
      <el-form-item label="证书号"><el-input v-model="form.certificate_no" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="busy" @click="submit">入库</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../../api'

const props = defineProps<{ modelValue: boolean; materials: any[] }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void; (e: 'done'): void }>()

const visible = ref(props.modelValue)
watch(() => props.modelValue, v => visible.value = v)
watch(visible, v => emit('update:modelValue', v))

const form = reactive({ material_id: undefined as any, lot_no: '', supplier: '', heat_no: '', quantity: 1, unit: '件', location: '主仓库-A-01', certificate_no: '' })
const busy = ref(false)
const reset = () => { Object.assign(form, { material_id: undefined, lot_no: '', supplier: '', heat_no: '', quantity: 1, unit: '件', location: '主仓库-A-01', certificate_no: '' }) }

// 2026-11-07: 单位默认值必须跟随物料基准单位, 否则入库批次单位与物料主数据不一致
// (后端已按"基准单位或已登记换算单位"校验, 固定 '件' 会导致非件物料无法入库)
watch(() => form.material_id, (id) => {
  const material = props.materials.find((item: any) => item.id === id)
  if (material?.unit) form.unit = material.unit
})

const submit = async () => {
  if (!form.material_id || !form.lot_no || !form.quantity) { ElMessage.warning('请填完整'); return }
  busy.value = true
  try { await api.receiveLot(form); ElMessage.success('入库成功'); visible.value = false; emit('done') }
  catch (e: any) { ElMessage.error('失败: ' + (e.response?.data?.error || e.message)) }
  finally { busy.value = false }
}
</script>