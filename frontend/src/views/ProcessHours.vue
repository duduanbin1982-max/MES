<template>
  <div class="process-hours-page">
    <PageToolbar class="page-header">
      <h2>工时定额与报工</h2>
    </PageToolbar>

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
      <el-tab-pane label="人工费率" name="rates">
        <el-alert type="info" :closable="false" show-icon style="margin-bottom:12px"
          title="报工审批通过后，人工成本按「工种 × 生效费率卡」自动入账；无匹配费率卡时回退统一费率。费率卡可按生效日期维护多档。" />
        <div class="tab-toolbar">
          <el-select v-model="rateForm.work_type" style="width:120px">
            <el-option v-for="type in ['assembly','welding','machining','testing','qc','other']" :key="type" :label="workTypeLabel(type)" :value="type" />
          </el-select>
          <el-input-number v-model="rateForm.hourly_rate" :min="1" :precision="2" placeholder="元/小时" style="width:140px" />
          <el-date-picker v-model="rateForm.effective_from" type="date" value-format="YYYY-MM-DD" placeholder="生效日期" style="width:150px" />
          <el-input v-model="rateForm.note" placeholder="备注（可选）" style="width:180px" />
          <el-button v-if="canApprove" type="primary" @click="saveLaborRate">保存费率</el-button>
          <el-tag v-if="rateResolved" type="info" size="small">当前 assembly 费率：{{ rateResolved.assembly?.rate }} 元/h（{{ rateResolved.assembly?.source }}）</el-tag>
        </div>
        <el-table :data="laborRates" v-loading="rateLoading" border stripe size="small" max-height="420" empty-text="暂无费率卡（审批时回退统一费率）">
          <el-table-column label="工种" width="110">
            <template #default="{ row }">{{ workTypeLabel(row.work_type) }}</template>
          </el-table-column>
          <el-table-column prop="skill_level" label="技能等级" width="100" />
          <el-table-column label="费率(元/h)" width="120" align="right">
            <template #default="{ row }">{{ row.hourly_rate }}</template>
          </el-table-column>
          <el-table-column prop="effective_from" label="生效日期" width="120" />
          <el-table-column prop="note" label="备注" min-width="180" show-overflow-tooltip />
          <el-table-column label="操作" width="90">
            <template #default="{ row }">
              <el-button v-if="canApprove" size="small" link type="danger" @click="deleteLaborRate(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="工序报工" name="reports">
        <div class="tab-toolbar">
          <el-select v-model="reportFilter.work_order_id" placeholder="筛选工单" clearable style="width: 200px" @change="loadReports">
            <el-option v-for="wo in workOrders" :key="wo.id" :label="wo.wo_code" :value="wo.id" />
          </el-select>
          <el-date-picker v-model="reportFilter.dateRange" type="daterange" range-separator="→" start-placeholder="开始" end-placeholder="结束" value-format="YYYY-MM-DD" @change="loadReports" style="width: 260px" />
          <el-button type="primary" @click="loadReports">查询</el-button>
          <el-button @click="showReportDialog = true">+ 新增报工</el-button>
          <el-tag v-if="monthLock?.locked" type="warning">本月已月结锁定 {{ monthLock.month }}</el-tag>
          <el-button v-if="!monthLock?.locked && canApprove" size="small" type="warning" plain @click="lockCurrentMonth">锁定本月</el-button>
          <el-button v-if="monthLock?.locked && canApprove" size="small" @click="unlockCurrentMonth">解锁</el-button>
        </div>
        <el-table :data="reports" v-loading="reportsLoading" empty-text="暂无报工记录" border stripe size="small" max-height="450">
          <el-table-column prop="wo_code" label="工单" width="100" />
          <el-table-column prop="operation_name" label="工序" min-width="120" />
          <el-table-column prop="worker_name" label="工人" width="80" />
          <el-table-column label="状态" width="90" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="row.status === 'approved' ? 'success' : row.status === 'rejected' ? 'danger' : 'warning'">
                {{ row.status === 'approved' ? '已通过' : row.status === 'rejected' ? '已驳回' : '待审批' }}
              </el-tag>
            </template>
          </el-table-column>
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
          <el-table-column label="操作" width="200" fixed="right">
            <template #default="{ row }">
              <el-button v-if="canApprove && row.status === 'pending'" size="small" link type="success" @click="approveReport(row)">通过</el-button>
              <el-button v-if="canApprove && row.status === 'pending'" size="small" link type="warning" @click="rejectReport(row)">驳回</el-button>
              <el-button v-if="canVoid" size="small" link type="danger" @click="voidReport(row)">撤销</el-button>
            </template>
          </el-table-column>
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
        <PageState state="empty" compact :show-action="false" v-else description="请选择工艺节点查看进度" />
      </el-tab-pane>

      <!-- Tab 5: 工人绩效 -->
      <el-tab-pane label="工人绩效" name="worker-perf">
        <div class="tab-toolbar">
          <el-date-picker v-model="perfFilter.dateRange" type="daterange" range-separator="→" start-placeholder="开始" end-placeholder="结束" value-format="YYYY-MM-DD" @change="loadWorkerPerformance" style="width:260px" />
        </div>

        <el-row :gutter="12" style="margin-bottom:12px" v-if="perfSummary.total_tasks">
          <el-col :span="8"><div class="stat-card"><div class="stat-label">平均效率</div><div class="stat-value" style="color:var(--el-color-success)">{{ perfSummary.avg_efficiency == null ? '—' : perfSummary.avg_efficiency + '%' }}</div></div></el-col>
          <el-col :span="8"><div class="stat-card"><div class="stat-label">总工时</div><div class="stat-value">{{ perfSummary.total_hours_sum }}h</div></div></el-col>
          <el-col :span="8"><div class="stat-card"><div class="stat-label">总任务数</div><div class="stat-value">{{ perfSummary.total_tasks }}</div></div></el-col>
        </el-row>

        <el-table :data="workerPerfData" v-loading="perfLoading" border stripe size="small" empty-text="请选择日期范围" max-height="400">
          <el-table-column prop="full_name" label="姓名" width="100" />
          <el-table-column prop="total_hours" label="总工时(h)" width="100" align="right" sortable />
          <el-table-column label="标准工时(h)" width="110" align="right">
            <template #default="{ row }">{{ row.standard_hours == null ? '—' : row.standard_hours }}</template>
          </el-table-column>
          <el-table-column label="效率" min-width="180">
            <template #default="{row}">
              <div style="display:flex;align-items:center;gap:8px">
                <el-progress v-if="row.efficiency_pct != null" :percentage="Math.min(100, row.efficiency_pct)" :status="row.efficiency_pct>=100?'success':row.efficiency_pct>=80?'':'exception'" style="flex:1" />
                <span style="font-weight:600;min-width:45px">{{ row.efficiency_pct == null ? '无定额' : row.efficiency_pct + '%' }}</span>
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
              <span :style="{color:row.overtime_hours>3?'var(--el-color-danger)':row.overtime_hours>0?'var(--el-color-warning)':'var(--el-color-info)',fontWeight:'600'}">{{ row.overtime_hours }}</span>
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
import { useProcessHoursPage } from '../composables/useProcessHoursPage'

const {
  activeTab,
  instances,
  workOrders,
  processNodes,
  selectedInstance,
  hoursSummary,
  hoursLoading,
  showHoursEdit,
  hoursSaving,
  hoursForm,
  reports,
  reportsLoading,
  reportFilter,
  canVoid,
  voidReport,
  laborRates,
  rateResolved,
  rateLoading,
  rateForm,
  saveLaborRate,
  deleteLaborRate,
  canApprove,
  monthLock,
  lockCurrentMonth,
  unlockCurrentMonth,
  approveReport,
  rejectReport,
  showReportDialog,
  reportSaving,
  reportForm,
  dailySummary,
  dailyLoading,
  dailyDate,
  dailyTotalHours,
  selectedNodeId,
  nodeProgress,
  workTypeTag,
  workTypeLabel,
  loadHoursSummary,
  openHoursDialog,
  saveHours,
  deleteHours,
  loadReports,
  submitReport,
  loadDailySummary,
  onNodeSelect,
  perfFilter,
  workerPerfData,
  perfLoading,
  perfSummary,
  loadWorkerPerformance,
  otFilter,
  overtimeData,
  otLoading,
  otSummary,
  loadOvertime,
  onTabChange } = useProcessHoursPage()
</script>

<style scoped>
.process-hours-page { padding: 16px 24px; }
.page-header { margin-bottom: 16px; }
.page-header h2 { margin: 0; font-size: 20px; }
.tab-toolbar { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
.progress-cards { margin-top: 8px; }

.stat-card { background:var(--el-color-white); padding:16px; border-radius:6px; text-align:center; border:1px solid var(--el-border-color-lighter); }
.stat-label { font-size:12px; color:var(--el-color-info); margin-bottom:6px; }
.stat-value { font-size:24px; font-weight:600; color:var(--el-text-color-primary); line-height:1.2; }
</style>
