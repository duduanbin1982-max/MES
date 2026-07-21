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
