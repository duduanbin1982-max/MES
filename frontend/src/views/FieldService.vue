<template>
  <div class="page">
    <PageToolbar class="page-header">
      <div class="page-title"><el-icon><Tools /></el-icon> 点检 / TPM</div>
      <div class="page-subtitle">车间生产设备维保计划、点检表、故障报修与备件。项目装备维护不在此模块。</div>
    </PageToolbar>

    <el-row :gutter="14" style="margin-bottom:16px">
      <el-col :span="6"><el-card shadow="hover"><div class="kpi-label">逾期维保</div><div class="kpi-value danger">{{ overdueCount }}</div></el-card></el-col>
      <el-col :span="6"><el-card shadow="hover"><div class="kpi-label">待处理故障</div><div class="kpi-value">{{ breakdowns.filter(b => !['resolved','closed'].includes(b.status)).length }}</div></el-card></el-col>
      <el-col :span="6"><el-card shadow="hover"><div class="kpi-label">点检表</div><div class="kpi-value">{{ checklists.length }}</div></el-card></el-col>
      <el-col :span="6"><el-card shadow="hover"><div class="kpi-label">备件低库存</div><div class="kpi-value">{{ lowStockCount }}</div></el-card></el-col>
    </el-row>

    <el-tabs v-model="tab" @tab-change="onTabChange">
      <el-tab-pane label="维保计划" name="plans">
        <div class="tb">
          <el-button type="primary" @click="openPlanDialog()">+ 新建计划</el-button>
          <el-select v-model="planFilter.status" placeholder="状态筛选" clearable style="width:130px" @change="loadPlans">
            <el-option label="待执行" value="pending" /><el-option label="进行中" value="in_progress" /><el-option label="已完成" value="completed" />
          </el-select>
        </div>
        <el-table :data="plans" v-loading="planLoading" size="small" max-height="520" stripe>
          <el-table-column label="装备" min-width="180"><template #default="{ row }">{{ row.instance_code || row.equipment_instance_id }}<span class="muted"> {{ row.instance_name || '' }}</span></template></el-table-column>
          <el-table-column prop="plan_name" label="计划名称" min-width="170" />
          <el-table-column label="类型" width="100"><template #default="{ row }"><el-tag size="small">{{ maintTypeLabel(row.maintenance_type) }}</el-tag></template></el-table-column>
          <el-table-column prop="frequency_days" label="周期(天)" width="90" />
          <el-table-column prop="last_done_date" label="上次执行" width="110" />
          <el-table-column label="下次到期" width="120"><template #default="{ row }"><span :class="{ 'danger-text': isOverdue(row.next_due_date) }">{{ row.next_due_date || '-' }}</span></template></el-table-column>
          <el-table-column label="状态" width="90"><template #default="{ row }"><el-tag :type="planStatusTag(row.status)" size="small">{{ planStatusLabel(row.status) }}</el-tag></template></el-table-column>
          <el-table-column label="操作" width="180" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="openPlanDialog(row)">编辑</el-button><el-button v-if="row.status !== 'completed'" link type="success" @click="openExecDialog(row)">执行维保</el-button></template></el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="维保记录" name="logs">
        <div class="tb">
          <el-date-picker v-model="logFilter.dateRange" type="daterange" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" style="width:280px" value-format="YYYY-MM-DD" @change="loadLogs" />
          <el-input v-model="logFilter.instance" placeholder="装备实例ID" clearable style="width:150px" @change="loadLogs" />
          <el-select v-model="logFilter.status" placeholder="状态" clearable style="width:130px" @change="loadLogs"><el-option label="正常完成" value="completed" /><el-option label="发现问题" value="issues_found" /><el-option label="需跟进" value="needs_followup" /></el-select>
        </div>
        <el-table :data="logs" v-loading="logLoading" size="small" max-height="520" stripe>
          <el-table-column label="装备" width="150"><template #default="{ row }">{{ row.instance_code || row.equipment_instance_id }}</template></el-table-column>
          <el-table-column prop="plan_name" label="计划" min-width="150" />
          <el-table-column label="执行人" width="110"><template #default="{ row }">{{ row.performer_name || row.performed_by || '-' }}</template></el-table-column>
          <el-table-column prop="performed_at" label="执行时间" width="170" />
          <el-table-column prop="hours_spent" label="耗时(h)" width="90" />
          <el-table-column prop="findings" label="发现情况" min-width="180" show-overflow-tooltip />
          <el-table-column label="状态" width="110"><template #default="{ row }"><el-tag :type="logStatusTag(row.status)" size="small">{{ logStatusLabel(row.status) }}</el-tag></template></el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="点检表" name="checklists">
        <div class="tb"><el-button type="primary" @click="openChecklistDialog">+ 新建点检表</el-button><span class="muted">点检执行会写入维保记录</span></div>
        <el-table :data="checklists" v-loading="checklistLoading" size="small" stripe>
          <el-table-column prop="checklist_name" label="点检表" min-width="180" />
          <el-table-column label="装备" width="150"><template #default="{ row }">{{ row.instance_code || row.equipment_instance_id }}</template></el-table-column>
          <el-table-column prop="check_type" label="类型" width="90" />
          <el-table-column label="检查项" width="80"><template #default="{ row }">{{ parseItems(row).length }}</template></el-table-column>
          <el-table-column prop="status" label="状态" width="90" />
          <el-table-column label="操作" width="100"><template #default="{ row }"><el-button link type="primary" @click="openExecChecklist(row)">执行点检</el-button></template></el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="故障报修" name="breakdowns">
        <div class="tb"><el-button type="primary" @click="openBreakdownDialog">+ 故障报修</el-button></div>
        <el-table :data="breakdowns" v-loading="breakdownLoading" size="small" max-height="520" stripe>
          <el-table-column prop="report_code" label="单号" width="150" />
          <el-table-column label="装备" width="150"><template #default="{ row }">{{ row.instance_code || row.equipment_instance_id }}</template></el-table-column>
          <el-table-column prop="fault_type" label="类型" width="100" />
          <el-table-column prop="fault_desc" label="故障描述" min-width="180" show-overflow-tooltip />
          <el-table-column label="严重度" width="90"><template #default="{ row }"><el-tag size="small" :type="severityTag(row.severity)">{{ severityLabel(row.severity) }}</el-tag></template></el-table-column>
          <el-table-column prop="status" label="状态" width="100" />
          <el-table-column prop="downtime_hours" label="停机(h)" width="90" />
          <el-table-column label="操作" width="100"><template #default="{ row }"><el-button link type="primary" @click="openBreakdownEdit(row)">处理</el-button></template></el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="备件库" name="spares">
        <div class="tb"><el-button type="primary" @click="openSpareAdjustDialog('in')">+ 入库</el-button><el-button type="warning" @click="openSpareAdjustDialog('out')">- 出库</el-button><el-tag v-if="lowStockCount" type="danger">{{ lowStockCount }} 项低库存预警</el-tag></div>
        <el-table :data="spares" v-loading="spareLoading" size="small" max-height="520" stripe>
          <el-table-column prop="part_name" label="备件" min-width="180" />
          <el-table-column prop="part_code" label="编码" width="130" />
          <el-table-column label="当前库存" width="100"><template #default="{ row }"><span :class="{ 'danger-text': Number(row.current_stock) <= Number(row.min_stock) }">{{ row.current_stock }}</span></template></el-table-column>
          <el-table-column prop="min_stock" label="最低库存" width="90" />
          <el-table-column prop="location" label="库位" width="110" />
          <el-table-column label="单价" width="100"><template #default="{ row }">¥{{ Number(row.unit_price || 0).toFixed(2) }}</template></el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="planDlg.visible" :title="planDlg.isEdit ? '编辑维保计划' : '新建维保计划'" width="560px" @closed="resetPlanForm">
      <el-form :model="planForm" label-width="100px">
        <el-form-item label="装备实例" required><el-select v-model="planForm.equipment_instance_id" filterable style="width:100%"><el-option v-for="item in instances" :key="item.id" :label="item.instance_code + ' | ' + (item.instance_name || '')" :value="item.id" /></el-select></el-form-item>
        <el-form-item label="计划名称" required><el-input v-model="planForm.plan_name" /></el-form-item>
        <el-form-item label="维保类型"><el-select v-model="planForm.maintenance_type" style="width:100%"><el-option label="周检" value="weekly" /><el-option label="月检" value="monthly" /><el-option label="季检" value="quarterly" /><el-option label="例行" value="routine" /><el-option label="预防性" value="preventive" /><el-option label="纠正性" value="corrective" /><el-option label="预测性" value="predictive" /></el-select></el-form-item>
        <el-form-item label="周期(天)"><el-input-number v-model="planForm.frequency_days" :min="1" style="width:100%" /></el-form-item>
        <el-form-item label="上次执行"><el-date-picker v-model="planForm.last_done_date" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item>
        <el-form-item label="下次到期"><el-date-picker v-model="planForm.next_due_date" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item>
        <el-form-item label="状态"><el-select v-model="planForm.status" style="width:100%"><el-option label="待执行" value="pending" /><el-option label="进行中" value="in_progress" /><el-option label="已完成" value="completed" /></el-select></el-form-item>
        <el-form-item label="备注"><el-input v-model="planForm.notes" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="planDlg.visible = false">取消</el-button><el-button type="primary" :loading="saving" @click="savePlan">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="execDlg.visible" title="执行维保" width="520px" @closed="resetExecForm">
      <el-descriptions v-if="execPlan" :column="2" border size="small" style="margin-bottom:12px"><el-descriptions-item label="计划">{{ execPlan.plan_name }}</el-descriptions-item><el-descriptions-item label="装备">{{ execPlan.instance_code || execPlan.equipment_instance_id }}</el-descriptions-item></el-descriptions>
      <el-form :model="execForm" label-width="90px">
        <el-form-item label="执行人ID" required><el-input v-model="execForm.performed_by" placeholder="用户 ID，例如 1" /></el-form-item>
        <el-form-item label="耗时(h)"><el-input-number v-model="execForm.hours_spent" :min="0" :precision="1" style="width:100%" /></el-form-item>
        <el-form-item label="发现情况"><el-input v-model="execForm.findings" type="textarea" :rows="3" /></el-form-item>
        <el-form-item label="结果"><el-select v-model="execForm.status" style="width:100%"><el-option label="正常完成" value="completed" /><el-option label="发现问题" value="issues_found" /><el-option label="需跟进" value="needs_followup" /></el-select></el-form-item>
      </el-form>
      <template #footer><el-button @click="execDlg.visible = false">取消</el-button><el-button type="primary" :loading="saving" @click="submitExecution">提交记录</el-button></template>
    </el-dialog>

    <el-dialog v-model="checklistDlg.visible" title="新建点检表" width="500px">
      <el-form label-width="90px"><el-form-item label="装备实例"><el-select v-model="checklistForm.equipment_instance_id" filterable style="width:100%"><el-option v-for="item in instances" :key="item.id" :label="item.instance_code + ' | ' + (item.instance_name || '')" :value="item.id" /></el-select></el-form-item><el-form-item label="名称" required><el-input v-model="checklistForm.checklist_name" /></el-form-item><el-form-item label="类型"><el-select v-model="checklistForm.check_type" style="width:100%"><el-option label="日点检" value="daily" /><el-option label="周点检" value="weekly" /><el-option label="月点检" value="monthly" /><el-option label="专项" value="special" /></el-select></el-form-item></el-form>
      <template #footer><el-button @click="checklistDlg.visible = false">取消</el-button><el-button type="primary" :loading="saving" @click="saveChecklist">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="execChecklistDlg.visible" title="执行点检" width="560px">
      <el-form label-width="80px"><el-form-item label="点检表"><strong>{{ execChecklistDlg.row?.checklist_name }}</strong></el-form-item><el-form-item label="耗时(h)"><el-input-number v-model="execChecklistDlg.hours_spent" :min="0" :precision="1" /></el-form-item></el-form>
      <el-table :data="execChecklistDlg.results" size="small">
        <el-table-column prop="name" label="检查项" min-width="150" />
        <el-table-column prop="expected" label="标准" min-width="180" />
        <el-table-column label="结果" width="160"><template #default="{ row }"><el-radio-group v-model="row.result" size="small"><el-radio value="pass">正常</el-radio><el-radio value="fail">异常</el-radio></el-radio-group></template></el-table-column>
      </el-table>
      <template #footer><el-button @click="execChecklistDlg.visible = false">取消</el-button><el-button type="primary" :loading="saving" @click="submitChecklist">提交点检</el-button></template>
    </el-dialog>

    <el-dialog v-model="breakdownDlg.visible" title="故障报修" width="520px">
      <el-form label-width="90px"><el-form-item label="装备实例" required><el-select v-model="breakdownForm.equipment_instance_id" filterable style="width:100%"><el-option v-for="item in instances" :key="item.id" :label="item.instance_code + ' | ' + (item.instance_name || '')" :value="item.id" /></el-select></el-form-item><el-form-item label="故障类型"><el-select v-model="breakdownForm.fault_type" style="width:100%"><el-option label="机械" value="mechanical" /><el-option label="电气" value="electrical" /><el-option label="液压" value="hydraulic" /><el-option label="软件" value="software" /><el-option label="其他" value="other" /></el-select></el-form-item><el-form-item label="严重度"><el-select v-model="breakdownForm.severity" style="width:100%"><el-option label="低" value="low" /><el-option label="中" value="medium" /><el-option label="高" value="high" /><el-option label="紧急" value="critical" /></el-select></el-form-item><el-form-item label="故障描述" required><el-input v-model="breakdownForm.fault_desc" type="textarea" :rows="3" /></el-form-item></el-form>
      <template #footer><el-button @click="breakdownDlg.visible = false">取消</el-button><el-button type="primary" :loading="saving" @click="saveBreakdown">提交报修</el-button></template>
    </el-dialog>

    <el-dialog v-model="breakdownEditDlg.visible" title="处理故障单" width="520px">
      <el-form label-width="90px"><el-form-item label="状态"><el-select v-model="breakdownEditDlg.status" style="width:100%"><el-option label="待处理" value="open" /><el-option label="处理中" value="in_progress" /><el-option label="已解决" value="resolved" /><el-option label="已关闭" value="closed" /></el-select></el-form-item><el-form-item label="停机(h)"><el-input-number v-model="breakdownEditDlg.downtime_hours" :min="0" :precision="1" style="width:100%" /></el-form-item><el-form-item label="根因"><el-input v-model="breakdownEditDlg.root_cause" type="textarea" :rows="2" /></el-form-item><el-form-item label="处理措施"><el-input v-model="breakdownEditDlg.repair_actions" type="textarea" :rows="2" /></el-form-item></el-form>
      <template #footer><el-button @click="breakdownEditDlg.visible = false">取消</el-button><el-button type="primary" :loading="saving" @click="saveBreakdownEdit">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="spareDlg.visible" :title="spareDlg.type === 'in' ? '备件入库' : '备件出库'" width="450px">
      <el-form label-width="90px"><el-form-item label="备件" required><el-select v-model="spareForm.spare_part_id" filterable style="width:100%"><el-option v-for="s in spares" :key="s.id" :label="s.part_name + ' (' + s.part_code + ', 库存:' + s.current_stock + ')'" :value="s.id" /></el-select></el-form-item><el-form-item label="数量" required><el-input-number v-model="spareForm.quantity" :min="1" style="width:100%" /></el-form-item><el-form-item label="备注"><el-input v-model="spareForm.notes" type="textarea" :rows="2" /></el-form-item></el-form>
      <template #footer><el-button @click="spareDlg.visible = false">取消</el-button><el-button type="primary" :loading="saving" @click="submitSpareAdjust">确认</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { useFieldServicePage } from '../composables/useFieldServicePage'
const {
  tab, saving, overdueCount, instances, planLoading, plans, planFilter, maintTypeLabel, planStatusLabel, planStatusTag, isOverdue,
  planDlg, planForm, loadPlans, openPlanDialog, resetPlanForm, savePlan,
  execDlg, execPlan, execForm, openExecDialog, resetExecForm, submitExecution,
  logLoading, logs, logFilter, logStatusLabel, logStatusTag, loadLogs,
  checklistLoading, checklists, checklistDlg, checklistForm, execChecklistDlg, openChecklistDialog, saveChecklist, openExecChecklist, submitChecklist, parseItems,
  breakdownLoading, breakdowns, breakdownDlg, breakdownForm, breakdownEditDlg, openBreakdownDialog, saveBreakdown, openBreakdownEdit, saveBreakdownEdit,
  spareLoading, spares, spareDlg, spareForm, lowStockCount, openSpareAdjustDialog, submitSpareAdjust,
  onTabChange,
} = useFieldServicePage()
const severityLabel = (value: string) => ({ low: '低', medium: '中', high: '高', critical: '紧急' } as any)[value] || value
const severityTag = (value: string) => ({ low: 'info', medium: 'warning', high: 'danger', critical: 'danger' } as any)[value] || 'info'
</script>

<style scoped>
.page { padding: 16px 24px; }
.page-header { margin-bottom: 8px; }
.page-title { font-size: 20px; font-weight: 600; }
.page-subtitle { color: var(--el-text-color-secondary); font-size: 13px; margin-top: 4px; }
.tb { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
.kpi-label { color: var(--el-text-color-secondary); font-size: 13px; }
.kpi-value { font-size: 28px; font-weight: 700; margin-top: 4px; }
.danger { color: var(--el-color-danger); }
.danger-text { color: var(--el-color-danger); font-weight: 600; }
.muted { color: var(--el-text-color-secondary); font-size: 12px; }
</style>
