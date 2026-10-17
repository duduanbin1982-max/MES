<template>
  <div class="page">
    <PageToolbar
      title="设备台账"
      subtitle="以设备/装备实例为主线查看生命周期、客户、进度与交付状态。"
      aria-label="设备台账工具栏"
    >
      <template #icon>
        <el-icon><Monitor /></el-icon>
      </template>
      <template #actions>
        <el-input
          v-model="keyword"
          clearable
          placeholder="搜索编码、名称、客户"
          class="toolbar-search"
          :prefix-icon="Search"
        />
        <el-select v-model="stageFilter" clearable placeholder="生命周期" class="toolbar-select">
          <el-option v-for="stage in lifecycleStages" :key="stage.value" :label="stage.label" :value="stage.value" />
        </el-select>
        <el-button :icon="Refresh" :loading="loading" @click="loadEquipment">刷新</el-button>
      </template>
    </PageToolbar>

    <PageState
      v-if="loadError"
      state="error"
      title="设备台账加载失败"
      :description="loadError"
      action-text="重新加载"
      @retry="loadEquipment"
    />
    <PageState
      v-else-if="loading && !equipment.length"
      state="loading"
      title="正在加载设备台账"
      description="正在获取装备实例生命周期与交付状态。"
    />
    <PageState
      v-else-if="!loading && !equipment.length"
      state="empty"
      title="暂无设备台账"
      description="请先在“项目与装备 / 装备实例”中创建设备实例。"
      action-text="刷新"
      @retry="loadEquipment"
    />
    <template v-else>
      <el-row :gutter="16" class="summary-row">
        <el-col :span="6">
          <el-card class="metric-card">
            <div class="metric-label">设备总数</div>
            <div class="metric-value">{{ summary.total || equipment.length }}</div>
            <div class="metric-sub">纳入 MES 管理的装备实例</div>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card class="metric-card">
            <div class="metric-label">进行中</div>
            <div class="metric-value">{{ summary.in_progress || 0 }}</div>
            <div class="metric-sub">设计/采购/制造/总装/调试</div>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card class="metric-card">
            <div class="metric-label">已完成/交付</div>
            <div class="metric-value">{{ summary.completed || 0 }}</div>
            <div class="metric-sub">交付、运维或归档状态</div>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card class="metric-card danger-soft">
            <div class="metric-label">延期风险</div>
            <div class="metric-value">{{ summary.delayed || delayedCount }}</div>
            <div class="metric-sub">需项目经理跟进</div>
          </el-card>
        </el-col>
      </el-row>

      <el-card>
        <template #header>
          <div class="card-header">
            <span>设备生命周期台账</span>
            <span class="header-hint">共 {{ filteredEquipment.length }} 台</span>
          </div>
        </template>
        <el-table :data="filteredEquipment" stripe>
          <el-table-column prop="instance_code" label="设备编码" min-width="140" />
          <el-table-column prop="instance_name" label="设备名称" min-width="180" />
          <el-table-column prop="customer_name" label="客户" min-width="140">
            <template #default="{ row }">{{ row.customer_name || '-' }}</template>
          </el-table-column>
          <el-table-column label="生命周期" width="130">
            <template #default="{ row }">
              <el-tag :type="stageTagType(row.lifecycle_stage || row.status)" size="small">
                {{ lifecycleLabel(row.lifecycle_stage || row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="120">
            <template #default="{ row }">
              <el-tag :type="statusTagType(row.status)" effect="plain" size="small">{{ statusLabel(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="进度" min-width="180">
            <template #default="{ row }">
              <el-progress :percentage="normalProgress(row.progress_pct)" :stroke-width="8" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="120" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openInstance(row)">查看实例</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Monitor, Refresh, Search } from '@element-plus/icons-vue'
import { Api } from '../api'
import PageState from '../components/PageState.vue'
import PageToolbar from '../components/PageToolbar.vue'

const router = useRouter()
const loading = ref(false)
const loadError = ref('')
const keyword = ref('')
const stageFilter = ref('')
const equipment = ref<any[]>([])
const summary = reactive<any>({ total: 0, in_progress: 0, completed: 0, delayed: 0 })

const lifecycleStages = [
  { value: 'design', label: '设计中' },
  { value: 'procurement', label: '采购中' },
  { value: 'manufacturing', label: '制造中' },
  { value: 'assembly', label: '总装中' },
  { value: 'commissioning', label: '调试中' },
  { value: 'acceptance', label: '验收中' },
  { value: 'delivered', label: '已交付' },
  { value: 'operation', label: '运维中' },
  { value: 'delayed', label: '延期' },
]

const filteredEquipment = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  return equipment.value.filter((item) => {
    const stage = item.lifecycle_stage || item.status || ''
    const matchStage = !stageFilter.value || stage === stageFilter.value
    const matchText = !text || [item.instance_code, item.instance_name, item.customer_name]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(text))
    return matchStage && matchText
  })
})

const delayedCount = computed(() => equipment.value.filter((item) => item.status === 'delayed' || item.lifecycle_stage === 'delayed').length)

async function loadEquipment() {
  loading.value = true
  loadError.value = ''
  try {
    const data = await Api.get('/resources/equipment')
    equipment.value = data.equipment || data || []
    Object.assign(summary, data.summary || {})
  } catch (error: any) {
    /* 2026-10-17: 移除前端调试日志（前端统一用 ElMessage 提示） */
    loadError.value = error?.message || '设备台账接口暂时不可用，请稍后重试。'
  } finally {
    loading.value = false
  }
}

function normalProgress(value: any) {
  const progress = Number(value || 0)
  if (Number.isNaN(progress)) return 0
  return Math.max(0, Math.min(100, Math.round(progress)))
}

function lifecycleLabel(value: string) {
  const found = lifecycleStages.find((item) => item.value === value)
  return found?.label || statusLabel(value)
}

function statusLabel(value: string) {
  const map: Record<string, string> = {
    design: '设计中',
    procurement: '采购中',
    manufacturing: '制造中',
    assembly: '总装中',
    commissioning: '调试中',
    acceptance: '验收中',
    delivered: '已交付',
    operation: '运维中',
    completed: '已完成',
    archived: '已归档',
    delayed: '延期',
  }
  return map[value] || value || '-'
}

function stageTagType(value: string) {
  const map: Record<string, string> = {
    commissioning: 'warning',
    acceptance: 'warning',
    delivered: 'success',
    operation: 'success',
    completed: 'success',
    archived: 'info',
    delayed: 'danger',
  }
  return map[value] || 'primary'
}

function statusTagType(value: string) {
  if (value === 'delayed') return 'danger'
  if (['delivered', 'operation', 'completed'].includes(value)) return 'success'
  if (value === 'archived') return 'info'
  return 'primary'
}

function openInstance(row: any) {
  if (row?.id) router.push(`/instances/${row.id}`)
}

onMounted(loadEquipment)
</script>

<style scoped>
.page {
  padding: 16px;
}

.toolbar-search {
  width: 240px;
}

.toolbar-select {
  width: 150px;
}

.summary-row {
  margin-bottom: 16px;
}

.metric-card {
  min-height: 118px;
}

.metric-label {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  margin-bottom: 8px;
}

.metric-value {
  color: var(--el-text-color-primary);
  font-size: 30px;
  font-weight: 700;
  line-height: 1.2;
}

.metric-sub,
.header-hint {
  color: var(--el-text-color-placeholder);
  font-size: 12px;
  margin-top: 8px;
}

.danger-soft {
  border-color: var(--el-color-danger-light-7);
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
</style>
