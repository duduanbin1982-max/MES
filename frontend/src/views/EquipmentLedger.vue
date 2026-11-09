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
        <el-switch v-model="includeArchived" active-text="含归档" @change="loadEquipment" />
        <el-button :icon="Download" :disabled="!filteredEquipment.length" @click="exportCsv">导出</el-button>
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
            <div class="metric-sub">含归档；当前展示 {{ filteredEquipment.length }} 台</div>
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
            <div class="metric-sub">交付/运维/完成/归档</div>
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
        <el-table :data="filteredEquipment" stripe style="width:100%">
          <el-table-column prop="instance_code" label="设备编码" min-width="140" />
          <el-table-column prop="instance_name" label="设备名称" min-width="180" />
          <el-table-column label="型号/类型" min-width="150">
            <template #default="{ row }">{{ [row.model_code, row.type_name].filter(Boolean).join(' / ') || '-' }}</template>
          </el-table-column>
          <el-table-column label="序列号/项目号" min-width="150">
            <template #default="{ row }">{{ [row.serial_no, row.project_no].filter(Boolean).join(' / ') || '-' }}</template>
          </el-table-column>
          <el-table-column prop="customer_name" label="客户" min-width="140">
            <template #default="{ row }">{{ row.customer_name || '-' }}</template>
          </el-table-column>
          <el-table-column label="合同/合同额" min-width="170">
            <template #default="{ row }">{{ row.contract_no || '-' }}<br /><span class="muted">{{ contractText(row) }}</span></template>
          </el-table-column>
          <el-table-column label="计划完成" width="120">
            <template #default="{ row }">{{ row.planned_end || '-' }}</template>
          </el-table-column>
          <el-table-column label="交付/验收" width="130">
            <template #default="{ row }">
              <el-tag v-if="row.delivery_status || row.acceptance_result" size="small" :type="deliveryTagType(row)">
                {{ deliveryLabel(row) }}
              </el-tag>
              <span v-else>-</span>
            </template>
          </el-table-column>
          <el-table-column label="生命周期" width="130">
            <template #default="{ row }">
              <el-tag :type="stageTagType(row.lifecycle_stage_normalized || row.lifecycle_stage || row.status)" size="small">
                {{ lifecycleLabel(row.lifecycle_stage_normalized || row.lifecycle_stage || row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="120">
            <template #default="{ row }">
              <el-tag :type="statusTagType(row.status)" effect="plain" size="small">{{ statusLabel(row.status) }}</el-tag>
              <el-tag v-if="row.archive_status === 'archived'" type="info" size="small" style="margin-left:4px">已归档</el-tag>
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
import { Download, Monitor, Refresh, Search } from '@element-plus/icons-vue'
import { EQUIPMENT_LIFECYCLE_META, EQUIPMENT_LIFECYCLE_OPTIONS } from '../domain/statusCatalog'
import { Api } from '../api'
import PageState from '../components/PageState.vue'
import PageToolbar from '../components/PageToolbar.vue'

const router = useRouter()
const loading = ref(false)
const loadError = ref('')
const keyword = ref('')
const stageFilter = ref('')
const includeArchived = ref(true)
const equipment = ref<any[]>([])
const summary = reactive<any>({ total: 0, in_progress: 0, completed: 0, delayed: 0 })

const lifecycleStages = EQUIPMENT_LIFECYCLE_OPTIONS

const filteredEquipment = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  return equipment.value.filter((item) => {
    const stage = normalizeStage(item.lifecycle_stage_normalized || item.lifecycle_stage || item.status || '')
    const matchArchive = includeArchived.value || item.archive_status !== 'archived'
    const matchStage = !stageFilter.value || stage === stageFilter.value
    const matchText = !text || [item.instance_code, item.instance_name, item.customer_name, item.model_code, item.model_name, item.serial_no, item.project_no, item.contract_no]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(text))
    return matchArchive && matchStage && matchText
  })
})

const delayedCount = computed(() => equipment.value.filter((item) => Number(item.is_overdue) || item.status === 'delayed' || item.lifecycle_stage === 'delayed').length)

async function loadEquipment() {
  loading.value = true
  loadError.value = ''
  try {
    const data = await Api.get('/resources/equipment', { params: { include_archived: includeArchived.value } })
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

function normalizeStage(value: string) {
  return value === 'S1' ? 'design' : value
}

function lifecycleLabel(value: string) {
  const normalized = normalizeStage(value)
  const found = lifecycleStages.find((item) => item.value === normalized)
  return found?.label || EQUIPMENT_LIFECYCLE_META[normalized]?.label || statusLabel(normalized)
}

function contractText(row: any) {
  const amount = Number(row.contract_amount || 0)
  if (!amount) return '-'
  const yuan = ['wan', '万元'].includes(String(row.contract_amount_unit || '').toLowerCase()) ? amount * 10000 : amount
  return '¥' + new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(yuan)
}

function deliveryLabel(row: any) {
  const delivery: Record<string, string> = { planned: '待发运', shipped: '已发运', in_transit: '运输中', arrived: '已到货', accepted: '已交付', cancelled: '已取消' }
  if (row.delivery_status) return delivery[row.delivery_status] || row.delivery_status
  if (row.acceptance_result) return '验收 ' + (({ pending: '待验收', passed: '合格', conditional: '有条件', rejected: '不合格' } as Record<string, string>)[row.acceptance_result] || row.acceptance_result)
  return '-'
}

function deliveryTagType(row: any) {
  if (row.acceptance_result === 'passed' || row.delivery_status === 'accepted') return 'success'
  if (row.acceptance_result === 'rejected' || row.delivery_status === 'cancelled') return 'danger'
  if (row.acceptance_result === 'conditional') return 'warning'
  return 'info'
}

function exportCsv() {
  const rows = filteredEquipment.value
  if (!rows.length) return
  const columns = ['instance_code', 'instance_name', 'model_code', 'type_name', 'serial_no', 'project_no', 'customer_name', 'contract_no', 'lifecycle_stage_normalized', 'status', 'archive_status', 'progress_pct', 'planned_start', 'planned_end', 'delivery_status', 'acceptance_result']
  const header = columns.join(',')
  const body = rows.map((row) => columns.map((key) => '"' + String(row[key] ?? '').replace(/"/g, '""') + '"').join(','))
  const blob = new Blob(['\uFEFF' + [header, ...body].join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = '设备台账_' + new Date().toISOString().slice(0, 10) + '.csv'
  link.click()
  URL.revokeObjectURL(url)
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
.muted {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

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
