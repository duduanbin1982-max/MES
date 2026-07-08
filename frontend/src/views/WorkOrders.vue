<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title">📑 工单管理</div>
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
              <el-button size="small" :type="quickFilter === 'in_progress' ? 'primary' : ''" @click="setQuickFilter('in_progress')">进行中</el-button>
              <el-button size="small" :type="quickFilter === 'completed' ? 'primary' : ''" @click="setQuickFilter('completed')">已完成</el-button>
            </el-button-group>
          </div>

          <el-table :data="rows" stripe v-loading="loading" size="small">
            <el-table-column prop="wo_code" label="工单号" width="160" />
            <el-table-column prop="instance_code" label="实例" width="140" />
            <el-table-column prop="subsystem_name" label="子系统" width="100" />
            <el-table-column prop="title" label="标题" min-width="200" />
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <el-tag :type="woStatusTagType(row.status)" size="small">{{ row.status }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="priority" label="优先级" width="80" align="center" />
            <el-table-column prop="assigned_name" label="派工" width="80" />
            <el-table-column label="实际工时" width="100" align="right">
              <template #default="{ row }">{{ row.actual_hours || '-' }}</template>
            </el-table-column>
            <el-table-column label="开始" width="110">
              <template #default="{ row }">{{ (row.actual_start || '').slice(0, 10) }}</template>
            </el-table-column>
            <el-table-column label="结束" width="110">
              <template #default="{ row }">{{ (row.actual_end || '').slice(0, 10) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="120" align="center" fixed="right">
              <template #default="{ row }">
                <el-button size="small" type="primary" link @click="checkKit(row)">📦 齐套</el-button>
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
                <el-tag :type="woStatusTagType(row.status)" size="small">{{ row.status }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="100" align="center" fixed="right">
              <template #default="{ row }">
                <el-button size="small" type="primary" @click="openDispatch(row)">派工</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <!-- 齐套检查弹窗 -->
    <el-dialog v-model="kitDlg.show" :title="'齐套检查: ' + kitDlg.wo_code" width="600px">
      <div v-if="kitDlg.loading" v-loading="true" style="height:100px"></div>
      <div v-else-if="kitDlg.result">
        <el-row :gutter="16" style="margin-bottom:12px">
          <el-col :span="8"><el-card shadow="hover"><el-statistic title="齐套率" :value="kitDlg.result.kit_rate" suffix="%">
            <template #suffix><el-tag :type="kitDlg.result.kit_rate >= 100 ? 'success' : kitDlg.result.kit_rate >= 70 ? 'warning' : 'danger'" size="small">{{ kitDlg.result.kit_rate >= 100 ? '齐全' : kitDlg.result.kit_rate >= 70 ? '部分缺料' : '严重缺料' }}</el-tag></template>
          </el-statistic></el-card></el-col>
          <el-col :span="8"><el-card shadow="hover"><el-statistic title="需料项" :value="kitDlg.result.total_items"/></el-card></el-col>
          <el-col :span="8"><el-card shadow="hover"><el-statistic title="缺料项" :value="kitDlg.result.missing_items"><template #suffix><el-tag v-if="kitDlg.result.missing_items > 0" type="danger" size="small">!</el-tag></template></el-statistic></el-card></el-col>
        </el-row>
        <el-table :data="kitDlg.result.items||[]" size="small" border max-height="300">
          <el-table-column prop="material_code" label="物料编码" width="100" />
          <el-table-column prop="material_name" label="名称" min-width="140" />
          <el-table-column prop="required_qty" label="需求量" width="80" align="right" />
          <el-table-column prop="available_qty" label="库存" width="80" align="right" />
          <el-table-column prop="shortage" label="缺料" width="80" align="right">
            <template #default="{row}"><span :style="{color: row.shortage > 0 ? '#f56c6c' : '#67c23a', fontWeight: 'bold'}">{{ row.shortage }}</span></template>
          </el-table-column>
          <el-table-column label="状态" width="80" align="center">
            <template #default="{row}"><el-tag :type="row.shortage > 0 ? 'danger' : 'success'" size="small">{{ row.shortage > 0 ? '缺料' : '充足' }}</el-tag></template>
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
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Api } from '../api'
import { ElMessage } from 'element-plus'

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
const instances = ref<any[]>([])
const rows = ref<any[]>([])
const loading = ref(false)
const kitDlg = reactive({ show: false, wo_code: '', loading: false, result: null })
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

const statuses = [
  { value: 'pending', label: '待开始' },
  { value: 'in_progress', label: '进行中' },
  { value: 'paused', label: '已暂停' },
  { value: 'completed', label: '已完成' },
  { value: 'issue', label: '异常' },
  { value: 'rework', label: '返工' }
]
const woStatusTagType = (s: string) => ({ pending: 'info', in_progress: 'primary', paused: 'warning', completed: 'success', issue: 'danger', rework: 'danger' }[s] || 'info')
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
    workers.value = (allWorkers || []).filter((w: any) => w.availability !== 'offline')
    workstations.value = await Api.workstations()
  } catch (_) {}
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

watch(() => route.query.tab, () => {
  const next = routeTab()
  if (next !== activeTab.value) {
    activeTab.value = next
    onTabChange(next)
  }
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
    ElMessage.error(e.response?.data?.error || '派工失败')
  } finally {
    dispatchDlg.loading = false
  }
}

onMounted(() => {
  load()
  loadWorkersAndStations()
  if (activeTab.value === 'dispatch') loadDispatchable()
})
</script>
