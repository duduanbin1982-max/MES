<template>
  <el-card class="health-card" shadow="never">
    <div class="health-header">
      <div class="health-title">
        <span>全流程健康检查</span>
        <el-tag v-if="summary" :type="gradeTone(summary.grade)" size="small" effect="dark">{{ gradeLabel(summary.grade) }}</el-tag>
        <span v-if="summary" class="health-score">{{ summary.score }} 分</span>
        <span v-if="summary" class="health-counts">
          已通 {{ summary.counts?.ok || 0 }} · 部分 {{ summary.counts?.partial || 0 }} · 未开始 {{ summary.counts?.empty || 0 }}
        </span>
      </div>
      <div class="health-actions">
        <el-select
          :model-value="selectedId"
          size="small"
          placeholder="选择项目"
          style="width: 220px"
          @update:model-value="onSelect"
        >
          <el-option
            v-for="item in instances"
            :key="item.id"
            :label="`${item.instance_code}（${item.score} 分）`"
            :value="item.id"
          />
        </el-select>
        <el-button size="small" :loading="loading" @click="$emit('refresh')">刷新</el-button>
      </div>
    </div>

    <div class="health-tip">按「立项 → BOM → 工艺 → 派工报工 → 齐套领料 → 检验 → 文档 → 交付成本」八个环节体检，点「去处理」直接进对应页面。</div>

    <el-table :data="rows" size="small" border class="health-table" empty-text="暂无体检数据">
      <el-table-column label="环节" width="150">
        <template #default="{ row }">
          <span>{{ row.label }}</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="86" align="center">
        <template #default="{ row }">
          <el-tag :type="statusTone(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="数据现状" min-width="300">
        <template #default="{ row }">
          <span class="health-metrics">{{ metricText(row.metrics) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="卡点 / 下一步" min-width="330">
        <template #default="{ row }">
          <div v-if="row.blockers.length" class="health-blockers">{{ blockerText(row) }}</div>
          <div v-else class="health-ok">该环节数据齐，可以继续</div>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="90" align="center">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="goPage(row.page)">去处理</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div v-if="actions.length" class="health-next">
      <div class="health-next-title">下一步建议</div>
      <ol>
        <li v-for="line in actions" :key="line">{{ line }}</li>
      </ol>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import {
  blockerText,
  gradeLabel,
  gradeTone,
  metricText,
  nextActionLines,
  stageRows,
  statusLabel,
  statusTone,
} from '../../domain/processHealth'

const props = defineProps<{
  data: any
  loading?: boolean
}>()

const emit = defineEmits<{ refresh: []; select: [instanceId: number] }>()

const router = useRouter()
const rows = computed(() => stageRows(props.data?.selected?.stages))
const summary = computed(() => props.data?.selected?.summary || null)
const instances = computed(() => props.data?.instances || [])
const selectedId = computed(() => props.data?.selected?.instance_id || null)
const actions = computed(() => nextActionLines(summary.value?.next_actions))

// 2026-10-21 修复：原来这里只 router.push 改 URL，但仪表盘没有 watch 路由 → 选了没反应。
// 改为向父组件抛事件，由父组件负责重新拉数据（并同步 URL 便于深链）。
const onSelect = (value: number) => {
  emit('select', value)
}
const goPage = (page: string) => {
  if (page) router.push(page)
}
</script>

<style scoped>
.health-card { margin-bottom: 16px; }
.health-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.health-title { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 15px; }
.health-score { color: var(--el-color-primary); font-size: 16px; }
.health-counts { color: var(--el-color-info); font-size: 12px; font-weight: 400; }
.health-actions { display: flex; gap: 8px; align-items: center; }
.health-tip { color: var(--el-color-info); font-size: 12px; margin: 8px 0 10px; }
.health-metrics { color: var(--el-text-color-regular); font-size: 12px; }
.health-blockers { color: var(--el-color-warning); font-size: 12px; }
.health-ok { color: var(--el-color-success); font-size: 12px; }
.health-next { margin-top: 12px; }
.health-next-title { font-weight: 600; font-size: 13px; margin-bottom: 4px; }
.health-next ol { margin: 0; padding-left: 20px; color: var(--el-text-color-regular); font-size: 12px; line-height: 1.8; }
</style>
