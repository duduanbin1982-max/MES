<template>
  <div class="page" v-loading="loading">
    <div class="page-header">
      <div class="page-title"><el-icon><Calendar /></el-icon> 调度看板</div>
      <div class="page-actions">
        <el-button type="primary" plain @click="openReschedule">批量重排程</el-button>
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

    <!-- 2026-11-03：批量重排程（只改计划时间，可撤销） -->
    <el-dialog v-model="rescheduleVisible" title="批量重排程（只改计划时间）" width="820px" :close-on-click-modal="false">
      <el-form :model="rescheduleForm" label-width="110px" size="small">
        <el-form-item label="项目范围">
          <el-select v-model="rescheduleForm.instance_id" clearable placeholder="全部项目" style="width: 100%">
            <el-option
              v-for="item in instances"
              :key="item.id"
              :label="`${item.instance_code || ''} · ${item.instance_name || ''}`"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="处理范围">
          <el-checkbox v-model="rescheduleForm.only_overdue">只处理「未开工且计划已过期」</el-checkbox>
          <div class="reschedule-tip">只调整 planned_start / planned_end；不改状态、派工和实际时间。已开工 / 已完成节点不在范围内。</div>
        </el-form-item>
        <el-form-item label="重排方式">
          <el-radio-group v-model="rescheduleForm.mode">
            <el-radio value="anchor">对齐到日期</el-radio>
            <el-radio value="days">顺延天数</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="rescheduleForm.mode === 'anchor'" label="目标日期">
          <el-date-picker v-model="rescheduleForm.anchor_date" type="date" value-format="YYYY-MM-DD" style="width: 200px" />
          <span class="reschedule-tip">把该范围最早的工序计划开始时间对齐到这一天，其余按原相对间隔平移。</span>
        </el-form-item>
        <el-form-item v-else label="顺延天数">
          <el-input-number v-model="rescheduleForm.shift_days" :min="1" :max="365" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="rescheduleForm.note" placeholder="例如：11 月计划重排 / 排程过期修正" />
        </el-form-item>
      </el-form>

      <div v-if="previewStats" class="reschedule-summary">
        将调整 <strong>{{ previewStats.total }}</strong> 个工序节点（{{ previewStats.instance_count }} 个项目），实际顺延
        <strong>{{ previewShiftDays }}</strong> 天
      </div>
      <el-table v-if="previewItems.length" :data="previewItems" size="small" border max-height="260">
        <el-table-column prop="instance_code" label="项目" width="140" />
        <el-table-column prop="operation_name" label="工序" min-width="110" />
        <el-table-column prop="status" label="状态" width="90" />
        <el-table-column label="计划开始（旧 → 新）" min-width="220">
          <template #default="{ row }">{{ row.old_planned_start || '-' }} → {{ row.new_planned_start || '-' }}</template>
        </el-table-column>
        <el-table-column label="计划结束（旧 → 新）" min-width="260">
          <template #default="{ row }">{{ row.old_planned_end || '-' }} → {{ row.new_planned_end || '-' }}</template>
        </el-table-column>
      </el-table>

      <template #footer>
        <el-button @click="rescheduleVisible = false">取消</el-button>
        <el-button :loading="previewLoading" @click="loadReschedulePreview">预览</el-button>
        <el-button type="primary" :disabled="!previewStats || !previewStats.total" :loading="applyingReschedule" @click="applyReschedule">
          应用（{{ previewStats?.total || 0 }} 条）
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Api } from '../api'
import { useSchedulePage } from '../composables/useSchedulePage'

const {
  activeTab,
  instances,
  selectedInstance,
  milestones,
  filters,
  loading,
  weeklyWeek,
  weeklyData,
  activeEquipments,
  assignDialogVisible,
  assignRow,
  assignForm,
  workers,
  workstations,
  weeklyEquipments,
  weeklySummary,
  msTagType,
  milestoneStatusLabel,
  msProgress,
  nodeStatusTag,
  nodeStatusLabel,
  loadSchedule,
  markActive,
  markComplete,
  loadWeekly,
  goCurrentWeek,
  nodeAction,
  openAssign,
  submitAssign,
  onTabChange,
  load,
} = useSchedulePage()

// ---------------- 批量重排程（2026-11-03） ----------------
const rescheduleVisible = ref(false)
const previewLoading = ref(false)
const applyingReschedule = ref(false)
const previewStats = ref<{ total: number; instance_count: number } | null>(null)
const previewShiftDays = ref(0)
const previewItems = ref<any[]>([])
const rescheduleForm = ref({
  instance_id: null as number | null,
  only_overdue: true,
  mode: 'anchor' as 'anchor' | 'days',
  anchor_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
  shift_days: 30,
  note: '',
})

const reschedulePayload = () => {
  const base: any = {
    instance_id: rescheduleForm.value.instance_id || undefined,
    only_overdue: rescheduleForm.value.only_overdue,
    note: rescheduleForm.value.note || undefined,
  }
  if (rescheduleForm.value.mode === 'anchor') base.anchor_date = rescheduleForm.value.anchor_date
  else base.shift_days = rescheduleForm.value.shift_days
  return base
}

const openReschedule = () => {
  previewStats.value = null
  previewItems.value = []
  rescheduleVisible.value = true
}

const loadReschedulePreview = async () => {
  if (!reschedulePayload().anchor_date && !reschedulePayload().shift_days) {
    ElMessage.warning('请选择目标日期或填写顺延天数')
    return
  }
  previewLoading.value = true
  try {
    const data: any = await Api.get('/schedule/reschedule/preview', { params: reschedulePayload() })
    previewStats.value = data.stats
    previewShiftDays.value = data.shift_days
    previewItems.value = data.items || []
    if (!data.stats?.total) ElMessage.warning('没有符合条件的工序节点（检查范围与"只处理过期"选项）')
  } catch (error: any) {
    ElMessage.error('预览失败: ' + (error?.response?.data?.message || error?.message || error))
  } finally {
    previewLoading.value = false
  }
}

const applyReschedule = async () => {
  if (!previewStats.value?.total) return
  try {
    await ElMessageBox.confirm(
      `将调整 ${previewStats.value.total} 个工序节点的计划时间（顺延 ${previewShiftDays.value} 天），不改状态与实际时间。确认应用？`,
      '确认批量重排程',
      { type: 'warning' },
    )
  } catch { return }
  applyingReschedule.value = true
  try {
    const result: any = await Api.post('/schedule/reschedule/apply', reschedulePayload())
    ElMessage.success(`已应用：${result.node_count} 个节点，批次号 ${result.batch_no}`)
    rescheduleVisible.value = false
    previewStats.value = null
    previewItems.value = []
    await load()
  } catch (error: any) {
    ElMessage.error('应用失败: ' + (error?.response?.data?.message || error?.message || error))
  } finally {
    applyingReschedule.value = false
  }
}
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
.reschedule-tip {
  color: var(--el-color-info);
  font-size: 12px;
  line-height: 1.6;
}

.reschedule-summary {
  margin: 4px 0 10px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--el-color-warning-light-9);
  color: var(--color-text);
  font-size: 13px;
}
</style>
