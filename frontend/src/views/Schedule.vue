<template>
  <div class="page" v-loading="loading">
    <div class="page-header">
      <div class="page-title"><el-icon><Calendar /></el-icon> 调度看板</div>
      <div class="page-actions">
        <el-button @click="load">刷新</el-button>
      </div>
    </div>

    <el-tabs v-model="activeTab" @tab-change="onTabChange">
      <el-tab-pane label="本周任务" name="weekly">
        <el-card class="toolbar-card">
          <el-form :inline="true" class="toolbar-form">
            <el-form-item label="周次">
              <el-date-picker
                v-model="weeklyWeek"
                type="week"
                format="YYYY 第 ww 周"
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

        <el-card v-if="weeklyData" class="summary-card">
          <div class="summary-tags">
            <el-tag type="info">总计 {{ weeklySummary.total }}</el-tag>
            <el-tag type="success">已完成 {{ weeklySummary.completed }}</el-tag>
            <el-tag type="warning">进行中 {{ weeklySummary.in_progress }}</el-tag>
            <el-tag type="info">待开始 {{ weeklySummary.pending }}</el-tag>
            <el-tag type="danger">延期/阻塞 {{ weeklySummary.delayed }}</el-tag>
          </div>
        </el-card>

        <el-card v-if="weeklyData">
          <el-collapse v-if="weeklyEquipments.length" v-model="activeEquipments">
            <el-collapse-item
              v-for="eq in weeklyEquipments"
              :key="eq.id || eq.instance_id"
              :name="eq.id || eq.instance_id"
            >
              <template #title>
                <div class="equipment-title">
                  <span class="equipment-name">[{{ eq.instance_code }}] {{ eq.instance_name }}</span>
                  <span class="progress-text">进度 {{ eq.progress_pct || 0 }}%</span>
                  <el-progress
                    :percentage="eq.progress_pct || 0"
                    class="equipment-progress"
                    :status="eq.progress_pct === 100 ? 'success' : ''"
                  />
                </div>
              </template>

              <el-table
                :data="eq.process_nodes || eq.nodes || []"
                stripe
                size="small"
                class="clickable-table"
                @row-click="openAssign"
              >
                <el-table-column prop="sequence" label="序号" width="60" />
                <el-table-column prop="operation_name" label="工序" min-width="140" />
                <el-table-column label="阶段" width="90">
                  <template #default="{ row }">
                    <el-tag size="small">{{ row.phase_code || '-' }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="estimated_hours" label="预估工时(h)" width="120" />
                <el-table-column label="计划时间" width="230">
                  <template #default="{ row }">{{ row.planned_start || '-' }} ~ {{ row.planned_end || '-' }}</template>
                </el-table-column>
                <el-table-column label="工位" width="120">
                  <template #default="{ row }">{{ row.workstation_name || '-' }}</template>
                </el-table-column>
                <el-table-column label="负责人" width="110">
                  <template #default="{ row }">{{ row.assigned_name || '-' }}</template>
                </el-table-column>
                <el-table-column label="状态" width="95">
                  <template #default="{ row }">
                    <el-tag :type="nodeStatusTag(row.status)" size="small">{{ nodeStatusLabel(row.status) }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="快速操作" width="270" fixed="right">
                  <template #default="{ row }">
                    <el-button size="small" type="primary" @click.stop="nodeAction(row, 'in_progress')" :disabled="row.status === 'completed' || row.status === 'in_progress'">开始</el-button>
                    <el-button size="small" type="success" @click.stop="nodeAction(row, 'completed')" :disabled="row.status === 'completed'"><el-icon><Select /></el-icon> 完成</el-button>
                    <el-button size="small" type="danger" @click.stop="nodeAction(row, 'blocked')" :disabled="row.status === 'blocked'"><el-icon><CircleClose /></el-icon> 阻塞</el-button>
                    <el-button size="small" type="warning" @click.stop="nodeAction(row, 'pending')" :disabled="row.status === 'pending'">暂停</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </el-collapse-item>
          </el-collapse>
          <el-empty v-else description="本周暂无任务" :image-size="60" />
        </el-card>
      </el-tab-pane>

      <el-tab-pane label="项目排程" name="schedule">
        <el-card class="toolbar-card">
          <el-form :inline="true" :model="filters" class="toolbar-form">
            <el-form-item label="实例">
              <el-select v-model="selectedInstance" placeholder="选实例" style="width: 280px" @change="loadSchedule">
                <el-option v-for="i in instances" :key="i.id" :label="i.instance_code + ' | ' + (i.instance_name || '')" :value="i.id" />
              </el-select>
            </el-form-item>
          </el-form>
        </el-card>
        <el-card v-if="selectedInstance" class="content-card">
          <el-table v-if="milestones.length" :data="milestones" stripe size="small">
            <el-table-column prop="phase_code" label="阶段" width="80" />
            <el-table-column prop="phase_name" label="名称" width="140" />
            <el-table-column label="状态" width="105">
              <template #default="{ row }">
                <el-tag :type="msTagType(row.status)" size="small">{{ milestoneStatusLabel(row.status) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="计划时间" width="240">
              <template #default="{ row }">{{ row.planned_start || '-' }} → {{ row.planned_end || '-' }}</template>
            </el-table-column>
            <el-table-column label="实际时间" width="240">
              <template #default="{ row }">{{ row.actual_start || '-' }} → {{ row.actual_end || '-' }}</template>
            </el-table-column>
            <el-table-column label="进度" min-width="260">
              <template #default="{ row }">
                <el-progress :percentage="msProgress(row)" :status="row.status === 'completed' ? 'success' : (row.status === 'delayed' ? 'exception' : '')" />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="170">
              <template #default="{ row }">
                <el-button v-if="row.status !== 'completed'" size="small" type="success" @click="markComplete(row)"><el-icon><Select /></el-icon> 完成</el-button>
                <el-button v-if="row.status === 'pending'" size="small" type="primary" @click="markActive(row)">开始</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-else description="该实例没有里程碑" :image-size="60" />
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="assignDialogVisible" title="分配 / 调整工序" width="520px" @close="assignRow = null">
      <el-form v-if="assignRow" label-width="100px">
        <el-form-item label="负责人" required>
          <el-select v-model="assignForm.assigned_id" placeholder="选择工人" style="width: 100%" filterable>
            <el-option v-for="worker in workers" :key="worker.id" :label="worker.full_name || worker.name || worker.username" :value="worker.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="计划开始">
          <el-date-picker v-model="assignForm.planned_start" type="date" placeholder="计划开始" style="width: 100%" value-format="YYYY-MM-DD" />
        </el-form-item>
        <el-form-item label="计划结束">
          <el-date-picker v-model="assignForm.planned_end" type="date" placeholder="计划结束" style="width: 100%" value-format="YYYY-MM-DD" />
        </el-form-item>
        <el-form-item label="工作站">
          <el-select v-model="assignForm.workstation_id" placeholder="选择工作站" style="width: 100%" filterable clearable>
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

const activeTab = ref('weekly')

const instances = ref<any[]>([])
const selectedInstance = ref<any>(undefined)
const milestones = ref<any[]>([])
const filters = ref({})
const loading = ref(false)

const weeklyWeek = ref<any>(new Date())
const weeklyData = ref<any>(null)
const activeEquipments = ref<number[]>([])
const assignDialogVisible = ref(false)
const assignRow = ref<any>(null)
const assignForm = ref<any>({ assigned_id: null, planned_start: '', planned_end: '', workstation_id: null })
const workers = ref<any[]>([])
const workstations = ref<any[]>([])

const weeklyEquipments = computed(() => weeklyData.value?.equipment_instances || weeklyData.value?.equipment || [])

const weeklySummary = computed(() => {
  const summary = weeklyData.value?.summary || {}
  return {
    total: Number(summary.total ?? summary.total_nodes ?? 0),
    completed: Number(summary.completed || 0),
    in_progress: Number(summary.in_progress || 0),
    pending: Number(summary.pending || 0),
    delayed: Number(summary.delayed || 0)
  }
})

const msTagType = (status: string) => ({ pending: 'info', active: 'primary', completed: 'success', delayed: 'danger' }[status] || 'info')
const milestoneStatusLabel = (status: string) => ({ pending: '待开始', active: '进行中', completed: '已完成', delayed: '延期' }[status] || status)
const msProgress = (milestone: any) => {
  if (milestone.status === 'completed') return 100
  if (milestone.status === 'active') return 50
  if (milestone.status === 'delayed') return 25
  return 0
}

const nodeStatusTag = (status: string) => {
  const map: Record<string, string> = { completed: 'success', in_progress: 'warning', pending: 'info', delayed: 'danger', blocked: 'danger' }
  return map[status] || 'info'
}

const nodeStatusLabel = (status: string) => {
  const map: Record<string, string> = { completed: '已完成', in_progress: '进行中', pending: '待开始', delayed: '延期', blocked: '阻塞' }
  return map[status] || status || '待开始'
}

const loadSchedule = async () => {
  loading.value = true
  try {
    if (instances.value.length === 0) instances.value = await api.get('/equipment_instances')
    if (selectedInstance.value) {
      milestones.value = await api.get('/equipment_instances/' + selectedInstance.value + '/milestones')
    }
  } catch (error: any) {
    ElMessage.error('加载调度数据失败: ' + (error?.message || error))
  } finally {
    loading.value = false
  }
}

const markActive = async (milestone: any) => {
  loading.value = true
  try {
    await api.put('/milestones/' + milestone.id, { status: 'active', actual_start: new Date().toISOString().slice(0, 10) })
    ElMessage.success(milestone.phase_code + ' 已开始')
    await loadSchedule()
  } catch (error: any) {
    ElMessage.error('激活里程碑失败: ' + (error?.message || error))
  } finally {
    loading.value = false
  }
}

const markComplete = async (milestone: any) => {
  loading.value = true
  try {
    await api.put('/milestones/' + milestone.id, { status: 'completed', actual_end: new Date().toISOString().slice(0, 10) })
    ElMessage.success(milestone.phase_code + ' 已完成')
    await loadSchedule()
  } catch (error: any) {
    ElMessage.error('完成里程碑失败: ' + (error?.message || error))
  } finally {
    loading.value = false
  }
}

const loadWeekly = async () => {
  loading.value = true
  try {
    const selectedDate = weeklyWeek.value
    if (!selectedDate) return
    const dateStr = selectedDate instanceof Date ? selectedDate.toISOString().slice(0, 10) : String(selectedDate).slice(0, 10)
    weeklyData.value = await api.get('/schedule/weekly', { params: { date: dateStr } })
    activeEquipments.value = weeklyEquipments.value.map((equipment: any) => equipment.id || equipment.instance_id)
  } catch (error: any) {
    ElMessage.error('加载周调度失败: ' + (error?.message || error))
  } finally {
    loading.value = false
  }
}

const goCurrentWeek = () => {
  weeklyWeek.value = new Date()
  loadWeekly()
}

const nodeAction = async (row: any, status: string) => {
  loading.value = true
  try {
    const payload: any = { status }
    if (status === 'in_progress') payload.actual_start = new Date().toISOString()
    if (status === 'completed') payload.actual_end = new Date().toISOString()
    await api.put('/schedule/process-nodes/' + row.id + '/status', payload)
    ElMessage.success('工序状态已更新为：' + nodeStatusLabel(status))
    await loadWeekly()
  } catch (error: any) {
    ElMessage.error('更新工序状态失败: ' + (error?.message || error))
  } finally {
    loading.value = false
  }
}

const openAssign = async (row: any) => {
  loading.value = true
  try {
    assignRow.value = row
    assignForm.value = {
      assigned_id: row.assigned_id || row.assigned_to || null,
      planned_start: row.planned_start || '',
      planned_end: row.planned_end || '',
      workstation_id: row.workstation_id || row.required_workstation_id || null
    }
    const [workerResult, workstationResult] = await Promise.all([
      api.get('/resources/workers', { params: { available: 1 } }),
      api.get('/resources/workstations')
    ])
    workers.value = workerResult?.workers || workerResult || []
    workstations.value = workstationResult?.workstations || workstationResult || []
    assignDialogVisible.value = true
  } catch (error: any) {
    ElMessage.error('打开分配对话失败: ' + (error?.message || error))
  } finally {
    loading.value = false
  }
}

const submitAssign = async () => {
  loading.value = true
  try {
    if (!assignRow.value) return
    if (!assignForm.value.assigned_id) {
      ElMessage.warning('请选择负责人')
      return
    }
    await api.put('/schedule/process-nodes/' + assignRow.value.id + '/assign', {
      user_id: assignForm.value.assigned_id,
      planned_start: assignForm.value.planned_start || null,
      planned_end: assignForm.value.planned_end || null,
      workstation_id: assignForm.value.workstation_id || null
    })
    ElMessage.success('分配成功')
    assignDialogVisible.value = false
    await loadWeekly()
  } catch (error: any) {
    ElMessage.error('提交分配失败: ' + (error?.message || error))
  } finally {
    loading.value = false
  }
}

const onTabChange = (tabName: string) => {
  if (tabName === 'weekly') loadWeekly()
  if (tabName === 'schedule') loadSchedule()
}

const load = () => {
  if (activeTab.value === 'weekly') loadWeekly()
  else loadSchedule()
}

onMounted(async () => {
  await Promise.all([loadWeekly(), loadSchedule()])
})
</script>

<style scoped>
.toolbar-card,
.summary-card,
.content-card {
  margin-bottom: 12px;
}

.toolbar-form {
  margin-bottom: 0;
}

.summary-tags,
.equipment-title {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.equipment-title {
  width: 100%;
}

.equipment-name {
  font-weight: 600;
}

.progress-text {
  font-size: 13px;
  color: var(--el-color-info);
}

.equipment-progress {
  flex: 1;
  max-width: 300px;
}

.clickable-table {
  cursor: pointer;
}
</style>
