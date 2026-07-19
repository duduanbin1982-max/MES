<template>
  <el-dialog v-model="visible" title="签发文档" width="480px">
    <el-form label-width="100px">
      <el-form-item label="文档">{{ target?.title }} <el-tag size="small">{{ target?.doc_code }}</el-tag></el-form-item>
      <el-form-item label="签发目标" required>
        <el-select v-model="issueToValue" placeholder="请选择" style="width:100%">
          <el-option v-for="targetType in issueTargets" :key="targetType" :label="issueTargetLabel[targetType]" :value="targetType" />
        </el-select>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="acting" @click="$emit('submit')">确认签发</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  modelValue: boolean
  target: any
  issueTo: string
  issueTargets: string[]
  issueTargetLabel: Record<string, string>
  acting: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'update:issueTo': [value: string]
  submit: []
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const issueToValue = computed({
  get: () => props.issueTo,
  set: (value: string) => emit('update:issueTo', value),
})
</script>
