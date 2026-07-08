<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title">🔧 现场服务</div>
    </div>

    <!-- Overdue Alert Card -->
    <el-row :gutter="16" style="margin-bottom:16px">
      <el-col :span="6">
        <el-card shadow="hover" :body-style="{ padding: '16px' }">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <div>
              <div style="font-size:13px;color:#909399">逾期维保</div>
              <div style="font-size:28px;font-weight:700;color:#f56c6c">{{ overdueCount }}</div>
            </div>
            <el-icon :size="36" color="#f56c6c"><svg viewBox="0 0 1024 1024"><path d="M512 64a448 448 0 1 1 0 896 448 448 0 0 1 0-896zm0 64a384 384 0 1 0 0 768 384 384 0 0 0 0-768zm0 512a64 64 0 1 1 0 128 64 64 0 0 1 0-128zm0-384a64 64 0 0 1 64 64v192a64 64 0 0 1-128 0V320a64 64 0 0 1 64-64z" fill="currentColor"/></svg></el-icon>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-tabs v-model="tab" @tab-change="onTabChange">
      <!-- ===== Tab 1: 维保计划 ===== -->
      <el-tab-pane label="维保计划" name="plans">
        <div class="tb">
          <el-button type="primary" @click="openPlanDialog()">+ 新建计划</el-button>
          <el-select v-model="planFilter.status" placeholder="状态筛选" clearable style="width:130px" @change="loadPlans">
            <el-option label="待执行" value="pending" />
            <el-option label="进行中" value="in_progress" />
            <el-option label="已完成" value="completed" />
          </el-select>
        </div>
        <el-table :data="plans" v-loading="planLoading" size="small" max-height="500" stripe>
          <el-table-column prop="equipment_instance_id" label="装备实例ID" width="130" />
          <el-table-column prop="component_name" label="部件名称" min-width="140" />
          <el-table-column label="维保类型" width="120">
            <template #default="{ row }">
              <el-tag size="small" :type="row.maintenance_type === 'preventive' ? 'primary' : row.maintenance_type === 'corrective' ? 'warning' : 'info'">
                {{ maintTypeLabel(row.maintenance_type) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="interval" label="周期(天)" width="90" />
          <el-table-column prop="last_done" label="上次执行" width="110" />
          <el-table-column prop="next_due" label="下次到期" width="110">
            <template #default="{ row }">
              <span :style="{ color: isOverdue(row.next_due) ? '#f56c6c' : '', fontWeight: isOverdue(row.next_due) ? '600' : '' }">
                {{ row.next_due }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag :type="planStatusTag(row.status)" size="small">{{ planStatusLabel(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="180" fixed="right">
            <template #default="{ row }">
              <el-button size="small" link type="primary" @click="openPlanDialog(row)">编辑</el-button>
              <el-button v-if="row.status !== 'completed'" size="small" link type="success" @click="openExecDialog(row)">执行维保</el-button>
            </template>
          </el-table-column>
        </el-table>

        <!-- Plan Create/Edit Dialog -->
        <el-dialog v-model="planDlg.visible" :title="planDlg.isEdit ? '编辑维保计划' : '新建维保计划'" width="550px" @closed="resetPlanForm">
          <el-form :model="planForm" label-width="100px">
            <el-form-item label="装备实例ID" required><el-input v-model="planForm.equipment_instance_id" placeholder="装备实例ID" /></el-form-item>
            <el-form-item label="部件名称" required><el-input v-model="planForm.component_name" placeholder="部件名称" /></el-form-item>
            <el-form-item label="维保类型" required>
              <el-select v-model="planForm.maintenance_type" style="width:100%">
                <el-option label="预防性" value="preventive" />
                <el-option label="纠正性" value="corrective" />
                <el-option label="预测性" value="predictive" />
              </el-select>
            </el-form-item>
            <el-form-item label="周期(天)" required><el-input-number v-model="planForm.interval" :min="1" style="width:100%" /></el-form-item>
            <el-form-item label="上次执行"><el-input v-model="planForm.last_done" placeholder="YYYY-MM-DD" /></el-form-item>
            <el-form-item label="下次到期"><el-input v-model="planForm.next_due" placeholder="YYYY-MM-DD" /></el-form-item>
            <el-form-item label="状态">
              <el-select v-model="planForm.status" style="width:100%">
                <el-option label="待执行" value="pending" />
                <el-option label="进行中" value="in_progress" />
                <el-option label="已完成" value="completed" />
              </el-select>
            </el-form-item>
          </el-form>
          <template #footer>
            <el-button @click="planDlg.visible = false">取消</el-button>
            <el-button type="primary" @click="savePlan" :loading="saving">保存</el-button>
          </template>
        </el-dialog>

        <!-- Execute Maintenance Dialog (creates a log) -->
        <el-dialog v-model="execDlg.visible" title="执行维保" width="500px" @closed="resetExecForm">
          <template v-if="execPlan">
            <el-descriptions :column="2" border size="small" style="margin-bottom:16px">
              <el-descriptions-item label="部件">{{ execPlan.component_name }}</el-descriptions-item>
              <el-descriptions-item label="类型">{{ maintTypeLabel(execPlan.maintenance_type) }}</el-descriptions-item>
            </el-descriptions>
          </template>
          <el-form :model="execForm" label-width="90px">
            <el-form-item label="执行人" required><el-input v-model="execForm.performed_by" placeholder="执行人" /></el-form-item>
            <el-form-item label="耗时(h)" required><el-input-number v-model="execForm.hours_spent" :min="0" :precision="1" style="width:100%" /></el-form-item>
            <el-form-item label="发现情况"><el-input v-model="execForm.findings" type="textarea" :rows="3" /></el-form-item>
            <el-form-item label="状态">
              <el-select v-model="execForm.status" style="width:100%">
                <el-option label="正常完成" value="completed" />
                <el-option label="发现问题" value="issues_found" />
                <el-option label="需跟进" value="needs_followup" />
              </el-select>
            </el-form-item>
          </el-form>
          <template #footer>
            <el-button @click="execDlg.visible = false">取消</el-button>
            <el-button type="primary" @click="submitExecution" :loading="saving">提交记录</el-button>
          </template>
        </el-dialog>
      </el-tab-pane>

      <!-- ===== Tab 2: 维保记录 ===== -->
      <el-tab-pane label="维保记录" name="logs">
        <div class="tb">
          <el-date-picker v-model="logFilter.dateRange" type="daterange" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期"
            style="width:280px" @change="loadLogs" value-format="YYYY-MM-DD" />
          <el-input v-model="logFilter.instance" placeholder="装备实例ID" clearable style="width:160px" @change="loadLogs" />
          <el-select v-model="logFilter.status" placeholder="状态" clearable style="width:130px" @change="loadLogs">
            <el-option label="正常完成" value="completed" />
            <el-option label="发现问题" value="issues_found" />
            <el-option label="需跟进" value="needs_followup" />
          </el-select>
        </div>
        <el-table :data="logs" v-loading="logLoading" size="small" max-height="500" stripe>
          <el-table-column prop="equipment" label="装备" width="130" />
          <el-table-column prop="component" label="部件" min-width="140" />
          <el-table-column prop="performed_by" label="执行人" width="100" />
          <el-table-column prop="performed_at" label="执行时间" width="170" />
          <el-table-column prop="hours_spent" label="耗时(h)" width="90" />
          <el-table-column prop="findings" label="发现情况" min-width="160" show-overflow-tooltip />
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <el-tag :type="logStatusTag(row.status)" size="small">{{ logStatusLabel(row.status) }}</el-tag>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- ===== Tab 3: 备件库 ===== -->
      <el-tab-pane label="备件库" name="spares">
        <div class="tb">
          <el-button type="primary" @click="openSpareAdjustDialog('in')">+ 入库</el-button>
          <el-button type="warning" @click="openSpareAdjustDialog('out')">- 出库</el-button>
          <el-tag v-if="lowStockCount" type="danger">{{ lowStockCount }} 项低库存预警</el-tag>
        </div>
        <el-table :data="spares" v-loading="spareLoading" size="small" max-height="500" stripe>
          <el-table-column prop="material_name" label="物料名称" min-width="160" />
          <el-table-column label="当前库存" width="110" align="center">
            <template #default="{ row }">
              <span :style="{ color: row.current_stock <= row.min_stock ? '#f56c6c' : '', fontWeight: row.current_stock <= row.min_stock ? '700' : '' }">
                {{ row.current_stock }}
              </span>
            </template>
          </el-table-column>
          <el-table-column prop="min_stock" label="最低库存" width="90" align="center" />
          <el-table-column label="预警" width="70" align="center">
            <template #default="{ row }">
              <el-badge v-if="row.current_stock <= row.min_stock" value="!" type="danger" />
              <span v-else style="color:#67c23a">正常</span>
            </template>
          </el-table-column>
          <el-table-column prop="storage_location" label="库位" width="100" />
          <el-table-column label="单价" width="100" align="right">
            <template #default="{ row }">¥{{ (row.unit_price || 0).toFixed(2) }}</template>
          </el-table-column>
        </el-table>

        <!-- Spare Parts Adjust Dialog -->
        <el-dialog v-model="spareDlg.visible" :title="spareDlg.type === 'in' ? '备件入库' : '备件出库'" width="450px" @closed="resetSpareForm">
          <el-form :model="spareForm" label-width="100px">
            <el-form-item label="备件" required>
              <el-select v-model="spareForm.spare_part_id" filterable style="width:100%" placeholder="选择备件">
                <el-option v-for="s in spares" :key="s.id" :label="s.material_name + ' (库存:' + s.current_stock + ')'" :value="s.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="数量" required>
              <el-input-number v-model="spareForm.quantity" :min="1" style="width:100%" />
            </el-form-item>
            <el-form-item label="备注">
              <el-input v-model="spareForm.notes" type="textarea" :rows="2" placeholder="调整原因" />
            </el-form-item>
          </el-form>
          <template #footer>
            <el-button @click="spareDlg.visible = false">取消</el-button>
            <el-button :type="spareDlg.type === 'in' ? 'primary' : 'warning'" @click="submitSpareAdjust" :loading="saving">确认{{ spareDlg.type === 'in' ? '入库' : '出库' }}</el-button>
          </template>
        </el-dialog>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Api } from '../api'
import { ElMessage, ElMessageBox } from 'element-plus'

// ==================== Shared State ====================
const route = useRoute()
const router = useRouter()
const tabNames = new Set(['plans', 'logs', 'spares'])
const routeTab = () => {
  const value = String(route.query.tab || '')
  return tabNames.has(value) ? value : 'plans'
}
const tab = ref(routeTab())
const saving = ref(false)
const overdueCount = ref(0)

// ==================== Tab 1: 维保计划 ====================
const plans = ref<any[]>([])
const planLoading = ref(false)
const planFilter = reactive({ status: '' })

const maintTypeLabel = (t: string) =>
  ({ preventive: '预防性', corrective: '纠正性', predictive: '预测性' } as any)[t] || t
const planStatusLabel = (s: string) =>
  ({ pending: '待执行', in_progress: '进行中', completed: '已完成' } as any)[s] || s
const planStatusTag = (s: string) =>
  ({ pending: 'warning', in_progress: '', completed: 'success' } as any)[s] || 'info'

const isOverdue = (nextDue: string) => {
  if (!nextDue) return false
  const today = new Date().toISOString().slice(0, 10)
  return nextDue < today
}

const planDlg = reactive({ visible: false, isEdit: false })
const planForm = reactive({
  id: null as number | null,
  equipment_instance_id: '', component_name: '', maintenance_type: 'preventive',
  interval: 90, last_done: '', next_due: '', status: 'pending'
})

const execDlg = reactive({ visible: false })
const execPlan = ref<any>(null)
const execForm = reactive({
  performed_by: '', hours_spent: 0, findings: '', status: 'completed'
})

const loadPlans = async () => {
  planLoading.value = true
  try {
    const params: any = {}
    if (planFilter.status) params.status = planFilter.status
    plans.value = await Api.get('/field-service/maintenance-plans', { params })
  } catch (_) { plans.value = [] }
  finally { planLoading.value = false }
}

const openPlanDialog = (row?: any) => {
  planDlg.isEdit = !!row
  if (row) {
    Object.assign(planForm, {
      id: row.id, equipment_instance_id: row.equipment_instance_id || '',
      component_name: row.component_name || '', maintenance_type: row.maintenance_type || 'preventive',
      interval: row.interval || 90, last_done: row.last_done || '', next_due: row.next_due || '',
      status: row.status || 'pending'
    })
  } else {
    resetPlanForm()
  }
  planDlg.visible = true
}

const resetPlanForm = () => {
  Object.assign(planForm, {
    id: null, equipment_instance_id: '', component_name: '', maintenance_type: 'preventive',
    interval: 90, last_done: '', next_due: '', status: 'pending'
  })
}

const savePlan = async () => {
  if (!planForm.equipment_instance_id || !planForm.component_name) {
    ElMessage.warning('请填写装备实例ID和部件名称'); return
  }
  saving.value = true
  try {
    const body = { ...planForm }
    delete (body as any).id
    if (planDlg.isEdit && planForm.id) {
      await Api.put(`/field-service/maintenance-plans/${planForm.id}`, body)
    } else {
      await Api.post('/field-service/maintenance-plans', body)
    }
    ElMessage.success('已保存')
    planDlg.visible = false
    loadPlans()
  } catch (e: any) { ElMessage.error(e?.message || '保存失败') }
  finally { saving.value = false }
}

const openExecDialog = (plan: any) => {
  execPlan.value = plan
  resetExecForm()
  execDlg.visible = true
}

const resetExecForm = () => {
  Object.assign(execForm, { performed_by: '', hours_spent: 0, findings: '', status: 'completed' })
}

const submitExecution = async () => {
  if (!execForm.performed_by) { ElMessage.warning('请填写执行人'); return }
  saving.value = true
  try {
    await Api.post('/field-service/maintenance-logs', {
      maintenance_plan_id: execPlan.value.id,
      equipment: execPlan.value.equipment_instance_id,
      component: execPlan.value.component_name,
      performed_by: execForm.performed_by,
      hours_spent: execForm.hours_spent,
      findings: execForm.findings || undefined,
      status: execForm.status
    })
    // Also update the plan status
    await Api.put(`/field-service/maintenance-plans/${execPlan.value.id}`, {
      ...execPlan.value,
      status: 'completed',
      last_done: new Date().toISOString().slice(0, 10)
    })
    ElMessage.success('维保记录已提交')
    execDlg.visible = false
    loadPlans()
  } catch (e: any) { ElMessage.error(e?.message || '提交失败') }
  finally { saving.value = false }
}

// ==================== Tab 2: 维保记录 ====================
const logs = ref<any[]>([])
const logLoading = ref(false)
const logFilter = reactive({
  dateRange: null as [string, string] | null,
  instance: '',
  status: ''
})

const logStatusLabel = (s: string) =>
  ({ completed: '正常完成', issues_found: '发现问题', needs_followup: '需跟进' } as any)[s] || s
const logStatusTag = (s: string) =>
  ({ completed: 'success', issues_found: 'warning', needs_followup: 'danger' } as any)[s] || 'info'

const loadLogs = async () => {
  logLoading.value = true
  try {
    const params: any = {}
    if (logFilter.dateRange && logFilter.dateRange.length === 2) {
      params.start_date = logFilter.dateRange[0]
      params.end_date = logFilter.dateRange[1]
    }
    if (logFilter.instance) params.equipment = logFilter.instance
    if (logFilter.status) params.status = logFilter.status
    logs.value = await Api.get('/field-service/maintenance-logs', { params })
  } catch (_) { logs.value = [] }
  finally { logLoading.value = false }
}

// ==================== Tab 3: 备件库 ====================
const spares = ref<any[]>([])
const spareLoading = ref(false)

const spareDlg = reactive({ visible: false, type: 'in' as 'in' | 'out' })
const spareForm = reactive({
  spare_part_id: null as number | null,
  quantity: 1,
  notes: ''
})

const lowStockCount = computed(() => spares.value.filter((s: any) => s.current_stock <= s.min_stock).length)

const loadSpares = async () => {
  spareLoading.value = true
  try { spares.value = await Api.get('/field-service/spare-parts') } catch (_) { spares.value = [] }
  finally { spareLoading.value = false }
}

const openSpareAdjustDialog = (type: 'in' | 'out') => {
  spareDlg.type = type
  resetSpareForm()
  spareDlg.visible = true
}

const resetSpareForm = () => {
  Object.assign(spareForm, { spare_part_id: null, quantity: 1, notes: '' })
}

const submitSpareAdjust = async () => {
  if (!spareForm.spare_part_id) { ElMessage.warning('请选择备件'); return }
  if (spareForm.quantity < 1) { ElMessage.warning('数量必须大于0'); return }
  saving.value = true
  try {
    await Api.post('/field-service/spare-parts/adjust', {
      spare_part_id: spareForm.spare_part_id,
      quantity: spareForm.quantity,
      type: spareDlg.type,
      notes: spareForm.notes || undefined
    })
    ElMessage.success(spareDlg.type === 'in' ? '入库成功' : '出库成功')
    spareDlg.visible = false
    loadSpares()
  } catch (e: any) { ElMessage.error(e?.message || '操作失败') }
  finally { saving.value = false }
}

// ==================== Init ====================
const loadOverdue = async () => {
  try {
    const res = await Api.get('/field-service/overdue')
    overdueCount.value = typeof res === 'object' ? (res.count || res.total || 0) : (res || 0)
  } catch (_) { overdueCount.value = 0 }
}

const onTabChange = (t: string) => {
  if (route.query.tab !== t) router.replace({ query: { ...route.query, tab: t } })
  if (t === 'logs' && logs.value.length === 0) loadLogs()
  if (t === 'spares' && spares.value.length === 0) loadSpares()
}

watch(() => route.query.tab, () => {
  const next = routeTab()
  if (next !== tab.value) {
    tab.value = next
    onTabChange(next)
  }
})

onMounted(async () => {
  await Promise.all([loadOverdue(), loadPlans()])
  onTabChange(tab.value)
})
</script>

<style scoped>
.page { padding: 16px 24px; }
.page-header { margin-bottom: 16px; }
.page-title { font-size: 20px; font-weight: 600; }
.tb { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
</style>
