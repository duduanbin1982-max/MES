<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title"><el-icon><Files /></el-icon> 工单管理</div>
      <el-button @click="load">刷新</el-button>
    </div>

    <el-tabs v-model="activeTab" @tab-change="onTabChange">
      <!-- ========== 工单列表 Tab ========== -->
      <el-tab-pane label="工单列表" name="list">
        <el-card style="margin-bottom: 16px">
          <el-form :inline="true" :model="filters">
            <el-form-item label="实例">
              <el-select v-model="filters.equipment_instance_id" clearable placeholder="全部" style="width: 220px">
                <el-option v-for="i in instances" :key="i.id" :label="i.instance_code + ' | ' + (i.instance_name || '')" :value="i.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="状态">
              <el-select v-model="filters.status" clearable placeholder="全部" style="width: 140px">
                <el-option v-for="s in statuses" :key="s.value" :label="s.label" :value="s.value" />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="load">查询</el-button>
              <el-button @click="resetFilters">重置</el-button>
            </el-form-item>
          </el-form>
        </el-card>

        <el-card>
          <div style="margin-bottom: 12px">
            <el-button-group>
              <el-button size="small" :type="quickFilter === 'all' ? 'primary' : ''" @click="setQuickFilter('all')">全部</el-button>
              <el-button size="small" :type="quickFilter === 'pending' ? 'primary' : ''" @click="setQuickFilter('pending')">待派工</el-button>
              <el-button size="small" :type="quickFilter === 'dispatched' ? 'primary' : ''" @click="setQuickFilter('dispatched')">已派工</el-button>
              <el-button size="small" :type="quickFilter === 'in_progress' ? 'primary' : ''" @click="setQuickFilter('in_progress')">进行中</el-button>
              <el-button size="small" :type="quickFilter === 'completed' ? 'primary' : ''" @click="setQuickFilter('completed')">已完成</el-button>
            </el-button-group>
            <el-button v-if="canDispatch" size="small" type="primary" style="margin-left: 12px" @click="openCreate">新建工单</el-button>
            <el-button
              v-if="canDispatch && missingPlanCount > 0"
              size="small"
              type="warning"
              plain
              :loading="backfilling"
              @click="backfillPlanDates"
            >补齐计划日期（{{ missingPlanCount }} 条）</el-button>
            <el-tag v-if="unplannedCount > 0" size="small" type="info" style="margin-left: 8px">另有 {{ unplannedCount }} 张完全未排期</el-tag>
          </div>

          <el-table :data="rows" stripe v-loading="loading" size="small" :row-class-name="woRowClass">
            <el-table-column prop="wo_code" label="工单号" width="160" />
            <el-table-column prop="instance_code" label="实例" width="140" />
            <el-table-column prop="subsystem_name" label="子系统" width="100" />
            <el-table-column prop="title" label="标题" min-width="200" />
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <el-tag :type="woStatusTagType(row.status)" size="small">{{ woStatusLabel(row.status) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="priority" label="优先级" width="80" align="center">
              <template #default="{ row }"><el-tag :type="priorityTagType(row.priority)" size="small">{{ row.priority }}</el-tag></template>
            </el-table-column>
            <el-table-column prop="assigned_name" label="派工" width="90">
              <template #default="{ row }">{{ row.assigned_name || '未派工' }}</template>
            </el-table-column>
            <el-table-column label="计划开始" width="110">
              <template #default="{ row }">{{ (row.planned_start || '').slice(0, 10) || '—' }}</template>
            </el-table-column>
            <el-table-column label="计划结束" width="110">
              <template #default="{ row }">{{ (row.planned_end || '').slice(0, 10) || '—' }}</template>
            </el-table-column>
            <el-table-column label="实际工时" width="100" align="right">
              <template #default="{ row }">{{ row.actual_hours ?? '-' }}</template>
            </el-table-column>
            <el-table-column label="实际开始" width="110">
              <template #default="{ row }">{{ (row.actual_start || '').slice(0, 10) || '—' }}</template>
            </el-table-column>
            <el-table-column label="实际结束" width="110">
              <template #default="{ row }">{{ (row.actual_end || '').slice(0, 10) || '—' }}</template>
            </el-table-column>
            <el-table-column label="操作" width="230" align="center" fixed="right">
              <template #default="{ row }">
                <el-button size="small" type="primary" link @click="openDetail(row)">详情</el-button>
                <el-button size="small" type="primary" link @click="checkKit(row)">齐套</el-button>
                <el-button size="small" type="primary" link @click="openTimeline(row)">流转</el-button>
                <el-button
                  v-if="canDispatch && !['completed', 'cancelled'].includes(row.status)"
                  size="small"
                  type="danger"
                  link
                  @click="cancelWorkOrder(row)"
                >取消</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <!-- ========== 待派工 Tab ========== -->
      <el-tab-pane label="待派工" name="dispatch">
        <el-card>
          <el-table :data="dispatchRows" stripe v-loading="dispatchLoading" size="small">
            <el-table-column prop="wo_code" label="工单号" width="160" />
            <el-table-column prop="title" label="标题" min-width="200" />
            <el-table-column prop="instance_code" label="实例" width="140" />
            <el-table-column label="优先级" width="80" align="center">
              <template #default="{ row }">
                <el-tag :type="priorityTagType(row.priority)" size="small">{{ row.priority }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="计划开始" width="110">
              <template #default="{ row }">{{ (row.planned_start || '').slice(0, 10) }}</template>
            </el-table-column>
            <el-table-column label="计划结束" width="110">
              <template #default="{ row }">{{ (row.planned_end || '').slice(0, 10) }}</template>
            </el-table-column>
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <el-tag :type="woStatusTagType(row.status)" size="small">{{ woStatusLabel(row.status) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="100" align="center" fixed="right">
              <template #default="{ row }">
                <el-button size="small" type="primary" :disabled="!canDispatch" @click="openDispatch(row)">派工</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <!-- 新建工单（2026-11-05） -->
    <el-dialog v-model="createDlg.show" title="新建工单" width="560px">
      <el-form :model="createDlg.form" label-width="100px" size="small">
        <el-form-item label="项目" required>
          <el-select v-model="createDlg.form.equipment_instance_id" placeholder="选择项目" style="width: 100%" filterable>
            <el-option v-for="i in instances" :key="i.id" :label="i.instance_code + ' | ' + (i.instance_name || '')" :value="i.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="工单号" required>
          <el-input v-model="createDlg.form.wo_code" placeholder="如 WO-2026-001" />
        </el-form-item>
        <el-form-item label="标题" required>
          <el-input v-model="createDlg.form.title" placeholder="工单内容" />
        </el-form-item>
        <el-form-item label="预估工时">
          <el-input-number v-model="createDlg.form.estimated_hours" :min="0" :step="1" style="width: 100%" />
        </el-form-item>
        <el-form-item label="计划开始">
          <el-date-picker v-model="createDlg.form.planned_start" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" style="width: 100%" />
        </el-form-item>
        <el-form-item label="计划结束">
          <el-date-picker v-model="createDlg.form.planned_end" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" style="width: 100%" />
        </el-form-item>
        <el-form-item label="优先级">
          <el-radio-group v-model="createDlg.form.priority">
            <el-radio :value="1">紧急</el-radio>
            <el-radio :value="2">高</el-radio>
            <el-radio :value="3">普通</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDlg.show = false">取消</el-button>
        <el-button type="primary" :loading="createDlg.loading" @click="submitCreate">创建</el-button>
      </template>
    </el-dialog>

    <!-- 工单详情（2026-11-05） -->
    <el-drawer v-model="detailDlg.show" :title="'工单详情：' + (detailDlg.data?.wo_code || '')" size="560px">
      <div v-if="detailDlg.loading" v-loading="true" style="height:120px"></div>
      <template v-else-if="detailDlg.data">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="状态">{{ woStatusLabel(detailDlg.data.status) }}</el-descriptions-item>
          <el-descriptions-item label="优先级">{{ detailDlg.data.priority }}</el-descriptions-item>
          <el-descriptions-item label="项目">{{ detailDlg.data.instance_code }}</el-descriptions-item>
          <el-descriptions-item label="子系统">{{ detailDlg.data.subsystem_name || '—' }}</el-descriptions-item>
          <el-descriptions-item label="计划开始">{{ detailDlg.data.planned_start || '—' }}</el-descriptions-item>
          <el-descriptions-item label="计划结束">{{ detailDlg.data.planned_end || '—' }}</el-descriptions-item>
          <el-descriptions-item label="实际开始">{{ detailDlg.data.actual_start || '—' }}</el-descriptions-item>
          <el-descriptions-item label="实际结束">{{ detailDlg.data.actual_end || '—' }}</el-descriptions-item>
          <el-descriptions-item label="派工人员">{{ detailDlg.data.assigned_name || '未派工' }}</el-descriptions-item>
          <el-descriptions-item label="实际工时">{{ detailDlg.data.actual_hours ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="计划数量">{{ detailDlg.data.quantity_planned ?? 1 }}</el-descriptions-item>
          <el-descriptions-item label="完成数量">{{ detailDlg.data.quantity_completed ?? 0 }}</el-descriptions-item>
        </el-descriptions>
        <div class="detail-section-title">操作 / 报工流水（{{ detailDlg.data.operations?.length || 0 }} 条）</div>
        <el-table :data="detailDlg.data.operations || []" size="small" border max-height="260">
          <el-table-column prop="action" label="动作" width="90" />
          <el-table-column prop="hours_worked" label="工时" width="80" align="right" />
          <el-table-column prop="quantity_completed" label="数量" width="70" align="right" />
          <el-table-column prop="defect_quantity" label="缺陷" width="70" align="right" />
          <el-table-column prop="timestamp" label="时间" min-width="150" />
          <el-table-column prop="notes" label="备注" min-width="120" />
        </el-table>
      </template>
    </el-drawer>

    <!-- 齐套检查弹窗 -->
    <el-dialog v-model="kitDlg.show" :title="'齐套检查: ' + kitDlg.wo_code" width="600px">
      <div v-if="kitDlg.loading" v-loading="true" style="height:100px"></div>
      <div v-else-if="kitDlg.result">
        <el-row :gutter="16" style="margin-bottom:12px">
          <el-col :span="8"><el-card shadow="hover"><el-statistic title="齐套率" :value="kitDlg.result.kit_rate" suffix="%">
            <template #suffix><el-tag :type="kitDlg.result.kit_rate >= 100 ? 'success' : kitDlg.result.kit_rate >= 70 ? 'warning' : 'danger'" size="small">{{ kitDlg.result.kit_rate >= 100 ? '齐全' : kitDlg.result.kit_rate >= 70 ? '部分缺料' : '严重缺料' }}</el-tag></template>
          </el-statistic></el-card></el-col>
          <el-col :span="8"><el-card shadow="hover"><el-statistic title="需料项" :value="kitDlg.result.total_items"/></el-card></el-col>
          <el-col :span="8"><el-card shadow="hover"><el-statistic title="缺料项" :value="kitDlg.result.short_items"><template #suffix><el-tag v-if="kitDlg.result.short_items > 0" type="danger" size="small">!</el-tag></template></el-statistic></el-card></el-col>
        </el-row>
        <el-table :data="kitDlg.result.items||[]" size="small" border max-height="300">
          <el-table-column prop="material_code" label="物料编码" width="100" />
          <el-table-column prop="material_name" label="名称" min-width="140" />
          <el-table-column prop="required_qty" label="需求量" width="80" align="right" />
          <el-table-column prop="available_qty" label="库存" width="80" align="right" />
          <el-table-column prop="shortage_qty" label="缺料" width="80" align="right">
            <template #default="{row}"><span :style="{color: row.shortage_qty > 0 ? 'var(--el-color-danger)' : 'var(--el-color-success)', fontWeight: 'bold'}">{{ row.shortage_qty }}</span></template>
          </el-table-column>
          <el-table-column label="状态" width="80" align="center">
            <template #default="{row}"><el-tag :type="row.shortage_qty > 0 ? 'danger' : 'success'" size="small">{{ row.shortage_qty > 0 ? '缺料' : '充足' }}</el-tag></template>
          </el-table-column>
        </el-table>
      </div>
      <template #footer><el-button @click="kitDlg.show = false">关闭</el-button></template>
    </el-dialog>

    <!-- 派工弹窗 -->
    <el-dialog v-model="dispatchDlg.show" title="派工确认" width="500px">
      <el-form :model="dispatchDlg.form" label-width="100px">
        <el-form-item label="工单号">
          <el-input :model-value="dispatchDlg.wo_code" disabled />
        </el-form-item>
        <el-form-item label="派工人员" required>
          <el-select v-model="dispatchDlg.form.user_id" placeholder="选择人员" style="width: 100%">
            <el-option v-for="w in workers" :key="w.id" :label="w.display_name || w.username" :value="w.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="工位" required>
          <el-select v-model="dispatchDlg.form.workstation_id" placeholder="选择工位" style="width: 100%">
            <el-option v-for="ws in workstations" :key="ws.id" :label="ws.name || ws.workstation_code" :value="ws.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="计划开始">
          <el-date-picker v-model="dispatchDlg.form.planned_start" type="date" placeholder="选择日期" style="width: 100%" />
        </el-form-item>
        <el-form-item label="计划结束">
          <el-date-picker v-model="dispatchDlg.form.planned_end" type="date" placeholder="选择日期" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dispatchDlg.show = false">取消</el-button>
        <el-button type="primary" @click="confirmDispatch" :loading="dispatchDlg.loading">确认派工</el-button>
      </template>
    </el-dialog>

    <!-- 工单流转审计抽屉（2026-10-17 选项 ii 后半段：可用动作 + workflow_history） -->
    <el-drawer v-model="timelineDlg.show" :title="'工单流转：' + (timelineDlg.wo_code || '')" size="520px">
      <WorkflowTimeline
        v-if="timelineDlg.show && timelineDlg.wo_id"
        entity-type="work_order"
        :entity-id="timelineDlg.wo_id"
        @changed="onTimelineChanged"
      />
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, reactive, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Api } from '../api'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAuthStore } from '../stores/auth'
import type { KitCheckResult } from '../types/api'
import WorkflowTimeline from '../components/WorkflowTimeline.vue'

const route = useRoute()
const router = useRouter()
const tabNames = new Set(['list', 'dispatch'])
const routeTab = () => {
  const value = String(route.query.tab || '')
  return tabNames.has(value) ? value : 'list'
}
const activeTab = ref(routeTab())
const quickFilter = ref('all')

const filters = reactive({ equipment_instance_id: undefined as any, status: '' })
const routeInstanceId = () => Number(route.query.instance_id || route.query.equipment_instance_id || 0) || undefined
const applyRouteInstanceFilter = () => {
  const id = routeInstanceId()
  if (id) filters.equipment_instance_id = id
}
applyRouteInstanceFilter()
const instances = ref<any[]>([])
const rows = ref<any[]>([])
const loading = ref(false)
const kitDlg = reactive<{ show: boolean; wo_code: string; loading: boolean; result: KitCheckResult | null }>({ show: false, wo_code: '', loading: false, result: null })
const checkKit = async (row: any) => { kitDlg.show = true; kitDlg.wo_code = row.wo_code; kitDlg.loading = true; try { kitDlg.result = await Api.get('/work_orders/'+row.id+'/kit-check') } catch(_) { kitDlg.result = null } finally { kitDlg.loading = false } }

// 待派工
const dispatchRows = ref<any[]>([])
const dispatchLoading = ref(false)
const workers = ref<any[]>([])
const workstations = ref<any[]>([])
const dispatchDlg = reactive({
  show: false,
  wo_code: '',
  loading: false,
  form: {
    user_id: null as number | null,
    workstation_id: null as number | null,
    planned_start: null as string | null,
    planned_end: null as string | null
  }
})

// 2026-11-05（审计）：状态集合与 app/workflow/workOrderDefinition 对齐
// 原前端缺 dispatched/cancelled，列表直接显示英文原值
const statuses = [
  { value: 'pending', label: '待派工' },
  { value: 'dispatched', label: '已派工' },
  { value: 'in_progress', label: '进行中' },
  { value: 'paused', label: '已暂停' },
  { value: 'completed', label: '已完成' },
  { value: 'cancelled', label: '已取消' },
]
const STATUS_LABELS: Record<string, string> = {
  pending: '待派工', dispatched: '已派工', in_progress: '进行中', paused: '已暂停', completed: '已完成', cancelled: '已取消',
  issue: '异常', rework: '返工',
}
const woStatusLabel = (s: string) => STATUS_LABELS[s] || s || '-'
const woStatusTagType = (s: string) => ({ pending: 'info', dispatched: 'warning', in_progress: 'primary', paused: 'warning', completed: 'success', cancelled: 'info', issue: 'danger', rework: 'danger' }[s] || 'info')

// 派工权限：需要 work_order:write 且角色是主任/计划员/管理员（与后端 onlyForemanAdminOrPlanner 对齐）
const auth = useAuthStore()
const canDispatch = computed(() => auth.hasPerm('work_order:write') && ['admin', 'foreman', 'planner'].includes(auth.role))
const errorText = (error: any, fallback: string) => error?.response?.data?.message || error?.response?.data?.error || error?.message || fallback
const priorityTagType = (p: number) => (p === 1 ? 'danger' : p === 2 ? 'warning' : 'info')

const setQuickFilter = (val: string) => {
  quickFilter.value = val
  if (val === 'all') {
    filters.status = ''
  } else {
    filters.status = val
  }
  load()
}

const resetFilters = () => { filters.equipment_instance_id = undefined; filters.status = ''; quickFilter.value = 'all'; load() }

// 2026-11-05：从单项目甘特点「工单长运行」告警跳过来时，高亮并滚动到该工单
const highlightWo = ref<string>('')
const woRowClass = ({ row }: { row: any }) => (highlightWo.value && row.wo_code === highlightWo.value ? 'wo-row-highlight' : '')
const focusWorkOrder = async () => {
  const wo = String(route.query.wo || '')
  highlightWo.value = wo
  if (!wo) return
  await nextTick()
  const el = document.querySelector('.wo-row-highlight') as HTMLElement | null
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

const load = async () => {
  loading.value = true
  try {
    const params: any = {}
    if (filters.equipment_instance_id) params.equipment_instance_id = filters.equipment_instance_id
    if (filters.status) params.status = filters.status
    rows.value = await Api.workOrders(params)
    if (instances.value.length === 0) instances.value = await Api.instances()
  } finally {
    loading.value = false
  }
  await focusWorkOrder()
}

const loadDispatchable = async () => {
  dispatchLoading.value = true
  try {
    dispatchRows.value = await Api.get('/work_orders/dispatchable')
  } catch (_) {
    dispatchRows.value = []
  } finally {
    dispatchLoading.value = false
  }
}

const loadWorkersAndStations = async () => {
  try {
    const allWorkers = await Api.get('/resources/workers')
    // F-bug-fix: /resources/workers returns {workers, summary}; unwrap defensively
    const workersArr = Array.isArray(allWorkers) ? allWorkers : (allWorkers?.workers || [])
    workers.value = workersArr.filter((w: any) => w.availability !== 'offline')
    workstations.value = await Api.workstations()
  } catch (error: any) {
    workers.value = []
    workstations.value = []
    ElMessage.error(error?.message || '人员与工位加载失败')
  }
}

const onTabChange = (name: string | number) => {
  const value = String(name)
  if (route.query.tab !== value) router.replace({ query: { ...route.query, tab: value } })
  if (value === 'dispatch') {
    loadDispatchable()
    if (workers.value.length === 0) loadWorkersAndStations()
  } else {
    load()
  }
}

watch(() => route.query.wo, () => { focusWorkOrder() })

watch(() => route.query.tab, () => {
  const next = routeTab()
  if (next !== activeTab.value) {
    activeTab.value = next
    onTabChange(next)
  }
})

watch(() => [route.query.instance_id, route.query.equipment_instance_id], async () => {
  const before = filters.equipment_instance_id
  applyRouteInstanceFilter()
  if (filters.equipment_instance_id !== before) await load()
})

const openDispatch = (row: any) => {
  dispatchDlg.show = true
  dispatchDlg.wo_code = row.wo_code
  dispatchDlg.form = {
    user_id: null,
    workstation_id: null,
    planned_start: row.planned_start || null,
    planned_end: row.planned_end || null
  }
  if (workers.value.length === 0) loadWorkersAndStations()
}

const confirmDispatch = async () => {
  if (!dispatchDlg.form.user_id) { ElMessage.warning('请选择派工人员'); return }
  if (!dispatchDlg.form.workstation_id) { ElMessage.warning('请选择工位'); return }
  dispatchDlg.loading = true
  try {
    const row = dispatchRows.value.find((r: any) => r.wo_code === dispatchDlg.wo_code)
    const id = row?.id
    await Api.put(`/work_orders/${id}/dispatch`, {
      user_id: dispatchDlg.form.user_id,
      workstation_id: dispatchDlg.form.workstation_id,
      planned_start: dispatchDlg.form.planned_start,
      planned_end: dispatchDlg.form.planned_end
    })
    ElMessage.success('派工成功')
    dispatchDlg.show = false
    loadDispatchable()
    load()
  } catch (e: any) {
    ElMessage.error(errorText(e, '派工失败'))
  } finally {
    dispatchDlg.loading = false
  }
}

// ------------------------------------------------------------ 新建工单
const createDlg = reactive({
  show: false,
  loading: false,
  form: {
    equipment_instance_id: null as any,
    wo_code: '',
    title: '',
    estimated_hours: 8 as number | null,
    planned_start: null as string | null,
    planned_end: null as string | null,
    priority: 3,
  },
})
const openCreate = () => {
  createDlg.form = { equipment_instance_id: filters.equipment_instance_id || null, wo_code: '', title: '', estimated_hours: 8, planned_start: null, planned_end: null, priority: 3 }
  createDlg.show = true
}
const submitCreate = async () => {
  const form = createDlg.form
  if (!form.equipment_instance_id || !form.wo_code || !form.title) { ElMessage.warning('项目、工单号、标题必填'); return }
  createDlg.loading = true
  try {
    await Api.post('/work_orders', { ...form })
    ElMessage.success('工单已创建')
    createDlg.show = false
    await load()
    loadDispatchable()
  } catch (error: any) {
    ElMessage.error(errorText(error, '创建失败'))
  } finally {
    createDlg.loading = false
  }
}

// ------------------------------------------------------------ 详情
const detailDlg = reactive<{ show: boolean; loading: boolean; data: any }>({ show: false, loading: false, data: null })
const openDetail = async (row: any) => {
  detailDlg.show = true
  detailDlg.loading = true
  detailDlg.data = null
  try {
    detailDlg.data = await Api.get('/work_orders/' + row.id)
  } catch (error: any) {
    ElMessage.error(errorText(error, '加载详情失败'))
  } finally {
    detailDlg.loading = false
  }
}

// ------------------------------------------------------------ 取消工单
const cancelWorkOrder = async (row: any) => {
  try {
    await ElMessageBox.confirm(
      `取消工单 ${row.wo_code}？取消后不可恢复，已发生的报工记录会保留。`,
      '取消工单',
      { type: 'warning', confirmButtonText: '取消工单', cancelButtonText: '返回' },
    )
  } catch { return }
  try {
    await Api.post(`/work_orders/${row.id}/cancel`, {})
    ElMessage.success('工单已取消')
    await load()
    loadDispatchable()
  } catch (error: any) {
    ElMessage.error(errorText(error, '取消失败'))
  }
}

// ------------------------------------------------------------ 计划日期补齐
const backfilling = ref(false)
// 可自动补齐 = 只有一端缺失（两边都空的需要手工排，不纳入按钮计数）
const missingPlanCount = computed(() => rows.value.filter((row: any) => (!row.planned_start && row.planned_end) || (row.planned_start && !row.planned_end)).length)
const unplannedCount = computed(() => rows.value.filter((row: any) => !row.planned_start && !row.planned_end).length)
const backfillPlanDates = async () => {
  try {
    await ElMessageBox.confirm(
      `将按「预估工时」为 ${missingPlanCount.value} 张缺少计划时间的工单补齐（有结束时间的回推开始，有开始时间的推算结束，两边都空的留给手工排）。`,
      '补齐计划日期',
      { type: 'warning' },
    )
  } catch { return }
  backfilling.value = true
  try {
    const result: any = await Api.post('/work_orders/backfill-dates', {})
    ElMessage.success(`已补齐 ${result.updated || 0} 张工单的计划时间`)
    await load()
  } catch (error: any) {
    ElMessage.error(errorText(error, '补齐失败'))
  } finally {
    backfilling.value = false
  }
}

// 流转审计抽屉
const timelineDlg = reactive({ show: false, wo_id: 0, wo_code: '' })
function openTimeline(row: any) {
  timelineDlg.wo_id = row.id
  timelineDlg.wo_code = row.wo_code
  timelineDlg.show = true
}
function onTimelineChanged() {
  load()
}

onMounted(() => {
  load()
  loadWorkersAndStations()
  if (activeTab.value === 'dispatch') loadDispatchable()
})
</script>

<style scoped>
.detail-section-title {
  margin: 14px 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

/* 2026-11-05：从单项目甘特告警跳转过来时高亮目标工单 */
:deep(.wo-row-highlight) td {
  background: var(--el-color-warning-light-8) !important;
}
</style>
