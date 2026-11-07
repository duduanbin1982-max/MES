<template>
  <div class="page">
    <PageToolbar
      title="项目交付看板"
      subtitle="合同到验收的项目级进度、风险与业务断点"
      aria-label="项目交付看板工具栏"
    >
      <template #actions>
        <el-button :icon="Refresh" :loading="loading" @click="loadAll">刷新</el-button>
      </template>
    </PageToolbar>

    <el-row :gutter="16" class="kpi-row">
      <el-col :span="6">
        <el-card class="kpi-card">
          <div class="stat-label">项目总数</div>
          <div class="stat-value">{{ summary.total_projects || 0 }}</div>
          <div class="stat-sub">TBM 实例</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="kpi-card">
          <div class="stat-label">平均进度</div>
          <div class="stat-value">{{ summary.avg_progress || 0 }}%</div>
          <div class="stat-sub">按工单与工序综合</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="kpi-card">
          <div class="stat-label">风险项目</div>
          <div class="stat-value danger">{{ summary.risk_projects || 0 }}</div>
          <div class="stat-sub">存在延期/质量/变更等异常</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="kpi-card">
          <div class="stat-label">待处理异常</div>
          <div class="stat-value warning">{{ summary.open_exceptions || 0 }}</div>
          <div class="stat-sub">跨模块异常池</div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16" class="kpi-row">
      <el-col :span="6">
        <el-card class="kpi-card">
          <div class="stat-label">交付单</div>
          <div class="stat-value">{{ summary.deliveries?.total || 0 }}</div>
          <div class="stat-sub">已交付 {{ summary.deliveries?.accepted || 0 }} · 在途 {{ summary.deliveries?.in_flight || 0 }}</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="kpi-card">
          <div class="stat-label">验收</div>
          <div class="stat-value">{{ summary.acceptances?.passed || 0 }} / {{ summary.acceptances?.total || 0 }}</div>
          <div class="stat-sub">让步 {{ summary.acceptances?.conditional || 0 }} · 拒收 {{ summary.acceptances?.rejected || 0 }}</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="kpi-card">
          <div class="stat-label">已回款</div>
          <div class="stat-value success">¥{{ (summary.payments?.total_amount || 0).toLocaleString() }}</div>
          <div class="stat-sub">合同额 ¥{{ (summary.payments?.contract_amount || 0).toLocaleString() }}</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="kpi-card">
          <div class="stat-label">回款率</div>
          <div class="stat-value">{{ summary.payments?.payment_rate_pct || 0 }}%</div>
          <div class="stat-sub">已回款 / 合同额</div>
        </el-card>
      </el-col>
    </el-row>

    <el-alert
      v-if="loadError"
      class="load-alert"
      type="error"
      show-icon
      :closable="false"
      title="项目交付看板加载失败"
      :description="loadError"
    >
      <template #default>
        <el-button size="small" type="primary" plain @click="loadAll">重试</el-button>
      </template>
    </el-alert>

    <el-card class="workflow-card">
      <template #header>
        <div class="card-header">
          <span>流程工作台</span>
          <span class="workflow-hint">一行一台 TBM，一格一个业务阶段；红/黄格就是当前堵点</span>
        </div>
      </template>
      <div class="workflow-scroll">
        <table class="workflow-table">
          <thead>
            <tr>
              <th class="project-col">项目</th>
              <th v-for="key in workflowKeys" :key="key">{{ workflowLabel(key) }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="project in filteredProjects" :key="project.id">
              <td class="project-col">
                <div class="wf-project-code">{{ project.instance_code }}</div>
                <div class="wf-project-name">{{ project.instance_name }}</div>
              </td>
              <td v-for="key in workflowKeys" :key="`${project.id}-${key}`">
                <div class="flow-cell" role="button" tabindex="0" :aria-label="`${project.instance_code} ${workflowLabel(key)} ${statusLabel(stageByKey(project, key).status)}`" :class="`flow-${stageByKey(project, key).status}`" @click="openStage(project, stageByKey(project, key))" @keydown.enter.prevent="openStage(project, stageByKey(project, key))" @keydown.space.prevent="openStage(project, stageByKey(project, key))">
                  <div class="flow-cell-head">
                    <span>{{ stageByKey(project, key).percent }}%</span>
                    <el-tag v-if="stageByKey(project, key).blocker_count" size="small" type="danger">{{ stageByKey(project, key).blocker_count }}</el-tag>
                  </div>
                  <div class="flow-cell-status">{{ statusLabel(stageByKey(project, key).status) }}</div>
                  <div class="flow-cell-owner">{{ stageByKey(project, key).owner_role }}</div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </el-card>

    <el-row :gutter="16">
      <el-col :span="15">
        <el-card>
          <template #header>
            <div class="card-header">
              <span>交付项目</span>
              <el-segmented v-model="riskFilter" :options="riskOptions" size="small" @change="applyFilter" />
            </div>
          </template>
          <el-table :data="filteredProjects" size="small" height="620" @row-click="selectProject">
            <el-table-column prop="instance_code" label="项目编码" width="140" />
            <el-table-column prop="instance_name" label="项目名称" min-width="220" show-overflow-tooltip />
            <el-table-column prop="customer_name" label="客户" width="140" show-overflow-tooltip />
            <el-table-column label="阶段" width="120">
              <template #default="{ row }">
                <el-tag size="small">{{ row.lifecycle_stage || row.status || '-' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="进度" width="170">
              <template #default="{ row }">
                <el-progress :percentage="Math.round(row.progress_pct || 0)" :stroke-width="8" />
              </template>
            </el-table-column>
            <el-table-column label="风险" width="110">
              <template #default="{ row }">
                <el-tag :type="riskTag(row.risk_level)" size="small">{{ riskLabel(row.risk_level) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="跟催" width="90">
              <template #default="{ row }">
                <el-badge :value="row.risk_breakdown?.purchase_followup_count || 0" :hidden="!(row.risk_breakdown?.purchase_followup_count)">
                  <span>{{ row.risk_breakdown?.purchase_followup_overdue || 0 }}延</span>
                </el-badge>
              </template>
            </el-table-column>
            <el-table-column label="风险钻取" width="110">
              <template #default="{ row }">
                <el-button link size="small" @click.stop="openRiskDrawer(row)">钻取</el-button>
              </template>
            </el-table-column>
            <el-table-column label="主线体检" width="110">
              <template #default="{ row }">
                <el-button link size="small" @click.stop="openLineageDrawer(row)">体检</el-button>
              </template>
            </el-table-column>
            <el-table-column label="异常" width="80">
              <template #default="{ row }">
                <el-badge :value="row.exception_count" :hidden="!row.exception_count">
                  <el-button link size="small" @click.stop="goExceptions(row)">查看</el-button>
                </el-badge>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>

      <el-col :span="9">
        <el-card class="detail-card">
          <template #header>
            <div class="card-header">
              <span>{{ selected?.instance_code || '项目详情' }}</span>
              <div>
                <el-button v-if="selected" link size="small" @click="openLineageDrawer(selected)">主线体检</el-button>
                <el-button v-if="selected" link size="small" @click="openRiskDrawer(selected)">风险钻取</el-button>
                <el-button v-if="selected" link size="small" @click="goDetail(selected)">实例详情</el-button>
              </div>
            </div>
          </template>

          <template v-if="selected">
            <div class="project-title">{{ selected.instance_name }}</div>
            <div class="project-meta">
              <el-tag :type="riskTag(selected.risk_level)" size="small">{{ riskLabel(selected.risk_level) }}</el-tag>
              <span>OEE 30天：{{ selected.oee_30d == null ? '-' : selected.oee_30d + '%' }}</span>
              <span>异常：{{ selected.exception_count }}</span><span>缺料：{{ selected.risk_breakdown?.shortage_count || 0 }}</span><span>跟催：{{ selected.risk_breakdown?.purchase_followup_count || 0 }}</span><span>延期跟催：{{ selected.risk_breakdown?.purchase_followup_overdue || 0 }}</span><span>NCR：{{ selected.risk_breakdown?.ncr_count || 0 }}</span><span>成本偏差：{{ selected.risk_breakdown?.cost_variance_pct || 0 }}%</span>
            </div>

            <el-divider />
            <div class="section-title">交付闭环</div>
            <div class="stage-list">
            <div v-for="s in selected.stages" :key="s.label" class="stage-item" role="button" tabindex="0" @click="go(s.path)" @keydown.enter.prevent="go(s.path)" @keydown.space.prevent="go(s.path)">
                <div class="stage-head">
                  <span>{{ s.label }}</span>
                  <span>{{ s.done }}/{{ s.total }}</span>
                </div>
                <el-progress :percentage="s.percent" :stroke-width="7" :status="s.status === 'done' ? 'success' : undefined" />
              </div>
            </div>

            <el-divider />
            <div class="section-title">核心指标</div>
            <el-descriptions :column="2" border size="small">
              <el-descriptions-item label="工单">{{ selected.metrics.work_orders.done }}/{{ selected.metrics.work_orders.total }}</el-descriptions-item>
              <el-descriptions-item label="工序">{{ selected.metrics.process_nodes.done }}/{{ selected.metrics.process_nodes.total }}</el-descriptions-item>
              <el-descriptions-item label="图纸">{{ selected.metrics.documents.issued }}/{{ selected.metrics.documents.total }}</el-descriptions-item>
              <el-descriptions-item label="质检">{{ selected.metrics.quality.pass }}/{{ selected.metrics.quality.total }}</el-descriptions-item>
            </el-descriptions>

            <el-divider />
            <div class="section-title">优先处理</div>
            <PageState state="empty" compact :show-action="false" v-if="!selected.top_exceptions.length" description="暂无异常" />
            <div v-for="item in selected.top_exceptions" :key="item.id" class="exception-line" role="button" tabindex="0" @click="go(item.source_path)" @keydown.enter.prevent="go(item.source_path)" @keydown.space.prevent="go(item.source_path)">
              <el-tag :type="severityTag(item.severity)" size="small">{{ severityLabel(item.severity) }}</el-tag>
              <span class="exception-title">{{ item.title }}</span>
            </div>
          </template>
          <PageState state="empty" compact :show-action="false" v-else description="选择左侧项目查看交付闭环" />
        </el-card>
      </el-col>
    </el-row>


    <DeliveryStageDrawer v-model="stageDrawerVisible" :data="stageData" @navigate="go" @open-risk="openRiskDrawer" />

    <DeliveryRiskDrawer v-model="riskDrawerVisible" v-model:active-tab="riskTab" :data="riskData" @navigate="go" />

    <DeliveryLineageDrawer v-model="lineageDrawerVisible" v-model:active-tab="lineageTab" :data="lineageData" @open-entry="openFixEntry" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import PageToolbar from '../components/PageToolbar.vue'
import { Api } from '../api'
import DeliveryLineageDrawer from './delivery/DeliveryLineageDrawer.vue'
import DeliveryRiskDrawer from './delivery/DeliveryRiskDrawer.vue'
import DeliveryStageDrawer from './delivery/DeliveryStageDrawer.vue'
import { fixEntry, riskLabel, riskTag, severityLabel, severityTag, stageByKey, statusLabel, workflowLabel } from './delivery/deliveryShared'

const router = useRouter()
const loading = ref(false)
const loadError = ref('')
const summary = reactive<any>({})
const projects = ref<any[]>([])
const selected = ref<any | null>(null)
const riskDrawerVisible = ref(false)
const riskData = ref<any | null>(null)
const riskTab = ref('exceptions')
const riskFilter = ref('all')
const stageDrawerVisible = ref(false)
const stageData = ref<any | null>(null)
const lineageDrawerVisible = ref(false)
const lineageData = ref<any | null>(null)
const lineageTab = ref('segments')
const workflowKeys = ['contract', 'bom', 'documents', 'process', 'purchase', 'kit', 'work_orders', 'report', 'quality', 'cost', 'acceptance']
const riskOptions = [
  { label: '全部', value: 'all' },
  { label: '严重', value: 'critical' },
  { label: '高风险', value: 'high' },
  { label: '预警', value: 'warning' },
  { label: '正常', value: 'normal' }
]

const filteredProjects = computed(() => riskFilter.value === 'all'
  ? projects.value
  : projects.value.filter((p) => p.risk_level === riskFilter.value))


function openStage(project: any, stage: any) {
  selected.value = project
  stageData.value = { project, stage }
  stageDrawerVisible.value = true
}

function selectProject(row: any) {
  selected.value = row
}

function applyFilter() {
  selected.value = filteredProjects.value[0] || null
}

function go(path?: string) {
  if (!path) return
  router.push(path)
}

function openFixEntry(row: any) {
  const entry = fixEntry(row)
  const path = entry?.path || row?.action_path || row?.path
  if (!path) {
    ElMessage.warning('这个缺口暂未配置处理入口')
    return
  }
  lineageDrawerVisible.value = false
  router.push(path)
}

function goDetail(row: any) {
  router.push(`/instances/${row.id}`)
}

function goExceptions(row: any) {
  router.push(`/exceptions?instance_id=${row.id}&from=delivery`)
}

async function openRiskDrawer(row: any) {
  riskDrawerVisible.value = true
  riskData.value = null
  riskTab.value = 'exceptions'
  try {
    riskData.value = await Api.deliveryProjectRisks(row.id)
  } catch (e: any) {
    ElMessage.error('加载风险数据失败: ' + (e?.message || e))
    riskDrawerVisible.value = false
  }
}

async function openLineageDrawer(row: any) {
  lineageDrawerVisible.value = true
  lineageData.value = null
  lineageTab.value = 'segments'
  try {
    lineageData.value = await Api.deliveryProjectLineage(row.id)
  } catch (e: any) {
    ElMessage.error('加载主线体检失败: ' + (e?.message || e))
    lineageDrawerVisible.value = false
  }
}

async function loadAll() {
  loading.value = true
  loadError.value = ''
  try {
    const data: any = await Api.deliveryOverview()
    Object.assign(summary, data.summary || {})
    projects.value = data.projects || []
    selected.value = filteredProjects.value[0] || projects.value[0] || null
  } catch (e: any) {
    loadError.value = e?.message || String(e || '加载失败')
    ElMessage.error('加载项目交付看板失败: ' + loadError.value)
  } finally {
    loading.value = false
  }
}

onMounted(loadAll)
</script>

<style scoped>
.page-subtitle { color: var(--el-text-color-secondary); font-size: 13px; margin-top: 4px; }
.kpi-row { margin-bottom: 16px; }
.load-alert { margin-bottom: 16px; }
.kpi-card { min-height: 104px; }
.stat-label { color: var(--el-text-color-secondary); font-size: 13px; }
.stat-value { font-size: 30px; font-weight: 700; margin-top: 10px; }
.stat-value.danger { color: var(--el-color-danger); }
.stat-value.warning { color: var(--el-color-warning); }
.stat-sub { color: var(--el-text-color-secondary); font-size: 12px; margin-top: 6px; }
.card-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.detail-card { min-height: 680px; }
.project-title { font-size: 16px; font-weight: 600; margin-bottom: 8px; }
.project-meta { display: flex; gap: 10px; align-items: center; color: var(--el-text-color-secondary); font-size: 13px; flex-wrap: wrap; }
.section-title { font-size: 13px; font-weight: 600; margin-bottom: 10px; color: var(--el-text-color-primary); }
.stage-list { display: grid; gap: 12px; }
.stage-item { cursor: pointer; padding: 10px; border: 1px solid var(--el-border-color-lighter); border-radius: 6px; }
.stage-item:hover { border-color: var(--el-color-primary-light-5); background: var(--el-fill-color-light); }
.stage-head { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px; }
.exception-line { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--el-border-color-lighter); cursor: pointer; }
.exception-line:hover .exception-title { color: var(--el-color-primary); }
.exception-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.risk-kpis { margin-bottom: 12px; }
.lineage-kpis { margin-bottom: 12px; }
.lineage-alert { margin-bottom: 12px; }
.lineage-keys { margin-top: 10px; color: var(--el-text-color-regular); font-size: 13px; line-height: 1.5; }
.fix-entry { display: flex; align-items: center; gap: 6px; min-width: 0; }
.fix-entry span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fix-checklist-title { font-weight: 600; margin-bottom: 8px; color: var(--el-text-color-primary); }
.fix-checklist { margin: 0; padding-left: 18px; color: var(--el-text-color-regular); line-height: 1.8; }
.quick-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; }

.workflow-card { margin-bottom: 16px; }
.workflow-hint { color: var(--el-text-color-secondary); font-size: 12px; font-weight: 400; }
.workflow-scroll { overflow-x: auto; padding-bottom: 2px; }
.workflow-table { width: max-content; min-width: 100%; border-collapse: separate; border-spacing: 8px; }
.workflow-table th { color: var(--el-text-color-secondary); font-size: 12px; font-weight: 600; text-align: left; padding: 0 4px 4px; white-space: nowrap; }
.workflow-table td { vertical-align: top; }
.project-col { width: 180px; min-width: 180px; position: sticky; left: 0; z-index: 2; background: var(--el-bg-color); }
.wf-project-code { font-weight: 700; font-size: 13px; }
.wf-project-name { color: var(--el-text-color-secondary); font-size: 12px; margin-top: 4px; max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.flow-cell { width: 116px; min-height: 78px; border: 1px solid var(--el-border-color-lighter); border-radius: 10px; padding: 9px; cursor: pointer; background: var(--el-fill-color-blank); transition: all .15s ease; }
.flow-cell:hover { transform: translateY(-1px); box-shadow: var(--el-box-shadow-light); }
.flow-cell-head { display: flex; justify-content: space-between; align-items: center; font-size: 13px; font-weight: 700; }
.flow-cell-status { margin-top: 8px; font-size: 12px; }
.flow-cell-owner { margin-top: 6px; color: var(--el-text-color-secondary); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.flow-done { border-color: var(--el-color-success-light-5); background: var(--el-color-success-light-9); }
.flow-running { border-color: var(--el-color-primary-light-5); background: var(--el-color-primary-light-9); }
.flow-warning { border-color: var(--el-color-warning-light-5); background: var(--el-color-warning-light-9); }
.flow-blocked { border-color: var(--el-color-danger-light-5); background: var(--el-color-danger-light-9); }
.flow-pending, .flow-empty { background: var(--el-fill-color-light); }
.stage-desc { margin-top: 4px; }
.blocker-line { display: flex; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--el-border-color-lighter); }
.blocker-body { flex: 1; min-width: 0; }
.blocker-title { font-weight: 600; font-size: 13px; }
.blocker-message { color: var(--el-text-color-secondary); font-size: 12px; margin-top: 4px; line-height: 1.5; }
.stage-actions { margin-top: 18px; display: flex; gap: 8px; }
</style>
