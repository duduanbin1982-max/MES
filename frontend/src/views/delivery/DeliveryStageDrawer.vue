<template>
  <el-drawer v-model="visible" size="520px" :title="data?.stage ? `${data.project.instance_code} · ${data.stage.label}` : '阶段详情'">
    <template v-if="data?.stage">
      <el-descriptions :column="1" border size="small" class="stage-desc">
        <el-descriptions-item label="当前状态"><el-tag :type="statusTag(data.stage.status)" size="small">{{ statusLabel(data.stage.status) }}</el-tag></el-descriptions-item>
        <el-descriptions-item label="完成度">{{ data.stage.done }}/{{ data.stage.total }} · {{ data.stage.percent }}%</el-descriptions-item>
        <el-descriptions-item label="责任角色">{{ data.stage.owner_role }}</el-descriptions-item>
        <el-descriptions-item label="处理入口">{{ data.stage.action_label }}</el-descriptions-item>
      </el-descriptions>

      <el-divider />
      <div class="section-title">业务堵点</div>
      <PageState state="empty" compact :show-action="false" v-if="!data.stage.blockers?.length" description="这个阶段暂无堵点" />
      <div v-for="blocker in data.stage.blockers" :key="`${blocker.type}-${blocker.title}`" class="blocker-line">
        <el-tag :type="severityTag(blocker.severity)" size="small">{{ severityLabel(blocker.severity) }}</el-tag>
        <div class="blocker-body"><div class="blocker-title">{{ blocker.title }}</div><div class="blocker-message">{{ blocker.message }}</div></div>
      </div>

      <div class="stage-actions">
        <el-button type="primary" @click="emit('navigate', data.stage.path)">{{ data.stage.action_label || '去处理' }}</el-button>
        <el-button @click="emit('open-risk', data.project)">查看项目风险</el-button>
      </div>
    </template>
  </el-drawer>
</template>

<script setup lang="ts">
import { severityLabel, severityTag, statusLabel, statusTag } from './deliveryShared'

defineProps<{ data: any | null }>()
const visible = defineModel<boolean>({ required: true })
const emit = defineEmits<{ navigate: [path?: string]; 'open-risk': [project: any] }>()
</script>

<style scoped>
.section-title { font-size: 13px; font-weight: 600; margin-bottom: 10px; color: var(--el-text-color-primary); }
.stage-desc { margin-top: 4px; }
.blocker-line { display: flex; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--el-border-color-lighter); }
.blocker-body { flex: 1; min-width: 0; }
.blocker-title { font-weight: 600; font-size: 13px; }
.blocker-message { color: var(--el-text-color-secondary); font-size: 12px; margin-top: 4px; line-height: 1.5; }
.stage-actions { margin-top: 18px; display: flex; gap: 8px; }
</style>
