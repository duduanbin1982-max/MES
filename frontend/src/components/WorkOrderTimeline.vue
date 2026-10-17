<template>
  <div v-loading="loading">
    <el-descriptions :column="2" border size="small" style="margin-bottom: 12px">
      <el-descriptions-item label="工单号">{{ data?.work_order?.wo_code || '-' }}</el-descriptions-item>
      <el-descriptions-item label="标题">{{ data?.work_order?.title || '-' }}</el-descriptions-item>
      <el-descriptions-item label="当前状态">
        <el-tag :type="stateType" size="small">{{ data?.current_state || '-' }}</el-tag>
      </el-descriptions-item>
      <el-descriptions-item label="流转记录数">{{ timeline.length }} 条</el-descriptions-item>
    </el-descriptions>

    <el-card shadow="never" style="margin-bottom: 12px">
      <template #header><span style="font-size: 13px">当前可用动作</span></template>
      <div v-if="!actions.length" style="color: var(--el-text-color-secondary); font-size: 12px">
        当前状态没有可执行的动作（工单已完工或已取消）
      </div>
      <div v-else style="display: flex; gap: 8px; flex-wrap: wrap">
        <el-button
          v-for="a in actions"
          :key="a.action"
          size="small"
          type="primary"
          plain
          @click="doTransit(a)"
        >{{ a.label }}</el-button>
      </div>
      <div style="margin-top: 8px; font-size: 12px; color: var(--el-text-color-secondary)">
        动作来自工作流定义（app/workflow/workOrderDefinition.js），与工单状态机同源。
      </div>
    </el-card>

    <el-card shadow="never">
      <template #header><span style="font-size: 13px">流转记录（workflow_history）</span></template>
      <el-timeline v-if="timeline.length">
        <el-timeline-item
          v-for="h in timeline"
          :key="h.id"
          :timestamp="h.created_at"
          placement="top"
          :type="h.to_state === 'completed' ? 'success' : h.to_state === 'cancelled' ? 'danger' : 'primary'"
        >
          <div style="font-size: 13px">
            <b>{{ actionLabel(h.action) }}</b>
            <span style="color: var(--el-text-color-secondary)"> {{ h.from_state || '∅' }} → {{ h.to_state }}</span>
          </div>
          <div v-if="h.actor_name || h.comment" style="font-size: 12px; color: var(--el-text-color-secondary)">
            {{ h.actor_name || ('用户#' + (h.actor_id ?? '-')) }}<span v-if="h.comment"> · {{ h.comment }}</span>
          </div>
        </el-timeline-item>
      </el-timeline>
      <el-empty v-else description="暂无流转记录" :image-size="60" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Api } from '../api'
import { ElMessage, ElMessageBox } from 'element-plus'

const props = defineProps<{ woId: number }>()
const emit = defineEmits<{ (e: 'changed'): void }>()

const loading = ref(false)
const data = ref<any>(null)

const LABELS: Record<string, string> = {
  start: '开工',
  dispatch: '派工',
  pause: '暂停',
  complete: '完工',
  report: '报工',
  cancel: '取消',
}
function actionLabel(a: string) {
  return LABELS[a] || a
}

const actions = computed<any[]>(() => data.value?.available_actions || [])
const timeline = computed<any[]>(() => {
  const list = (data.value?.instances || []).flatMap((i: any) => i.history || [])
  return [...list].sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)))
})
const stateType = computed(() => {
  const s = data.value?.current_state
  if (s === 'completed') return 'success'
  if (s === 'cancelled') return 'danger'
  if (s === 'in_progress') return 'warning'
  return 'info'
})

async function load() {
  loading.value = true
  try {
    data.value = await Api.get('/work_orders/' + props.woId + '/workflow')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '加载流转记录失败')
  } finally {
    loading.value = false
  }
}

async function doTransit(action: any) {
  let comment = ''
  try {
    const r: any = await ElMessageBox.prompt(
      '流转动作：' + action.label + (action.to ? '（→ ' + action.to + '）' : '（目标状态由报工量决定）'),
      '确认流转',
      { inputPlaceholder: '备注（可留空）', confirmButtonText: '确认', cancelButtonText: '取消', inputValue: '' },
    )
    comment = r?.value || ''
  } catch {
    return
  }
  loading.value = true
  try {
    await Api.post('/work_orders/' + props.woId + '/transit', { action: action.action, comment })
    ElMessage.success('已' + action.label)
    emit('changed')
    await load()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '流转失败')
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>
