<template>
  <div v-loading="loading">
    <el-descriptions :column="2" border size="small" style="margin-bottom: 12px">
      <el-descriptions-item label="实体">{{ data?.entity_type }} #{{ data?.entity_id }}</el-descriptions-item>
      <el-descriptions-item label="标识">{{ data?.entity?.wo_code || data?.entity?.doc_no || data?.entity?.eco_no || '-' }}</el-descriptions-item>
      <el-descriptions-item label="标题">{{ data?.entity?.title || data?.entity?.doc_name || '-' }}</el-descriptions-item>
      <el-descriptions-item label="当前状态">
        <el-tag :type="stateType" size="small">{{ data?.current_state || '-' }}</el-tag>
      </el-descriptions-item>
      <el-descriptions-item label="审计来源">{{ (data?.sources || []).join(' / ') || '-' }}</el-descriptions-item>
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
        动作来自工作流定义（app/workflow/definitions.js），与业务状态机同源。
      </div>
    </el-card>

    <el-card shadow="never">
      <template #header><span style="font-size: 13px">流转记录（统一读取口径）</span></template>
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
      <PageState state="empty" compact :show-action="false" v-else description="暂无流转记录" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Api } from '../api'
import { ElMessage, ElMessageBox } from 'element-plus'
import { actionLabel, historyRows, stateTagType } from '../domain/workOrderTimeline'

// 2026-10-17 泛化：同一组件渲染任意实体（work_order / eco / document）的流转时间线
const props = defineProps<{ entityType: string; entityId: number }>()
const emit = defineEmits<{ (e: 'changed'): void }>()

const loading = ref(false)
const data = ref<any>(null)

const actions = computed<any[]>(() => data.value?.available_actions || [])
const timeline = computed(() => historyRows(data.value))
const stateType = computed(() => stateTagType(data.value?.current_state))

async function load() {
  loading.value = true
  try {
    data.value = await Api.get('/workflow/entity/' + props.entityType + '/' + props.entityId)
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '加载流转记录失败')
  } finally {
    loading.value = false
  }
}

async function doTransit(action: any) {
  let comment;
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
    // 工单走业务接口（写 work_orders + 审计）；其它实体走引擎 transit
    if (props.entityType === 'work_order') {
      await Api.post('/work_orders/' + props.entityId + '/transit', { action: action.action, comment })
    } else {
      await Api.post('/workflow/' + (data.value?.instances?.[0]?.id) + '/transit', { action: action.action, comment })
    }
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
