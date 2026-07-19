<template>
  <el-drawer v-model="visible" title="版本历史" size="640px" :with-header="true">
    <div v-if="loading" v-loading="true" class="drawer-loading"></div>
    <div v-else>
      <div class="drawer-hint">文档: <b>{{ current?.title }}</b> ({{ current?.doc_code }})</div>
      <el-timeline>
        <el-timeline-item
          v-for="version in versions"
          :key="version.id"
          :type="version.id === current?.id ? 'primary' : 'info'"
          :timestamp="version.created_at"
          :hollow="version.id !== current?.id"
        >
          <el-card shadow="never" class="version-card" @click="$emit('download', version)">
            <div class="version-row">
              <el-tag :type="version.id === current?.id ? 'primary' : 'info'" size="small">v{{ version.version }}</el-tag>
              <el-tag :type="statusTag[version.status]" size="small">{{ statusLabel[version.status] }}</el-tag>
              <span>{{ version.file_name }}</span>
              <span class="version-size">{{ version.human_size }}</span>
            </div>
            <div class="version-hash">
              点击下载 · 哈希: {{ (version.file_hash || '').slice(0, 12) }}…
            </div>
          </el-card>
        </el-timeline-item>
      </el-timeline>
      <el-divider />
      <div class="drawer-hint"><b>签发/收回/签收流水</b></div>
      <el-empty v-if="!events.length" description="暂无动作历史" :image-size="72" />
      <el-timeline v-else>
        <el-timeline-item
          v-for="event in events"
          :key="event.id"
          :type="eventType(event.action)"
          :timestamp="event.created_at"
        >
          <div class="event-row">
            <el-tag size="small" :type="eventType(event.action)">{{ eventLabel(event.action) }}</el-tag>
            <span v-if="event.version">v{{ event.version }}</span>
            <span v-if="event.from_status || event.to_status">{{ statusLabel[event.from_status] || event.from_status || '—' }} → {{ statusLabel[event.to_status] || event.to_status || '—' }}</span>
            <span v-if="event.issued_to">签发目标: {{ event.issued_to }}</span>
            <span v-if="event.full_name || event.username">操作人: {{ event.full_name || event.username }}</span>
          </div>
          <div v-if="event.reason" class="version-hash">原因: {{ event.reason }}</div>
        </el-timeline-item>
      </el-timeline>
    </div>
  </el-drawer>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  modelValue: boolean
  versions: any[]
  events: any[]
  current: any
  loading: boolean
  statusLabel: Record<string, string>
  statusTag: Record<string, string>
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  download: [version: any]
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const eventLabel = (action: string) => ({
  upload: '上传',
  issue: '签发',
  revoke: '收回',
  archive: '归档',
  acknowledge: '签收',
}[action] || action)

const eventType = (action: string) => ({
  upload: 'primary',
  issue: 'success',
  revoke: 'warning',
  archive: 'danger',
  acknowledge: 'info',
}[action] || 'info')
</script>

<style scoped>
.drawer-loading {
  height: 100%;
}

.drawer-hint {
  margin-bottom: 12px;
  color: var(--el-color-info);
}

.version-card {
  cursor: pointer;
}

.version-row {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.version-size {
  color: var(--el-color-info);
  margin-left: auto;
}

.version-hash {
  color: var(--el-color-info);
  font-size: 12px;
  margin-top: 4px;
}

.event-row {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  color: var(--el-text-color-regular);
}
</style>
