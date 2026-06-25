<template>
  <el-card shadow="never">
    <el-form :model="form" label-width="100px" style="max-width: 600px">
      <el-form-item label="类型" required>
        <el-radio-group v-model="form.movement_type">
          <el-radio-button label="receive">入库</el-radio-button>
          <el-radio-button label="issue">领料</el-radio-button>
          <el-radio-button label="return">退料</el-radio-button>
          <el-radio-button label="transfer">调拨</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="批次" required>
        <el-select v-model="form.material_lot_id" filterable placeholder="选批次" style="width: 100%">
          <el-option v-for="l in lots" :key="l.id" :label="l.lot_no + ' | ' + l.material_name" :value="l.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="数量" required>
        <el-input-number v-model="form.quantity" :min="0" :step="1" />
      </el-form-item>
      <el-form-item :label="form.movement_type === 'transfer' ? '源库位' : '目标库位'" required>
        <el-input v-model="form.to_location" />
      </el-form-item>
      <el-form-item v-if="form.movement_type === 'transfer'" label="目标库位" required>
        <el-input v-model="form.from_location" />
      </el-form-item>
      <el-form-item label="工单">
        <el-select v-model="form.work_order_id" filterable clearable style="width: 100%">
          <el-option v-for="w in workOrders" :key="w.id" :label="w.wo_code" :value="w.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="form.notes" type="textarea" :rows="2" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="submit" :loading="submitting">提交</el-button>
      </el-form-item>
    </el-form>
  </el-card>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../../api'

const props = defineProps<{ tab: string }>()
const emit = defineEmits<{ (e: 'refresh'): void }>()

const lots = ref<any[]>([])
const workOrders = ref<any[]>([])
const submitting = ref(false)
const form = reactive({
  movement_type: 'receive', material_lot_id: undefined as any, quantity: 1,
  to_location: '主仓库-A-01', from_location: '', work_order_id: undefined as any, notes: ''
})

const loadDeps = async () => {
  const [l, w] = await Promise.all([api.get('/material_lots'), api.get('/work_orders')])
  lots.value = l; workOrders.value = w
}

const submit = async () => {
  if (!form.material_lot_id || !form.quantity) { ElMessage.warning('请填写完整'); return }
  submitting.value = true
  try {
    const payload: any = { ...form }
    if (form.movement_type !== 'transfer') delete payload.from_location
    if (form.movement_type !== 'issue' && form.movement_type !== 'return') delete payload.work_order_id
    await api.post('/material_movements', payload)
    ElMessage.success('已记录')
    emit('refresh')
  } catch (e: any) { ElMessage.error('失败: ' + (e.response?.data?.error || e.message)) }
  finally { submitting.value = false }
}

onMounted(() => { if (props.tab === 'ops') loadDeps() })
</script>