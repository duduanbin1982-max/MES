<template>
  <div class="process-hours-page">
    <div class="page-header">
      <h2>工时定额与报工</h2>
    </div>

    <el-tabs v-model="activeTab" @tab-change="onTabChange">
      <!-- Tab 1: 工时定额管理 -->
      <el-tab-pane label="工时定额" name="hours">
        <div class="tab-toolbar">
          <el-select v-model="selectedInstance" placeholder="选择装备实例" @change="loadHoursSummary" style="width: 280px">
            <el-option v-for="inst in instances" :key="inst.id" :label="inst.instance_code + ' ' + (inst.instance_name || '')" :value="inst.id" />
          </el-select>
          <el-tag type="info" v-if="hoursSummary.total_man_hours">总定额: {{ hoursSummary.total_man_hours }} 工时</el-tag>
        </div>
        <el-table :data="hoursSummary.details || []" v-loading="hoursLoading" empty-text="请先选择装备实例" border stripe size="small" max-height="500">
          <el-table-column prop="node_id" label="节点ID" width="70" />
          <el-table-column prop="operation_name" label="工序名" min-width="140" />
          <el-table-column prop="work_type" label="工种" width="80">
            <template #default="{ row }">
              <el-tag size="small" :type="workTypeTag(row.work_type)">{{ workTypeLabel(row.work_type) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="standard_hours" label="标准工时(h)" width="100" align="right" />
          <el-table-column prop="worker_count" label="定员" width="60" align="center" />
          <el-table-column prop="man_hours" label="人时" width="80" align="right" />
          <el-table-column label="操作" width="120" align="center">
            <template #default="{ row }">
              <el-button size="small" type="primary" link @click="openHoursDialog(row)">编辑</el-button>
              <el-button size="small" type="danger" link @click="deleteHours(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- Tab 2: 工序报工 -->
      <el-tab-pane label="工序报工" name="reports">
        <div class="tab-toolbar">
          <el-select v-model="reportFilter.work_order_id" placeholder="筛选工单" clearable style="width: 200px" @change="loadReports">
            <el-option v-for="wo in workOrders" :key="wo.id" :label="wo.wo_code" :value="wo.id" />
          </el-select>
          <el-date-picker v-model="reportFilter.dateRange" type="daterange" range-separator="→" start-placeholder="开始" end-placeholder="结束" value-format="YYYY-MM-DD" @change="loadReports" style="width: 260px" />
          <el-button type="primary" @click="loadReports">查询</el-button>
          <el-button @click="showReportDialog = true">+ 新增报工</el-button>
        </div>
        <el-table :data="reports" v-loading="reportsLoading" empty-text="暂无报工记录" border stripe size="small" max-height="450">
          <el-table-column prop="wo_code" label="工单" width="100" />
          <el-table-column prop="operation_name" label="工序" min-width="120" />
          <el-table-column prop="worker_name" label="工人" width="80" />
          <el-table-column prop="work_type" label="工种" width="80">
            <template #default="{ row }"><el-tag size="small">{{ workTypeLabel(row.work_type) }}</el-tag></template>
          </el-table-column>
          <el-table-column prop="hours_spent" label="工时" width="70" align="right" />
          <el-table-column prop="quantity_completed" label="数量" width="70" align="right" />
          <el-table-column prop="quality_result" label="质量" width="70" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="row.quality_result === 'pass' ? 'success' : 'danger'">{{ row.quality_result === 'pass' ? '合格' : row.quality_result }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="reported_at" label="报工时间" width="160" />
          <el-table-column prop="notes" label="备注" min-width="100" show-overflow-tooltip />
        </el-table>
      </el-tab-pane>

      <!-- Tab 3: 日汇总 -->
      <el-tab-pane label="日汇总" name="daily">
        <div class="tab-toolbar">
          <el-date-picker v-model="dailyDate" type="date" placeholder="选择日期" value-format="YYYY-MM-DD" @change="loadDailySummary" style="width: 180px" />
          <el-tag type="success" v-if="dailySummary.workers">共 {{ dailySummary.workers }} 人报工</el-tag>
        </div>
        <el-table :data="dailySummary.details || []" v-loading="dailyLoading" empty-text="请选择日期" border stripe size="small" max-height="450">
          <el-table-column prop="worker_name" label="工人" width="100" />
          <el-table-column prop="work_type" label="工种" width="100">
            <template #default="{ row }"><el-tag size="small">{{ workTypeLabel(row.work_type) }}</el-tag></template>
          </el-table-column>
          <el-table-column prop="report_count" label="报工次数" width="90" align="center" />
          <el-table-column prop="total_hours" label="总工时(h)" width="100" align="right" />
          <el-table-column prop="total_qty" label="总数量" width="80" align="right" />
          <el-table-column label="占比" min-width="150">
            <template #default="{ row }">
              <el-progress :percentage="dailyTotalHours > 0 ? Math.round(row.total_hours / dailyTotalHours * 100) : 0" :format="() => (dailyTotalHours > 0 ? Math.round(row.total_hours / dailyTotalHours * 100) : 0) + '%'" />
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- Tab 4: 完工进度 -->
      <el-tab-pane label="完工进度" name="progress">
        <div class="tab-toolbar">
          <el-select v-model="selectedNodeId" placeholder="选择工艺节点" filterable @change="onNodeSelect" style="width: 280px">
            <el-option v-for="n in processNodes" :key="n.id" :label="'#' + n.id + ' ' + (n.operation_name || '')" :value="n.id" />
          </el-select>
        </div>
        <div v-if="nodeProgress.process_node_id" class="progress-cards">
          <el-row :gutter="16">
            <el-col :span="6"><el-card shadow="hover"><el-statistic title="已报工时" :value="nodeProgress.total_hours_reported" suffix="h" /></el-card></el-col>
            <el-col :span="6"><el-card shadow="hover"><el-statistic title="标准定额" :value="nodeProgress.standard_man_hours" suffix="人时" /></el-card></el-col>
            <el-col :span="6"><el-card shadow="hover"><el-statistic title="报工次数" :value="nodeProgress.report_count" /></el-card></el-col>
            <el-col :span="6"><el-card shadow="hover"><el-statistic title="完工率" :value="nodeProgress.completion_pct" suffix="%" /></el-card></el-col>
          </el-row>
          <el-progress :percentage="nodeProgress.completion_pct" :stroke-width="20" style="margin: 16px 0" />
          <el-table :data="nodeProgress.recent_reports || []" border stripe size="small" max-height="300" style="margin-top: 12px">
            <el-table-column prop="wo_code" label="工单" width="100" />
            <el-table-column prop="worker_name" label="工人" width="80" />
            <el-table-column prop="hours_spent" label="工时" width="70" align="right" />
            <el-table-column prop="quantity_completed" label="数量" width="70" align="right" />
            <el-table-column prop="reported_at" label="报工时间" width="160" />
            <el-table-column prop="notes" label="备注" show-overflow-tooltip />
          </el-table>
        </div>
        <el-empty v-else description="请选择工艺节点查看进度" />
      </el-tab-pane>

      <!-- Tab 5: 工人绩效 -->
      <el-tab-pane label="工人绩效" name="worker-perf">
        <div class="tab-toolbar">
          <el-date-picker v-model="perfFilter.dateRange" type="daterange" range-separator="→" start-placeholder="开始" end-placeholder="结束" value-format="YYYY-MM-DD" @change="loadWorkerPerformance" style="width:260px" />
        </div>

        <el-row :gutter="12" style="margin-bottom:12px" v-if="perfSummary.avg_efficiency">
          <el-col :span="8"><div class="stat-card"><div class="stat-label">平均效率</div><div class="stat-value" style="color:#67c23a">{{ perfSummary.avg_efficiency }}%</div></div></el-col>
          <el-col :span="8"><div class="stat-card"><div class="stat-label">总工时</div><div class="stat-value">{{ perfSummary.total_hours_sum }}h</div></div></el-col>
          <el-col :span="8"><div class="stat-card"><div class="stat-label">总任务数</div><div class="stat-value">{{ perfSummary.total_tasks }}</div></div></el-col>
        </el-row>

        <el-table :data="workerPerfData" v-loading="perfLoading" border stripe size="small" empty-text="请选择日期范围" max-height="400">
          <el-table-column prop="full_name" label="姓名" width="100" />
          <el-table-column prop="total_hours" label="总工时(h)" width="100" align="right" sortable />
          <el-table-column prop="standard_hours" label="标准工时(h)" width="110" align="right" />
          <el-table-column label="效率" min-width="180">
            <template #default="{row}">
              <div style="display:flex;align-items:center;gap:8px">
                <el-progress :percentage="Math.min(100, row.efficiency_pct||0)" :status="row.efficiency_pct>=100?'success':row.efficiency_pct>=80?'':'exception'" style="flex:1" />
                <span style="font-weight:600;min-width:45px">{{ row.efficiency_pct || 0 }}%</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="tasks_completed" label="完成任务数" width="100" align="right" sortable />
          <el-table-column prop="avg_quality_score" label="平均质量分" width="110" align="right" sortable />
        </el-table>
      </el-tab-pane>

      <!-- Tab 6: 加班统计 -->
      <el-tab-pane label="加班统计" name="overtime">
        <div class="tab-toolbar">
          <el-date-picker v-model="otFilter.dateRange" type="daterange" range-separator="→" start-placeholder="开始" end-placeholder="结束" value-format="YYYY-MM-DD" @change="loadOvertime" style="width:260px" />
        </div>

        <div v-if="otSummary.total_overtime" style="margin-bottom:12px">
          <el-tag type="warning" size="large">总加班: {{ otSummary.total_overtime }}h</el-tag>
          <el-tag type="info" size="large" style="margin-left:8px">涉及 {{ otSummary.worker_count }} 人</el-tag>
        </div>

        <el-table :data="overtimeData" v-loading="otLoading" border stripe size="small" empty-text="请选择日期范围" max-height="400">
          <el-table-column prop="user_name" label="工人" width="100" />
          <el-table-column prop="date" label="日期" width="120" sortable />
          <el-table-column prop="total_hours" label="总工时(h)" width="100" align="right" />
          <el-table-column prop="overtime_hours" label="加班工时(h)" width="110" align="right" sortable>
            <template #default="{row}">
              <span :style="{color:row.overtime_hours>3?'#f56c6c':row.overtime_hours>0?'#e6a23c':'#909399',fontWeight:'600'}">{{ row.overtime_hours }}</span>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

    </el-tabs>

    <!-- 工时定额编辑弹窗 -->
    <el-dialog v-model="showHoursEdit" title="编辑工时定额" width="450px">
      <el-form :model="hoursForm" label-width="100px">
        <el-form-item label="工序">{{ hoursForm.operation_name }}</el-form-item>
        <el-form-item label="工种">
          <el-select v-model="hoursForm.work_type" style="width: 100%">
            <el-option label="装配" value="assembly" />
            <el-option label="焊接" value="welding" />
            <el-option label="机加" value="machining" />
            <el-option label="测试" value="testing" />
            <el-option label="质检" value="qc" />
          </el-select>
        </el-form-item>
        <el-form-item label="标准工时(h)">
          <el-input-number v-model="hoursForm.standard_hours" :min="0" :step="0.5" :precision="1" style="width: 100%" />
        </el-form-item>
        <el-form-item label="定员(人)">
          <el-input-number v-model="hoursForm.worker_count" :min="1" :max="50" style="width: 100%" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="hoursForm.description" placeholder="工艺要求等" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showHoursEdit = false">取消</el-button>
        <el-button type="primary" @click="saveHours" :loading="hoursSaving">保存</el-button>
      </template>
    </el-dialog>

    <!-- 新增报工弹窗 -->
    <el-dialog v-model="showReportDialog" title="新增报工" width="450px">
      <el-form :model="reportForm" label-width="100px">
        <el-form-item label="工单" required>
          <el-select v-model="reportForm.work_order_id" filterable style="width: 100%">
            <el-option v-for="wo in workOrders" :key="wo.id" :label="wo.wo_code + ' ' + wo.title" :value="wo.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="工艺节点">
          <el-select v-model="reportForm.process_node_id" filterable clearable style="width: 100%">
            <el-option v-for="n in processNodes" :key="n.id" :label="'#' + n.id + ' ' + (n.operation_name || '')" :value="n.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="工时(h)" required>
          <el-input-number v-model="reportForm.hours_spent" :min="0" :step="0.5" style="width: 100%" />
        </el-form-item>
        <el-form-item label="完成数量">
          <el-input-number v-model="reportForm.quantity_completed" :min="0" style="width: 100%" />
        </el-form-item>
        <el-form-item label="质量结果">
          <el-select v-model="reportForm.quality_result" style="width: 100%">
            <el-option label="合格" value="pass" />
            <el-option label="返工" value="rework" />
            <el-option label="报废" value="scrap" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="reportForm.notes" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showReportDialog = false">取消</el-button>
        <el-button type="primary" @click="submitReport" :loading="reportSaving">提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { Api } from '../api'
import { ElMessage, ElMessageBox } from 'element-plus'

const activeTab = ref('hours')

// 公共数据
const instances = ref([])
const workOrders = ref([])
const processNodes = ref([])
const selectedInstance = ref(null)

// Tab 1: 工时定额
const hoursSummary = reactive({ total_man_hours: 0, details: [] })
const hoursLoading = ref(false)
const showHoursEdit = ref(false)
const hoursSaving = ref(false)
const hoursForm = reactive({ node_id: 0, operation_name: '', work_type: 'assembly', standard_hours: 8, worker_count: 2, description: '' })

// Tab 2: 工序报工
const reports = ref([])
const reportsLoading = ref(false)
const reportFilter = reactive({ work_order_id: null, dateRange: null })
const showReportDialog = ref(false)
const reportSaving = ref(false)
const reportForm = reactive({ work_order_id: null, process_node_id: null, hours_spent: 0, quantity_completed: 0, quality_result: 'pass', notes: '' })

// Tab 3: 日汇总
const dailySummary = reactive({ workers: 0, details: [] })
const dailyLoading = ref(false)
const dailyDate = ref(new Date().toISOString().substring(0, 10))
const dailyTotalHours = computed(() => (dailySummary.details || []).reduce((s, r) => s + (r.total_hours || 0), 0))

// Tab 4: 完工进度
const selectedNodeId = ref(null)
const nodeProgress = reactive({ process_node_id: 0, total_hours_reported: 0, standard_man_hours: 0, completion_pct: 0, recent_reports: [] })

// 工种映射
const workTypeTag = (t) => ({ assembly: '', welding: 'warning', machining: 'danger', testing: 'info', qc: 'success' }[t] || '')
const workTypeLabel = (t) => ({ assembly: '装配', welding: '焊接', machining: '机加', testing: '测试', qc: '质检' }[t] || t)

// 加载公共数据
const loadCommonData = async () => {
  try {
    const [instRes, woRes] = await Promise.all([
      Api.instances().catch(() => ({ data: [] })),
      Api.workOrders().catch(() => ({ data: [] }))
    ])
    instances.value = Array.isArray(instRes) ? instRes : (instRes.data || [])
    workOrders.value = Array.isArray(woRes) ? woRes : (woRes.data || [])
  } catch (_) { ElMessage.error('加载实例/工单失败') }
}

const loadProcessNodes = async (instanceId) => {
  if (!instanceId) { processNodes.value = []; return }
  try {
    const r = await Api.get('/equipment_instances/' + instanceId + '/process_tree')
    processNodes.value = (r.flat || []).map(n => ({ id: n.id, operation_name: n.operation_name || n.material_name }))
  } catch (_) { processNodes.value = [] }
}

// Tab 1: 加载工时汇总
const loadHoursSummary = async () => {
  if (!selectedInstance.value) return
  hoursLoading.value = true
  try {
    const r = await Api.get('/process/hours-summary?instance_id=' + selectedInstance.value)
    Object.assign(hoursSummary, r)
    await loadProcessNodes(selectedInstance.value)
  } catch (e) { ElMessage.error('加载工时定额失败') }
  finally { hoursLoading.value = false }
}

const openHoursDialog = (row) => {
  hoursForm.node_id = row.node_id
  hoursForm.operation_name = row.operation_name
  hoursForm.work_type = row.work_type || 'assembly'
  hoursForm.standard_hours = row.standard_hours || 0
  hoursForm.worker_count = row.worker_count || 1
  hoursForm.description = row.description || ''
  showHoursEdit.value = true
}

const saveHours = async () => {
  hoursSaving.value = true
  try {
    await Api.post('/process/nodes/' + hoursForm.node_id + '/hours', {
      work_type: hoursForm.work_type,
      standard_hours: hoursForm.standard_hours,
      worker_count: hoursForm.worker_count,
      description: hoursForm.description
    })
    ElMessage.success('保存成功')
    showHoursEdit.value = false
    loadHoursSummary()
  } catch (e) { ElMessage.error('保存失败') }
  finally { hoursSaving.value = false }
}

const deleteHours = async (row) => {
  try {
    await ElMessageBox.confirm('确认删除 #' + row.node_id + ' ' + row.work_type + ' 的工时定额?', '确认删除', { type: 'warning' })
    await Api.del('/process/nodes/' + row.node_id + '/hours/' + row.work_type)
    ElMessage.success('已删除')
    loadHoursSummary()
  } catch (_) { if (_ !== 'cancel' && _ !== 'close') ElMessage.error('删除失败') }
}

// Tab 2: 报工
const loadReports = async () => {
  reportsLoading.value = true
  try {
    const params = {}
    if (reportFilter.work_order_id) params.work_order_id = reportFilter.work_order_id
    if (reportFilter.dateRange) { params.start_date = reportFilter.dateRange[0]; params.end_date = reportFilter.dateRange[1] }
    reports.value = await Api.get('/work-reports', { params })
  } catch (_) { reports.value = [] }
  finally { reportsLoading.value = false }
}

const submitReport = async () => {
  if (!reportForm.work_order_id || reportForm.hours_spent <= 0) return ElMessage.warning('工单和工时必填')
  reportSaving.value = true
  try {
    await Api.post('/work-reports', { ...reportForm })
    ElMessage.success('报工成功')
    showReportDialog.value = false
    Object.assign(reportForm, { work_order_id: null, process_node_id: null, hours_spent: 0, quantity_completed: 0, quality_result: 'pass', notes: '' })
    loadReports()
    loadDailySummary()
  } catch (e) { ElMessage.error('报工失败') }
  finally { reportSaving.value = false }
}

// Tab 3: 日汇总
const loadDailySummary = async () => {
  dailyLoading.value = true
  try {
    const r = await Api.get('/work-reports/daily-summary', { date: dailyDate.value })
    Object.assign(dailySummary, r)
  } catch (_) { Object.assign(dailySummary, { workers: 0, details: [] }) }
  finally { dailyLoading.value = false }
}

// Tab 4: 进度
const onNodeSelect = async (nodeId) => {
  if (!nodeId) return
  try {
    const r = await Api.get('/process/nodes/' + nodeId + '/progress')
    Object.assign(nodeProgress, r)
  } catch (_) { Object.assign(nodeProgress, { process_node_id: 0 }) }
}


// Tab 5: 工人绩效
const perfFilter = reactive({ dateRange: null })
const workerPerfData = ref<any[]>([])
const perfLoading = ref(false)
const perfSummary = reactive({ avg_efficiency: 0, total_hours_sum: 0, total_tasks: 0 })

const loadWorkerPerformance = async () => {
  if (!perfFilter.dateRange) { workerPerfData.value = []; return }
  perfLoading.value = true
  try {
    const params: any = {}
    if (perfFilter.dateRange) { params.from = perfFilter.dateRange[0]; params.to = perfFilter.dateRange[1] }
    const r = await Api.get('/process-hours/worker-performance', { params })
    workerPerfData.value = r?.workers || r || []
    perfSummary.avg_efficiency = r?.avg_efficiency || (workerPerfData.value.length ? Math.round(workerPerfData.value.reduce((s:number,x:any)=>s+(x.efficiency_pct||0),0)/workerPerfData.value.length) : 0)
    perfSummary.total_hours_sum = r?.total_hours_sum || workerPerfData.value.reduce((s:number,x:any)=>s+(x.total_hours||0),0)
    perfSummary.total_tasks = r?.total_tasks || workerPerfData.value.reduce((s:number,x:any)=>s+(x.tasks_completed||0),0)
  } catch (_) { workerPerfData.value = [] }
  finally { perfLoading.value = false }
}

// Tab 6: 加班统计
const otFilter = reactive({ dateRange: null })
const overtimeData = ref<any[]>([])
const otLoading = ref(false)
const otSummary = reactive({ total_overtime: 0, worker_count: 0 })

const loadOvertime = async () => {
  if (!otFilter.dateRange) { overtimeData.value = []; return }
  otLoading.value = true
  try {
    const params: any = {}
    if (otFilter.dateRange) { params.from = otFilter.dateRange[0]; params.to = otFilter.dateRange[1] }
    const r = await Api.get('/process-hours/overtime', { params })
    overtimeData.value = r?.records || r || []
    otSummary.total_overtime = r?.total_overtime || overtimeData.value.reduce((s:number,x:any)=>s+(x.overtime_hours||0),0)
    otSummary.worker_count = r?.worker_count || new Set(overtimeData.value.map((x:any)=>x.user_name)).size
  } catch (_) { overtimeData.value = [] }
  finally { otLoading.value = false }
}

const onTabChange = (tab: string) => {
  if (tab === 'reports' && reports.value.length === 0) loadReports()
  if (tab === 'daily') loadDailySummary()
  if (tab === 'worker-perf' && workerPerfData.value.length === 0) loadWorkerPerformance()
  if (tab === 'overtime' && overtimeData.value.length === 0) loadOvertime()
}

onMounted(() => {
  loadCommonData()
  loadDailySummary()
})
</script>

<style scoped>
.process-hours-page { padding: 16px 24px; }
.page-header { margin-bottom: 16px; }
.page-header h2 { margin: 0; font-size: 20px; }
.tab-toolbar { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
.progress-cards { margin-top: 8px; }

.stat-card { background:#fff; padding:16px; border-radius:6px; text-align:center; border:1px solid #ebeef5; }
.stat-label { font-size:12px; color:#909399; margin-bottom:6px; }
.stat-value { font-size:24px; font-weight:600; color:#303133; line-height:1.2; }
</style>


