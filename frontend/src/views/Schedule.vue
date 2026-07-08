<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title">📅 调度看板</div>
      <el-button @click="load">刷新</el-button>
    </div>

    <el-tabs v-model="activeTab" @tab-change="onTabChange">
      <!-- ========== Tab: 本周任务 ========== -->
      <el-tab-pane label="本周任务" name="weekly">
        <el-card style="margin-bottom: 12px">
          <el-form :inline="true" style="margin-bottom: 0">
            <el-form-item label="周次">
              <el-date-picker
                v-model="weeklyWeek"
                type="week"
                format="yyyy 第 ww 周"
                placeholder="选择周"
                value-format="YYYY-MM-DD"
                @change="loadWeekly"
              />
            </el-form-item>
            <el-form-item>
              <el-button @click="goCurrentWeek">本周</el-button>
            </el-form-item>
          </el-form>
        </el-card>

        <el-card v-if="weeklyData" style="margin-bottom: 12px">
          <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap">
            <el-tag type="info">总计 {{ weeklySummary.total }}</el-tag>
            <el-tag type="success">已完成 {{ weeklySummary.completed }}</el-tag>
            <el-tag type="warning">进行中 {{ weeklySummary.in_progress }}</el-tag>
            <el-tag type="info">待开始 {{ weeklySummary.pending }}</el-tag>
            <el-tag type="danger">延期 {{ weeklySummary.delayed }}</el-tag>
          </div>
        </el-card>

        <el-card v-if="weeklyData">
          <el-collapse v-model="activeEquipments">
            <el-collapse-item
              v-for="eq in weeklyData.equipment_instances"
              :key="eq.id"
              :name="eq.id"
            >
              <template #title>
                <div style="display: flex; align-items: center; gap: 16px; width: 100%">
                  <span style="font-weight: bold">[{{ eq.instance_code }}] {{ eq.instance_name }}</span>
                  <span style="font-size: 13px; color: #909399">进度 {{ eq.progress_pct }}%</span>
                  <el-progress :percentage="eq.progress_pct" style="flex: 1; max-width: 300px" :status="eq.progress_pct === 100 ? 'success' : ''" />
                </div>
              </template>

              <el-table
                :data="eq.process_nodes"
                stripe
                size="small"
                :row-class-name="rowClassName"
                @row-click="openAssign"
                style="cursor: pointer"
              >
                <el-table-column prop="sequence" label="序号" width="60" />
                <el-table-column prop="operation_name" label="工序" min-width="140" />
                <el-table-column label="阶段" width="80">
                  <template #default="{ row }">
                    <el-tag size="small">{{ row.phase_code }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="estimated_hours" label="预估工时(h)" width="110" />
                <el-table-column label="计划时间" width="210">
                  <template #default="{ row }">{{ row.planned_start || '-' }} ~ {{ row.planned_end || '-' }}</template>
                </el-table-column>
                <el-table-column prop="assigned_name" label="负责人" width="100" />
                <el-table-column label="状态" width="90">
                  <template #default="{ row }">
                    <el-tag :type="nodeStatusTag(row.status)" size="small">{{ nodeStatusLabel(row.status) }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="快速操作" width="260" fixed="right">
                  <template #default="{ row }">
                    <el-button size="small" type="primary" @click.stop="nodeAction(row, 'in_progress')" :disabled="row.status === 'completed' || row.status === 'in_progress'">▶ 开始</el-button>
                    <el-button size="small" type="success" @click.stop="nodeAction(row, 'completed')" :disabled="row.status === 'completed'">✓ 完成</el-button>
                    <el-button size="small" type="danger" @click.stop="nodeAction(row, 'blocked')" :disabled="row.status === 'blocked'">🚫 阻塞</el-button>
                    <el-button size="small" type="warning" @click.stop="nodeAction(row, 'pending')" :disabled="row.status === 'pending'">⏸ 暂停</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </el-collapse-item>
          </el-collapse>
          <el-empty v-if="!weeklyData.equipment_instances || weeklyData.equipment_instances.length === 0" description="本周暂无任务" :image-size="60" />
        </el-card>
      </el-tab-pane>

      <!-- ========== Tab: 项目排程 (existing) ========== -->
      <el-tab-pane label="项目排程" name="schedule">
        <el-card>
          <el-form :inline="true" :model="filters">
            <el-form-item label="实例">
              <el-select v-model="selectedInstance" placeholder="选实例" style="width: 280px" @change="loadSchedule">
                <el-option v-for="i in instances" :key="i.id" :label="i.instance_code + ' | ' + (i.instance_name || '')" :value="i.id" />
              </el-select>
            </el-form-item>
          </el-form>
        </el-card>
        <el-card v-if="selectedInstance" style="margin-top: 12px">
          <div v-if="milestones.length">
            <el-table :data="milestones" stripe size="small">
              <el-table-column prop="phase_code" label="阶段" width="80" />
              <el-table-column prop="phase_name" label="名称" width="120" />
              <el-table-column label="状态" width="100">
                <template #default="{ row }">
                  <el-tag :type="msTagType(row.status)" size="small">{{ row.status }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="计划时间" width="240">
                <template #default="{ row }">{{ row.planned_start || '-' }} → {{ row.planned_end || '-' }}</template>
              </el-table-column>
              <el-table-column label="实际时间" width="240">
                <template #default="{ row }">{{ row.actual_start || '-' }} → {{ row.actual_end || '-' }}</template>
              </el-table-column>
              <el-table-column label="进度" min-width="300">
                <template #default="{ row }">
                  <el-progress :percentage="msProgress(row)" :status="row.status === 'completed' ? 'success' : (row.status === 'delayed' ? 'exception' : '')" />
                </template>
              </el-table-column>
              <el-table-column label="操作" width="160">
                <template #default="{ row }">
                  <el-button v-if="row.status !== 'completed'" size="small" type="success" @click="markComplete(row)">✓ 完成</el-button>
                  <el-button v-if="row.status === 'pending'" size="small" type="primary" @click="markActive(row)">开始</el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
          <el-empty v-else description="该实例没有里程碑" :image-size="60" />
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <!-- Assign dialog -->
    <el-dialog v-model="assignDialogVisible" title="分配 / 调整工序" width="520px" @close="assignRow = null">
      <el-form v-if="assignRow" label-width="100px">
        <el-form-item label="负责人">
          <el-select v-model="assignForm.assigned_id" placeholder="选择工人" style="width: 100%" filterable>
            <el-option v-for="w in workers" :key="w.id" :label="w.name" :value="w.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="计划开始">
          <el-date-picker v-model="assignForm.planned_start" type="date" placeholder="计划开始" style="width: 100%" value-format="YYYY-MM-DD" />
        </el-form-item>
        <el-form-item label="计划结束">
          <el-date-picker v-model="assignForm.planned_end" type="date" placeholder="计划结束" style="width: 100%" value-format="YYYY-MM-DD" />
        </el-form-item>
        <el-form-item label="工作站">
          <el-select v-model="assignForm.workstation_id" placeholder="选择工作站" style="width: 100%" filterable>
            <el-option v-for="ws in workstations" :key="ws.id" :label="ws.name" :value="ws.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="assignDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitAssign">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'

// ---- Tab state ----
const activeTab = ref('weekly')

// ---- Existing: Schedule tab (project milestones) ----
const instances = ref<any[]>([])
const selectedInstance = ref<any>(undefined)
const milestones = ref<any[]>([])
const filters = ref({})

const msTagType = (s: string) => ({ pending: 'info', active: 'primary', completed: 'success', delayed: 'danger' }[s] || 'info')
const msProgress = (m: any) => {
  if (m.status === 'completed') return 100
  if (m.status === 'active') return 50
  if (m.status === 'delayed') return 25
  return 0
}

const loadSchedule = async () => {
  if (instances.value.length === 0) instances.value = await api.get('/equipment_instances')
  if (selectedInstance.value) {
    milestones.value = await api.get('/equipment_instances/' + selectedInstance.value + '/milestones')
  }
}

const markActive = async (m: any) => {
  await api.put('/milestones/' + m.id, { status: 'active' })
  ElMessage.success(m.phase_code + ' 已开始')
  loadSchedule()
}

const markComplete = async (m: any) => {
  await api.put('/milestones/' + m.id, { status: 'completed', actual_end: new Date().toISOString().slice(0, 10) })
  ElMessage.success(m.phase_code + ' 已完成')
  loadSchedule()
}

// ---- New: Weekly tab ----
const weeklyWeek = ref(new Date())
const weeklyData = ref<any>(null)
const activeEquipments = ref<number[]>([])
const assignDialogVisible = ref(false)
const assignRow = ref<any>(null)
const assignForm = ref({ assigned_id: null, planned_start: '', planned_end: '', workstation_id: null })
const workers = ref<any[]>([])
const workstations = ref<any[]>([])

const weeklySummary = computed(() => {
  if (!weeklyData.value || !weeklyData.value.summary) return { total: 0, completed: 0, in_progress: 0, pending: 0, delayed: 0 }
  return weeklyData.value.summary
})

const nodeStatusTag = (status: string) => {
  const map: Record<string, string> = { completed: 'success', in_progress: 'warning', pending: 'info', delayed: 'danger', blocked: 'danger' }
  return map[status] || 'info'
}

const nodeStatusLabel = (status: string) => {
  const map: Record<string, string> = { completed: '已完成', in_progress: '进行中', pending: '待开始', delayed: '延期', blocked: '阻塞' }
  return map[status] || status
}

const rowClassName = ({ row }: { row: any }) => {
  if (row.status === 'in_progress') return 'row-in-progress'
  if (row.status === 'delayed' || row.status === 'blocked') return 'row-delayed'
  if (row.status === 'completed') return 'row-completed'
  return ''
}

const loadWeekly = async () => {
  const d = weeklyWeek.value
  if (!d) return
  const dateStr = d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)
  weeklyData.value = await api.get('/schedule/weekly', { params: { week: dateStr } })
  if (weeklyData.value && weeklyData.value.equipment_instances) {
    activeEquipments.value = weeklyData.value.equipment_instances.map((e: any) => e.id)
  }
}

const goCurrentWeek = () => {
  weeklyWeek.value = new Date()
  loadWeekly()
}

const nodeAction = async (row: any, status: string) => {
  const payload: any = { status }
  if (status === 'in_progress') {
    payload.actual_start = new Date().toISOString()
  }
  if (status === 'completed') {
    payload.actual_end = new Date().toISOString()
  }
  await api.put('/api/schedule/process-nodes/' + row.id, payload)
  ElMessage.success('工序状态已更新为：' + nodeStatusLabel(status))
  loadWeekly()
}

const openAssign = async (row: any, _column: any, _event: any) => {
  assignRow.value = row
  assignForm.value = {
    assigned_id: row.assigned_id || null,
    planned_start: row.planned_start || '',
    planned_end: row.planned_end || '',
    workstation_id: row.workstation_id || null
  }
  const [w, ws] = await Promise.all([
    api.get('/api/resources/workers', { params: { available: 1 } }),
    api.get('/workstations')
  ])
  workers.value = w || []
  workstations.value = ws || []
  assignDialogVisible.value = true
}

const submitAssign = async () => {
  if (!assignRow.value) return
  await api.put('/api/schedule/process-nodes/' + assignRow.value.id + '/assign', assignForm.value)
  ElMessage.success('分配成功')
  assignDialogVisible.value = false
  loadWeekly()
}

const onTabChange = (tabName: string) => {
  if (tabName === 'weekly') {
    loadWeekly()
  }
}

const load = () => {
  loadSchedule()
}

onMounted(() => {
  loadWeekly()
  loadSchedule()
})
</script>

<style scoped>
.row-in-progress {
  background-color: #dbeafe !important;
}
.row-delayed {
  background-color: #fee2e2 !important;
}
.row-completed {
  background-color: #dcfce7 !important;
}
</style>
