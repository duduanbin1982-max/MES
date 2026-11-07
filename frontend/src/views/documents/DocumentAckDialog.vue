<template>
  <el-dialog v-model="visible" :title="'签收记录: ' + (target ? target.title : '') + ' (' + (target ? target.version : '') + ')'" width="600px">
    <el-table :data="ackList" size="small" border>
      <el-table-column prop="full_name" label="签收人" width="120" />
      <el-table-column prop="username" label="账号" width="100" />
      <el-table-column prop="ack_at" label="签收时间" width="180" />
      <el-table-column prop="ack_method" label="方式" width="80" />
    </el-table>
    <PageState state="empty" compact :show-action="false" v-if="!ackList.length" description="暂无签收记录" />
    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  modelValue: boolean
  target: any
  ackList: any[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})
</script>
