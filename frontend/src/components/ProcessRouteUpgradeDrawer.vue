<template>
  <el-drawer v-model="visible" title="工艺路线升级工作台" size="min(1080px, 96vw)" destroy-on-close>
    <template #header>
      <div class="drawer-title">
        <span>工艺路线升级工作台</span>
        <el-tag v-if="instanceId" size="small" effect="plain">{{ instanceId }}</el-tag>
        <el-button size="small" :icon="Refresh" :loading="loading" @click="loadAll">刷新</el-button>
      </div>
    </template>

    <el-tabs v-model="activeTab">
      <el-tab-pane label="总览与健康度" name="overview">
        <el-row :gutter="12">
          <el-col :xs="24" :md="6">
            <el-card shadow="never" class="metric-card">
              <div class="metric-label">路线健康分</div>
              <div class="metric-value" :class="scoreClass">{{ health?.grade || '-' }} · {{ health?.score ?? '-' }}</div>
              <el-progress :percentage="health?.score || 0" :stroke-width="8" :show-text="false" :status="scoreStatus" />
            </el-card>
          </el-col>
          <el-col :xs="12" :md="6"><el-card shadow="never" class="metric-card"><div class="metric-label">节点/根节点</div><div class="metric-value">{{ health?.node_count ?? 0 }} / {{ health?.root_count ?? 0 }}</div></el-card></el-col>
          <el-col :xs="12" :md="6"><el-card shadow="never" class="metric-card"><div class="metric-label">完成率</div><div class="metric-value">{{ kpi?.completion_pct ?? 0 }}%</div><div class="metric-sub">{{ kpi?.completed ?? 0 }} / {{ kpi?.node_count ?? 0 }}</div></el-card></el-col>
          <el-col :xs="12" :md="6"><el-card shadow="never" class="metric-card"><div class="metric-label">预计剩余</div><div class="metric-value">{{ kpi?.forecast_days ?? '-' }} 天</div><div class="metric-sub">剩余 {{ kpi?.remaining_hours ?? 0 }}h</div></el-card></el-col>
        </el-row>

        <el-row :gutter="12" class="section-row">
          <el-col :xs="24" :md="12">
            <el-card shadow="never">
              <template #header><span>路线健康问题（{{ health?.issue_count || 0 }}）</span></template>
              <el-scrollbar max-height="260px">
                <div v-if="!health?.issues?.length" class="empty-text">未发现明显问题</div>
                <div v-for="(issue, index) in health?.issues" :key="index" class="issue-row">
                  <el-tag size="small" :type="issue.level === 'error' ? 'danger' : issue.level === 'warning' ? 'warning' : 'info'">{{ issue.level }}</el-tag>
                  <span class="issue-text">{{ issue.message }}</span>
                </div>
              </el-scrollbar>
            </el-card>
          </el-col>
          <el-col :xs="24" :md="12">
            <el-card shadow="never">
              <template #header><span>阶段进度</span></template>
              <el-table :data="phases" size="small" max-height="260">
                <el-table-column prop="phase" label="阶段" min-width="100" />
                <el-table-column prop="node_count" label="节点" width="70" />
                <el-table-column prop="completed" label="完成" width="70" />
                <el-table-column prop="estimated_hours" label="工时" width="80" />
              </el-table>
            </el-card>
          </el-col>
        </el-row>

        <el-row :gutter="12" class="section-row">
          <el-col :xs="24" :md="8">
            <el-card shadow="never">
              <template #header><span>成本概览</span></template>
              <div class="cost-line"><span>标准人工</span><b>¥{{ cost?.total?.standard_labor ?? 0 }}</b></div>
              <div class="cost-line"><span>实际人工</span><b>¥{{ cost?.total?.actual_labor ?? 0 }}</b></div>
              <div class="cost-line"><span>外协计划/实际</span><b>¥{{ cost?.total?.external_planned ?? 0 }} / {{ cost?.total?.external_actual ?? 0 }}</b></div>
            </el-card>
          </el-col>
          <el-col :xs="24" :md="8">
            <el-card shadow="never">
              <template #header><span>工时与效率</span></template>
              <div class="cost-line"><span>标准/实际工时</span><b>{{ kpi?.planned_hours ?? 0 }}h / {{ kpi?.actual_hours ?? 0 }}h</b></div>
              <div class="cost-line"><span>工时偏差</span><b>{{ kpi?.hour_variance_pct ?? 0 }}%</b></div>
              <div class="cost-line"><span>返工/超期</span><b>{{ kpi?.rework_count ?? 0 }} / {{ kpi?.overdue_nodes ?? 0 }}</b></div>
            </el-card>
          </el-col>
          <el-col :xs="24" :md="8">
            <el-card shadow="never">
              <template #header><span>瓶颈工位</span></template>
              <div v-if="!kpi?.bottlenecks?.length" class="empty-text">暂无工位数据</div>
              <div v-for="item in kpi?.bottlenecks" :key="item.required_workstation_id" class="cost-line">
                <span>{{ item.workstation_name || ('工位#' + item.required_workstation_id) }}</span>
                <b>{{ item.hours }}h / {{ item.open_nodes }} 未完成</b>
              </div>
            </el-card>
          </el-col>
        </el-row>
      </el-tab-pane>

      <el-tab-pane label="依赖排程" name="schedule">
        <el-form inline>
          <el-form-item label="开始日期"><el-date-picker v-model="startDate" type="date" value-format="YYYY-MM-DD" style="width: 160px" /></el-form-item>
          <el-form-item label="每日工时"><el-input-number v-model="workdayHours" :min="1" :max="24" style="width: 110px" /></el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="scheduleLoading" @click="previewSchedule">预览（含依赖/关键路径）</el-button>
            <el-button type="success" :disabled="!scheduleRows.length" :loading="applying" @click="applySchedule">回写计划日期</el-button>
          </el-form-item>
        </el-form>
        <div class="hint">按工艺依赖（FS/SS/FF/SF + lag）与 CPM 计算最早开始/结束，再按工作日回写节点 planned_start/planned_end；回写前可预览。</div>
        <el-table :data="scheduleRows" size="small" max-height="420" show-overflow-tooltip>
          <el-table-column prop="node_id" label="节点" width="70" />
          <el-table-column prop="operation_name" label="工序" min-width="140" />
          <el-table-column prop="es_hours" label="最早开始(h)" width="100" />
          <el-table-column prop="slack_hours" label="浮动(h)" width="80" />
          <el-table-column prop="planned_start" label="计划开始" width="110" />
          <el-table-column prop="planned_end" label="计划结束" width="110" />
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="模板生成" name="templates">
        <el-form inline>
          <el-form-item label="路线模板">
            <el-select v-model="selectedTemplateId" placeholder="选择模板" style="width: 260px">
              <el-option v-for="tpl in templates" :key="tpl.id" :label="tpl.template_code + ' | ' + tpl.template_name" :value="tpl.id" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-button :loading="dryRunning" @click="generate(true)">试算</el-button>
            <el-button type="primary" :loading="generating" @click="generate(false)">按模板补齐</el-button>
          </el-form-item>
        </el-form>
        <div class="hint">按 BOM 全层级 + 部件类别匹配模板；已存在同部件同工序名会跳过，可重复执行。</div>
        <el-alert v-if="generateResult" :title="generateTitle" :type="generateResult.created_nodes ? 'success' : 'info'" :closable="true" show-icon />
      </el-tab-pane>

      <el-tab-pane label="版本与变更" name="versions">
        <div class="section-actions">
          <el-button size="small" type="primary" @click="createVersion">创建路线版本快照</el-button>
          <el-button size="small" @click="createChange">创建 ECN 变更单</el-button>
        </div>
        <el-row :gutter="12">
          <el-col :xs="24" :md="12">
            <el-card shadow="never">
              <template #header><span>版本</span></template>
              <el-table :data="versions" size="small" max-height="320">
                <el-table-column prop="version_no" label="版本" width="80" />
                <el-table-column prop="status" label="状态" width="90" />
                <el-table-column prop="node_count" label="节点" width="70" />
                <el-table-column label="操作" width="100">
                  <template #default="{ row }">
                    <el-button v-if="row.status === 'draft'" link type="primary" size="small" @click="releaseVersion(row)">发布</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </el-card>
          </el-col>
          <el-col :xs="24" :md="12">
            <el-card shadow="never">
              <template #header><span>变更单（ECN）</span></template>
              <el-table :data="changes" size="small" max-height="320">
                <el-table-column prop="change_no" label="变更号" width="150" />
                <el-table-column prop="title" label="标题" min-width="120" />
                <el-table-column prop="status" label="状态" width="90" />
                <el-table-column label="操作" width="100">
                  <template #default="{ row }">
                    <el-button v-if="row.status === 'draft' || row.status === 'review'" link type="success" size="small" @click="reviewChange(row, true)">批准</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </el-card>
          </el-col>
        </el-row>
      </el-tab-pane>
    </el-tabs>
  </el-drawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { processRouteUpgradeApi } from '../services/processRouteUpgradeApi.js'

const props = defineProps<{ modelValue: boolean; instanceId: number | null }>()
const emit = defineEmits<{ (event: 'update:modelValue', value: boolean): void; (event: 'changed'): void }>()

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const activeTab = ref('overview')
const loading = ref(false)
const health = ref<any>(null)
const kpi = ref<any>(null)
const phases = ref<any[]>([])
const cost = ref<any>(null)
const versions = ref<any[]>([])
const changes = ref<any[]>([])
const templates = ref<any[]>([])
const selectedTemplateId = ref<number | null>(null)
const dryRunning = ref(false)
const generating = ref(false)
const generateResult = ref<any>(null)
const startDate = ref(new Date().toISOString().slice(0, 10))
const workdayHours = ref(8)
const scheduleLoading = ref(false)
const scheduleRows = ref<any[]>([])
const applying = ref(false)

const scoreClass = computed(() => ({ 'is-good': (health.value?.score || 0) >= 90, 'is-warn': (health.value?.score || 0) < 75 }))
const scoreStatus = computed(() => (health.value?.score || 0) >= 90 ? 'success' : (health.value?.score || 0) >= 60 ? 'warning' : 'exception')
const generateTitle = computed(() => generateResult.value ? (generateResult.value.dry_run ? `试算：将补齐 ${generateResult.value.planned_nodes} 个节点 / ${generateResult.value.planned_hours}h` : `已补齐 ${generateResult.value.created_nodes} 个节点 / ${generateResult.value.created_hours} 条标准工时`) : '')

async function loadAll() {
  if (!props.instanceId) return
  loading.value = true
  try {
    const [healthData, kpiData, phasesData, costData, versionData, changeData, templateData] = await Promise.all([
      processRouteUpgradeApi.health(props.instanceId),
      processRouteUpgradeApi.kpi(props.instanceId),
      processRouteUpgradeApi.phases(props.instanceId),
      processRouteUpgradeApi.cost(props.instanceId),
      processRouteUpgradeApi.versions(props.instanceId),
      processRouteUpgradeApi.changes(props.instanceId),
      processRouteUpgradeApi.templates(),
    ])
    health.value = healthData
    kpi.value = kpiData
    phases.value = phasesData.items || []
    cost.value = costData
    versions.value = versionData.items || []
    changes.value = changeData.items || []
    templates.value = templateData.items || []
    if (!selectedTemplateId.value && templates.value.length) selectedTemplateId.value = templates.value[0].id
  } catch (error: any) {
    ElMessage.error('加载路线升级数据失败：' + (error?.message || error))
  } finally {
    loading.value = false
  }
}

async function previewSchedule() {
  if (!props.instanceId) return
  scheduleLoading.value = true
  try {
    const result = await processRouteUpgradeApi.schedulePreview(props.instanceId, { start_date: startDate.value, workday_hours: workdayHours.value })
    scheduleRows.value = result.rows || []
    ElMessage.success(`已生成预览：${scheduleRows.value.length} 个节点，总工期 ${result.project_hours}h`)
  } catch (error: any) {
    ElMessage.error('排程预览失败：' + (error?.message || error))
  } finally {
    scheduleLoading.value = false
  }
}

async function applySchedule() {
  if (!props.instanceId) return
  try { await ElMessageBox.confirm('将按预览回写全部节点计划日期，是否继续？', '回写计划日期', { type: 'warning' }) } catch { return }
  applying.value = true
  try {
    const result = await processRouteUpgradeApi.scheduleApply(props.instanceId, { start_date: startDate.value, workday_hours: workdayHours.value })
    ElMessage.success(`已回写 ${result.updated} 个节点计划日期`)
    emit('changed')
    await loadAll()
  } catch (error: any) {
    ElMessage.error('回写失败：' + (error?.message || error))
  } finally {
    applying.value = false
  }
}

async function generate(dryRun: boolean) {
  if (!props.instanceId || !selectedTemplateId.value) return
  const flag = dryRun ? dryRunning : generating
  flag.value = true
  try {
    if (!dryRun) {
      const plan = await processRouteUpgradeApi.generateFromTemplate(props.instanceId, { template_id: selectedTemplateId.value, dry_run: true })
      await ElMessageBox.confirm(`将按模板新增 ${plan.planned_nodes} 个工序节点（${plan.planned_hours}h），已存在同部件同工序名会跳过。是否继续？`, '按模板补齐', { type: 'warning' })
    }
    generateResult.value = await processRouteUpgradeApi.generateFromTemplate(props.instanceId, { template_id: selectedTemplateId.value, dry_run: dryRun })
    if (!dryRun) { ElMessage.success('已按模板补齐缺失工序'); emit('changed'); await loadAll() }
  } catch (error: any) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error('模板生成失败：' + (error?.message || error))
  } finally {
    flag.value = false
  }
}

async function createVersion() {
  if (!props.instanceId) return
  try {
    const { value } = await ElMessageBox.prompt('版本说明（可选）', '创建路线版本', { inputValue: '', confirmButtonText: '创建', cancelButtonText: '取消' })
    const result = await processRouteUpgradeApi.createVersion(props.instanceId, { note: value || null })
    ElMessage.success(`已创建版本 ${result.version_no}`)
    await loadAll()
  } catch (error: any) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error('创建版本失败：' + (error?.message || error))
  }
}

async function releaseVersion(row: any) {
  try { await ElMessageBox.confirm(`发布版本 ${row.version_no} 后，旧版本将作废，是否继续？`, '发布路线版本', { type: 'warning' }) } catch { return }
  try {
    await processRouteUpgradeApi.releaseVersion(row.id)
    ElMessage.success(`已发布 ${row.version_no}`)
    await loadAll()
  } catch (error: any) {
    ElMessage.error('发布失败：' + (error?.message || error))
  }
}

async function createChange() {
  if (!props.instanceId) return
  try {
    const { value } = await ElMessageBox.prompt('变更标题（例如：焊接工时调整）', '创建 ECN 变更单', { inputValue: '', confirmButtonText: '创建', cancelButtonText: '取消' })
    if (!value) return
    const result = await processRouteUpgradeApi.createChange(props.instanceId, { title: value })
    ElMessage.success(`已创建变更单 ${result.change_no}`)
    await loadAll()
  } catch (error: any) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error('创建变更单失败：' + (error?.message || error))
  }
}

async function reviewChange(row: any, approve: boolean) {
  try {
    await processRouteUpgradeApi.reviewChange(row.id, { approve, note: approve ? '批准' : '驳回' })
    ElMessage.success(approve ? '已批准' : '已驳回')
    await loadAll()
  } catch (error: any) {
    ElMessage.error('审批失败：' + (error?.message || error))
  }
}

watch(() => [props.modelValue, props.instanceId], ([open]) => { if (open) loadAll() }, { immediate: true })
</script>

<style scoped>
.drawer-title { display: flex; align-items: center; gap: 10px; font-weight: 700; }
.metric-card { margin-bottom: 12px; }
.metric-label { color: var(--color-text-secondary); font-size: 12px; }
.metric-value { font-size: 24px; font-weight: 700; margin: 4px 0; }
.metric-value.is-good { color: var(--color-success); }
.metric-value.is-warn { color: var(--color-warning); }
.metric-sub { color: var(--color-text-secondary); font-size: 12px; }
.section-row { margin-top: 12px; }
.issue-row { display: flex; align-items: flex-start; gap: 8px; padding: 6px 0; border-bottom: 1px dashed var(--color-border); }
.issue-text { font-size: 13px; line-height: 1.5; }
.cost-line { display: flex; justify-content: space-between; gap: 8px; padding: 4px 0; font-size: 13px; }
.hint { color: var(--color-text-secondary); font-size: 12px; margin: 8px 0 12px; }
.section-actions { display: flex; gap: 8px; margin-bottom: 12px; }
.empty-text { color: var(--color-text-secondary); text-align: center; padding: 16px; font-size: 13px; }
</style>
