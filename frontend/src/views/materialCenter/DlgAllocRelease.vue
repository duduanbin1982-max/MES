<template>
  <el-dialog v-model="visAllocate" title="调拨/预留库存" width="480px">
    <el-form :model="f1" label-width="100px">
      <el-form-item label="批次"><el-select v-model="f1.material_lot_id" filterable style="width:100%"><el-option v-for="l in lots" :key="l.id" :label="l.lot_no+' | '+l.material_name" :value="l.id" /></el-select></el-form-item>
      <el-form-item label="数量"><el-input-number v-model="f1.quantity" :min="0" :step="1" /></el-form-item>
      <el-form-item label="目标库位"><el-input v-model="f1.location" placeholder="选填" /></el-form-item>
      <el-form-item label="备注"><el-input v-model="f1.notes" type="textarea" :rows="2" /></el-form-item>
    </el-form>
    <template #footer><el-button @click="visAllocate=false">取消</el-button><el-button type="primary" :loading="busy" @click="doAllocate">确认</el-button></template>
  </el-dialog>
  <el-dialog v-model="visRelease" title="释放预留" width="420px">
    <el-form :model="f2" label-width="100px">
      <el-form-item label="批次"><el-select v-model="f2.material_lot_id" filterable style="width:100%"><el-option v-for="l in lots.filter(x=>x.status==='allocated')" :key="l.id" :label="l.lot_no+' | '+l.material_name+' (余 '+qty(l)+')'" :value="l.id" /></el-select></el-form-item>
      <el-form-item label="数量"><el-input-number v-model="f2.quantity" :min="0" :step="1" /></el-form-item>
    </el-form>
    <template #footer><el-button @click="visRelease=false">取消</el-button><el-button type="primary" :loading="busy" @click="doRelease">释放</el-button></template>
  </el-dialog>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../../api'

const props = defineProps<{
  modelValueAllocate: boolean; modelValueRelease: boolean; lots: any[]
}>()
const emit = defineEmits<{
  (e: 'update:modelValueAllocate', v: boolean): void
  (e: 'update:modelValueRelease', v: boolean): void
  (e: 'done'): void
}>()

const visAllocate = ref(props.modelValueAllocate)
const visRelease = ref(props.modelValueRelease)
watch(() => props.modelValueAllocate, v => visAllocate.value = v)
watch(() => props.modelValueRelease, v => visRelease.value = v)
watch(visAllocate, v => emit('update:modelValueAllocate', v))
watch(visRelease, v => emit('update:modelValueRelease', v))

const busy = ref(false)
const f1 = reactive({ material_lot_id: undefined as any, quantity: 1, location: '', notes: '' })
const f2 = reactive({ material_lot_id: undefined as any, quantity: 1 })
const qty = (l: any) => l.available ?? l.quantity ?? 0

const doAllocate = async () => {
  if (!f1.material_lot_id || !f1.quantity) { ElMessage.warning('请填完整'); return }
  busy.value = true
  try { await api.allocate(f1); ElMessage.success('调拨成功'); visAllocate.value = false; emit('done') }
  catch (e: any) { ElMessage.error('失败: ' + (e.response?.data?.error || e.message)) }
  finally { busy.value = false }
}
const doRelease = async () => {
  if (!f2.material_lot_id || !f2.quantity) { ElMessage.warning('请填完整'); return }
  busy.value = true
  try { await api.release(f2); ElMessage.success('已释放'); visRelease.value = false; emit('done') }
  catch (e: any) { ElMessage.error('失败: ' + (e.response?.data?.error || e.message)) }
  finally { busy.value = false }
}
</script>