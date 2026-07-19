<template>
  <el-dialog v-model="visible" title="收回文档" width="480px">
    <el-form label-width="100px">
      <el-form-item label="文档">{{ target?.title }}</el-form-item>
      <el-form-item label="收回原因" required>
        <el-input v-model="reasonValue" type="textarea" :rows="3" placeholder="例如: 工艺更新 / 错版 / 客户要求" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="warning" :loading="acting" @click="$emit('submit')">确认收回</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  modelValue: boolean
  target: any
  reason: string
  acting: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'update:reason': [value: string]
  submit: []
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const reasonValue = computed({
  get: () => props.reason,
  set: (value: string) => emit('update:reason', value),
})
</script>
