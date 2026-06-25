<template>
  <el-dialog v-model="visSplit" title="拆批" width="460px">
    <el-form :model="f1" label-width="100px">
      <el-form-item label="源批次"><el-input :value="f1.src_lot_no" disabled /></el-form-item>
      <el-form-item label="拆出数量" required>
        <el-input-number v-model="f1.quantity" :min="0.01" :step="1" :max="f1.src_max" />
        <span style="margin-left: 8px; color: #909399">/ 可用 {{ f1.src_max }}</span>
      </el-form-item>
      <el-form-item label="新批次号" required><el-input v-model="f1.new_lot_no" /></el-form-item>
      <el-form-item label="库位"><el-input v-model="f1.location" /></el-form-item>
      <el-form-item label="备注"><el-input v-model="f1.notes" type="textarea" :rows="2" /></el-form-item>
    </el-form>
    <template #footer><el-button @click="visSplit=false">取消</el-button><el-button type="primary" :loading="busy" @click="doSplit">确认拆批</el-button></template>
  </el-dialog>
  <el-dialog v-model="visMerge" title="合批 (把其它 lot 合到此 lot)" width="540px">
    <el-form :model="f2" label-width="100px">
      <el-form-item label="目标批次"><el-input :value="f2.dst_lot_no + ' | ' + f2.dst_material_name" disabled /></el-form-item>
      <el-form-item label="源批次(多选)" required>
        <el-select v-model="f2.source_lot_ids" multiple filterable style="width:100%">
          <el-option v-for="l in candidates" :key="l.id" :label="l.lot_no + ' | ' + l.material_name + ' (库 ' + (l.location || '-') + ': ' + (l.quantity || 0) + ')'" :value="l.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="库位"><el-input v-model="f2.location" /></el-form-item>
      <el-form-item label="备注"><el-input v-model="f2.notes" type="textarea" :rows="2" /></el-form-item>
    </el-form>
    <template #footer><el-button @click="visMerge=false">取消</el-button><el-button type="primary" :loading="busy" @click="doMerge">确认合批</el-button></template>
  </el-dialog>
</template>

<script setup lang="ts">
import { reactive, ref, watch, computed } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../../api'

const props = defineProps<{
  modelValueSplit: boolean; modelValueMerge: boolean; inv: any[]
}>()
const emit = defineEmits<{
  (e: 'update:modelValueSplit', v: boolean): void
  (e: 'update:modelValueMerge', v: boolean): void
  (e: 'split', src: { id: number; lot_no: string; quantity: number; location: string }): void
  (e: 'merge', dst: { id: number; lot_no: string; material_name: string; location: string }): void
  (e: 'done'): void
}>()

const visSplit = ref(props.modelValueSplit)
const visMerge = ref(props.modelValueMerge)
watch(() => props.modelValueSplit, v => visSplit.value = v)
watch(() => props.modelValueMerge, v => visMerge.value = v)
watch(visSplit, v => emit('update:modelValueSplit', v))
watch(visMerge, v => emit('update:modelValueMerge', v))

const busy = ref(false)
const f1 = reactive({ src_id: 0, src_lot_no: '', src_max: 0, quantity: 1, new_lot_no: '', location: '主仓库-A-01', notes: '' })
const f2 = reactive({ dst_id: 0, dst_lot_no: '', dst_material_name: '', source_lot_ids: [] as number[], location: '主仓库-A-01', notes: '' })
const candidates = computed(() => {
  if (!f2.dst_id) return []
  const dst = props.inv.find((i: any) => i.material_lot_id === f2.dst_id)
  if (!dst) return []
  return props.inv.filter((i: any) => i.material_lot_id !== f2.dst_id && i.material_id === dst.material_id && (i.quantity || 0) > 0)
})

const doSplit = async () => {
  if (!f1.quantity || !f1.new_lot_no) { ElMessage.warning('请填完整'); return }
  busy.value = true
  try {
    const r: any = await api.splitLot(f1.src_id, { quantity: f1.quantity, new_lot_no: f1.new_lot_no, location: f1.location, notes: f1.notes })
    ElMessage.success('拆批成功: ' + r.new_lot_no); visSplit.value = false; emit('done')
  } catch (e: any) { ElMessage.error('失败: ' + (e.response?.data?.error || e.message)) }
  finally { busy.value = false }
}
const doMerge = async () => {
  if (f2.source_lot_ids.length === 0) { ElMessage.warning('请选源批次'); return }
  busy.value = true
  try {
    const r: any = await api.mergeLot(f2.dst_id, { source_lot_ids: f2.source_lot_ids, location: f2.location, notes: f2.notes })
    ElMessage.success('合批成功: 合并了 ' + r.merged.length + ' 个源 lot'); visMerge.value = false; emit('done')
  } catch (e: any) { ElMessage.error('失败: ' + (e.response?.data?.error || e.message)) }
  finally { busy.value = false }
}

// 暴露给父组件调用
defineExpose({
  openSplit(row: any) {
    f1.src_id = row.material_lot_id; f1.src_lot_no = row.lot_no; f1.src_max = row.quantity || 0
    f1.quantity = 1; f1.new_lot_no = row.lot_no + '-S' + Date.now().toString().slice(-4)
    f1.location = row.location || '主仓库-A-01'; f1.notes = ''
    visSplit.value = true
  },
  openMerge(row: any) {
    f2.dst_id = row.material_lot_id; f2.dst_lot_no = row.lot_no; f2.dst_material_name = row.material_name
    f2.source_lot_ids = []; f2.location = row.location || '主仓库-A-01'; f2.notes = ''
    visMerge.value = true
  }
})
</script>