<template>
  <el-dialog v-model="visible" title="批量入库" width="720px">
    <el-form :model="form" label-width="100px">
      <el-form-item label="模式">
        <el-radio-group v-model="form.atomic">
          <el-radio-button :value="false">非原子 (部分成功)</el-radio-button>
          <el-radio-button :value="true">原子 (全成功或全回滚)</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item>
        <el-button size="small" @click="addRow">+ 添加一行</el-button>
        <el-button size="small" type="danger" @click="clearRows" :disabled="form.rows.length <= 1">清空</el-button>
      </el-form-item>
      <div style="max-height: 360px; overflow-y: auto">
        <el-table :data="form.rows" size="small" border>
          <el-table-column label="#" width="50" type="index" />
          <el-table-column label="批次" width="200">
            <template #default="{ row }">
              <el-select v-model="row.material_lot_id" filterable size="small" style="width:100%">
                <el-option v-for="l in lots" :key="l.id" :label="l.lot_no + ' | ' + l.material_name" :value="l.id" />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="类型" width="100">
            <template #default="{ row }">
              <el-select v-model="row.movement_type" size="small" style="width:100%">
                <el-option v-for="t in movTypeOptions" :key="t.value" :label="t.label" :value="t.value" />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="数量" width="100">
            <template #default="{ row }">
              <el-input-number v-model="row.quantity" :min="0" :step="1" size="small" style="width:100%" />
            </template>
          </el-table-column>
          <el-table-column label="目标库位" width="120">
            <template #default="{ row }">
              <el-input aria-label="receive 必填" v-model="row.to_location" size="small" placeholder="receive 必填" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="60">
            <template #default="{ $index }">
              <el-button size="small" link type="danger" @click="form.rows.splice($index, 1)" :disabled="form.rows.length <= 1">删</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <el-alert v-if="form.result" :type="form.result.success ? 'success' : 'warning'" :closable="false" style="margin-top: 12px">
        <pre style="margin: 0; white-space: pre-wrap; font-size: 12px">{{ JSON.stringify(form.result, null, 2) }}</pre>
      </el-alert>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
      <el-button type="primary" :loading="busy" @click="submit">提交 ({{ form.rows.length }} 条)</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../../api'

const props = defineProps<{ modelValue: boolean; lots: any[]; movTypeOptions: any[] }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void; (e: 'done'): void }>()

const visible = ref(props.modelValue)
watch(() => props.modelValue, v => visible.value = v)
watch(visible, v => emit('update:modelValue', v))

const busy = ref(false)
const form = reactive({ atomic: false, rows: [] as any[], result: null as any })
const addRow = () => { form.rows.push({ material_lot_id: undefined, movement_type: 'receive', quantity: 1, to_location: '主仓库-A-01' }) }
const clearRows = () => { form.rows.splice(0, form.rows.length); addRow() }
watch(visible, v => { if (v && form.rows.length === 0) addRow() })

const submit = async () => {
  if (form.rows.length === 0) { ElMessage.warning('请添加至少一行'); return }
  busy.value = true
  try {
    form.result = await api.batchMovements(form.rows, form.atomic)
    if (form.result.success) ElMessage.success('批量成功: ' + form.result.count + ' 条')
    else ElMessage.warning('部分失败: ' + form.result.count + ' 成功, ' + (form.result.failed?.length || 0) + ' 失败')
    emit('done')
  } catch (e: any) { ElMessage.error('失败: ' + (e.response?.data?.error || e.message)) }
  finally { busy.value = false }
}
</script>