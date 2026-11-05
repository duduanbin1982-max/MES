<template>
  <div class="page schedule-page" v-loading="loading">
    <div class="page-header">
      <div>
        <div class="page-title"><el-icon><Calendar /></el-icon> 项目排程</div>
        <div class="page-subtitle">
          按周看各项目的工序计划、执行状态与异常（超期 / 受阻 / 未排程）。
          本周任务 = 与所选周重叠的工序 + 未排程工序；跨项目视角，单项目深度视图见「单项目甘特」。
        </div>
      </div>
      <div class="page-actions">
        <span v-if="refreshAtText" class="refresh-hint">更新于 {{ refreshAtText }}</span>
        <el-button @click="refreshAll"><el-icon><Refresh /></el-icon> 刷新</el-button>
        <el-button @click="openBatches"><el-icon><Tickets /></el-icon> 批次记录</el-button>
        <el-button type="primary" @click="openReschedule"><el-icon><MagicStick /></el-icon> 批量重排程</el-button>
      </div>
    </div>

    <el-tabs v-model="activeTab" @tab-change="handleTabChange">
      <!-- ------------------------------------------------------------ 本周任务 -->
      <el-tab-pane label="本周任务" name="weekly">
        <!-- KPI 摘要 -->
        <div class="board-summary">
          <div class="summary-tile tile-total">
            <div class="tile-label">本周计划</div>
            <div class="tile-value">{{ weekPlannedCount }}<small>条</small></div>
            <div class="tile-hint">{{ weekLabel || '—' }} · 未完成合计 {{ boardSummary.total }}</div>
          </div>
          <div class="summary-tile tile-done">
            <div class="tile-label">完成率</div>
            <div class="tile-value">{{ boardSummary.completionRate }}<small>%</small></div>
            <el-progress :percentage="boardSummary.completionRate" :stroke-width="6" :show-text="false" class="tile-progress" />
            <div class="tile-hint">完成 {{ boardSummary.completed }} / {{ boardSummary.total }}</div>
          </div>
          <div class="summary-tile tile-running">
            <div class="tile-label">进行中</div>
            <div class="tile-value">{{ boardSummary.running }}<small>条</small></div>
            <div class="tile-hint">已开工未完成</div>
          </div>
          <div
            class="summary-tile tile-abnormal"
            :class="{ 'tile-active': filters.onlyAbnormal }"
            role="button"
            tabindex="0"
            @click="toggleAbnormal"
            @keyup.enter="toggleAbnormal"
          >
            <div class="tile-label">
              异常
              <el-tag v-if="filters.onlyAbnormal" size="small" type="danger" effect="dark">已筛选</el-tag>
            </div>
            <div class="tile-value">{{ abnormalCount }}<small>条</small></div>
            <div class="tile-hint">
              超期 {{ boardSummary.overdue }} · 受阻 {{ boardSummary.blocked }} · 未排程 {{ boardSummary.unscheduled }}
            </div>
          </div>
        </div>

        <!-- 筛选栏 -->
        <el-card class="toolbar-card" shadow="never">
          <div class="filter-bar">
            <div class="filter-item">
              <span class="filter-label">周次</span>
              <el-date-picker
                v-model="weeklyWeek"
                type="week"
                format="YYYY 第 ww 周"
                placeholder="选择周"
                value-format="YYYY-MM-DD"
                @change="loadWeekly"
              />
              <el-button-group class="week-buttons">
                <el-button size="small" @click="shiftWeek(-7)">上一周</el-button>
                <el-button size="small" @click="goCurrentWeek">本周</el-button>
                <el-button size="small" @click="shiftWeek(7)">下一周</el-button>
              </el-button-group>
            </div>
            <div class="filter-item">
              <span class="filter-label">项目</span>
              <el-select v-model="filters.instanceId" clearable placeholder="全部项目" style="width: 220px">
                <el-option
                  v-for="item in instanceOptions"
                  :key="item.id"
                  :label="`${item.instance_code || ''} · ${item.instance_name || ''}`"
                  :value="item.id"
                />
              </el-select>
            </div>
            <div class="filter-item">
              <el-input v-model="filters.keyword" clearable placeholder="搜工序 / 工位 / 负责人" style="width: 200px">
                <template #prefix><el-icon><Search /></el-icon></template>
              </el-input>
            </div>
            <div class="filter-item">
              <el-select v-model="filters.status" clearable placeholder="全部状态" style="width: 130px">
                <el-option v-for="(meta, key) in NODE_STATUS_META" :key="key" :label="meta.label" :value="key" />
              </el-select>
            </div>
            <div class="filter-item">
              <el-checkbox v-model="filters.onlyAbnormal" border size="small">只看异常</el-checkbox>
            </div>
            <el-button v-if="hasFilter" link type="primary" @click="resetFilters">清除筛选</el-button>
            <span class="result-hint">命中 {{ filteredCount }} / {{ boardSummary.total }} 条</span>
          </div>
        </el-card>

        <el-alert
          v-if="weekGuidance"
          class="guidance-alert"
          :type="weekGuidance.type"
          :closable="false"
          show-icon
        >
          <template #title>
            <span>{{ weekGuidance.text }}</span>
            <el-button link type="primary" size="small" @click="$router.push('/gantt')">去单项目甘特重算 →</el-button>
            <el-button link type="primary" size="small" @click="openReschedule">批量平移 →</el-button>
          </template>
        </el-alert>

        <!-- 按项目分组的工序表 -->
        <template v-if="boards.length">
          <el-card v-for="board in boards" :key="board.id" class="equipment-card" shadow="never">
            <div class="equipment-head">
              <div class="equipment-title">
                <span class="eq-code">{{ board.instance_code }}</span>
                <span class="eq-name">{{ board.instance_name }}</span>
                <el-tag v-if="board.stats.overdue" type="danger" size="small">超期 {{ board.stats.overdue }}</el-tag>
                <el-tag v-if="board.stats.blocked" type="danger" size="small" effect="plain">受阻 {{ board.stats.blocked }}</el-tag>
                <el-tag v-if="board.stats.unscheduled" type="info" size="small">未排程 {{ board.stats.unscheduled }}</el-tag>
              </div>
              <div class="equipment-stats">
                <span class="stats-text">完成 {{ board.stats.completed }} / {{ board.stats.total }}</span>
                <el-progress :percentage="board.stats.completionRate" :stroke-width="8" class="stats-progress" />
              </div>
            </div>

            <el-table
              :data="board.nodes"
              size="small"
              stripe
              :row-class-name="rowClassName"
              class="node-table"
              @row-click="openAssign"
            >
              <el-table-column prop="sequence" label="序号" width="60" align="center" />
              <el-table-column label="工序" min-width="200">
                <template #default="{ row }">
                  <div class="node-name">
                    <span>{{ row.operation_name || '（未命名工序）' }}</span>
                    <el-tag
                      v-if="nodePhaseTag(row)"
                      :type="nodePhaseTag(row)!.tone"
                      size="small"
                      effect="plain"
                    >{{ nodePhaseTag(row)!.label }}</el-tag>
                  </div>
                  <div v-if="row.assigned_name" class="node-sub">负责人 {{ row.assigned_name }}</div>
                </template>
              </el-table-column>
              <el-table-column label="阶段" width="86" align="center">
                <template #default="{ row }">
                  <span class="phase-code">{{ row.phase_code || '—' }}</span>
                </template>
              </el-table-column>
              <el-table-column label="计划时间" min-width="200">
                <template #default="{ row }">
                  <span :class="{ 'plan-overdue': isOverdue(row) }" :title="`${row.planned_start || '—'} ~ ${row.planned_end || '—'}`">
                    {{ formatPlanRange(row) }}
                  </span>
                  <el-tag v-if="isOverdue(row)" type="danger" size="small" class="overdue-tag">超 {{ overdueDays(row) }} 天</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="工时" width="80" align="right">
                <template #default="{ row }">{{ row.estimated_hours ?? '—' }}</template>
              </el-table-column>
              <el-table-column label="工位" width="130">
                <template #default="{ row }">{{ row.workstation_name || '—' }}</template>
              </el-table-column>
              <el-table-column label="负责人" width="100">
                <template #default="{ row }">{{ row.assigned_name || '未派工' }}</template>
              </el-table-column>
              <el-table-column label="状态" width="96" align="center">
                <template #default="{ row }">
                  <el-tag :type="nodeStatusTag(row.status)" size="small">{{ nodeStatusLabel(row.status) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="170" fixed="right" align="center">
                <template #default="{ row }">
                  <el-button
                    v-if="primaryAction(row)"
                    size="small"
                    :type="primaryAction(row)!.key === 'start' ? 'primary' : 'success'"
                    @click.stop="nodeAction(row, primaryAction(row)!.key === 'start' ? 'in_progress' : 'completed')"
                  >
                    {{ primaryAction(row)!.label }}
                  </el-button>
                  <el-dropdown trigger="click" @command="(command: string) => onRowCommand(row, command)">
                    <el-button size="small" text>更多<el-icon><ArrowDown /></el-icon></el-button>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="paused" :disabled="row.status === 'paused'">暂停</el-dropdown-item>
                        <el-dropdown-item command="blocked" :disabled="row.status === 'blocked'">标记受阻</el-dropdown-item>
                        <el-dropdown-item command="pending" :disabled="row.status === 'pending'">回到待开始</el-dropdown-item>
                        <el-dropdown-item command="assign" divided>分配 / 调整工序</el-dropdown-item>
                        <el-dropdown-item v-if="row.status !== 'completed'" command="dates">只改计划时间</el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </template>
              </el-table-column>
            </el-table>
          </el-card>
        </template>

        <el-empty v-else-if="!loading" :description="emptyText" :image-size="80">
          <el-button v-if="hasFilter" type="primary" plain @click="resetFilters">清除筛选</el-button>
          <el-button v-else type="primary" @click="openReschedule">去批量重排程</el-button>
        </el-empty>
      </el-tab-pane>

      <!-- ------------------------------------------------------------ 项目里程碑 -->
      <el-tab-pane label="项目里程碑" name="schedule">
        <el-card class="toolbar-card" shadow="never">
          <div class="filter-bar">
            <div class="filter-item">
              <span class="filter-label">项目</span>
              <el-select v-model="selectedInstance" placeholder="选择项目" style="width: 280px" @change="loadSchedule">
                <el-option
                  v-for="i in instances"
                  :key="i.id"
                  :label="`${i.instance_code || ''} · ${i.instance_name || ''}`"
                  :value="i.id"
                />
              </el-select>
            </div>
            <span v-if="milestones.length" class="result-hint">共 {{ milestones.length }} 个里程碑，已完成 {{ milestoneDoneCount }}</span>
            <el-button
              v-if="milestonesMissingPlan > 0"
              size="small"
              type="primary"
              plain
              :loading="milestoneBackfilling"
              @click="backfillMilestones"
            >补齐计划日期（{{ milestonesMissingPlan }} 条）</el-button>
          </div>
        </el-card>

        <el-card v-if="selectedInstance" class="content-card" shadow="never">
          <el-table v-if="milestones.length" :data="milestones" stripe size="small">
            <el-table-column prop="phase_code" label="阶段" width="80" align="center" />
            <el-table-column prop="phase_name" label="名称" min-width="160" />
            <el-table-column label="状态" width="105" align="center">
              <template #default="{ row }">
                <el-tag :type="msTagType(row.status)" size="small">{{ milestoneStatusLabel(row.status) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="计划时间" min-width="170">
              <template #default="{ row }">{{ row.planned_start || '—' }} → {{ row.planned_end || '—' }}</template>
            </el-table-column>
            <el-table-column label="实际时间" min-width="170">
              <template #default="{ row }">{{ row.actual_start || '—' }} → {{ row.actual_end || '—' }}</template>
            </el-table-column>
            <el-table-column label="进度" min-width="220">
              <template #default="{ row }">
                <el-progress
                  :percentage="msProgress(row)"
                  :status="row.status === 'completed' ? 'success' : (row.status === 'delayed' ? 'exception' : '')"
                />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="160" align="center">
              <template #default="{ row }">
                <el-button size="small" @click="openMilestonePlan(row)">计划</el-button>
                <el-button v-if="row.status !== 'completed'" size="small" type="success" @click="markComplete(row)">完成</el-button>
                <el-button v-if="row.status === 'pending'" size="small" type="primary" @click="markActive(row)">开始</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-else description="该实例还没有里程碑" :image-size="70">
            <el-button type="primary" plain @click="$router.push('/process-tree')">去工艺树排程</el-button>
          </el-empty>
        </el-card>
        <el-empty v-else description="先选择一个项目" :image-size="70" />
      </el-tab-pane>

      <!-- ------------------------------------------------------------ 甘特图 -->
      <el-tab-pane label="甘特图" name="gantt">
        <el-card class="toolbar-card" shadow="never">
          <div class="filter-bar">
            <div class="filter-item">
              <span class="filter-label">月份</span>
              <el-button-group>
                <el-button size="small" @click="shiftGanttMonth(-1)">上一月</el-button>
                <el-button size="small" @click="goGanttToday">本月</el-button>
                <el-button size="small" @click="shiftGanttMonth(1)">下一月</el-button>
              </el-button-group>
              <span class="gantt-range">{{ ganttRangeLabel }}</span>
            </div>
            <div class="filter-item">
              <span class="filter-label">项目</span>
              <el-select v-model="ganttInstance" clearable placeholder="全部项目" style="width: 220px" @change="loadGantt">
                <el-option
                  v-for="item in instances"
                  :key="item.id"
                  :label="`${item.instance_code || ''} · ${item.instance_name || ''}`"
                  :value="item.id"
                />
              </el-select>
            </div>
            <div class="filter-item">
              <span class="filter-label">缩放</span>
              <el-radio-group v-model="ganttZoom" size="small">
                <el-radio-button value="day">日</el-radio-button>
                <el-radio-button value="week">周</el-radio-button>
                <el-radio-button value="month">月</el-radio-button>
              </el-radio-group>
            </div>
            <el-button size="small" type="primary" plain @click="openDependencyAdmin">依赖维护</el-button>
            <el-button size="small" :loading="ganttLoading" @click="loadGantt">刷新</el-button>
            <div class="filter-item">
              <span class="filter-label">依赖箭头</span>
              <el-switch v-model="showGanttDeps" size="small" />
            </div>
            <span class="result-hint">{{ ganttSummaryText }}</span>
            <el-button size="small" link type="primary" @click="$router.push('/gantt')">单项目甘特（依赖/进度/重算）→</el-button>
          </div>
        </el-card>

        <el-alert v-if="ganttUnscheduled.length" type="warning" :closable="false" show-icon class="gantt-alert">
          <template #title>
            还有 {{ ganttUnscheduled.length }} 个工序没有计划时间（不会显示在图上）
            <el-button link type="primary" size="small" @click="openReschedule">批量重排程</el-button>
          </template>
        </el-alert>

        <GanttChart
          v-if="ganttGroups.length"
          :groups="ganttGroups"
          :from="ganttFrom"
          :to="ganttTo"
          :zoom="ganttZoom"
          :loading="ganttLoading"
          :dependencies="ganttDependencies"
          :show-dependencies="showGanttDeps"
          @move="onGanttMove"
          @select="onGanttSelect"
        />
        <el-empty v-else-if="!ganttLoading" description="当前月份没有已排程的工序" :image-size="70">
          <el-button type="primary" plain @click="openReschedule">批量重排程</el-button>
        </el-empty>
      </el-tab-pane>
    </el-tabs>

    <!-- ------------------------------------------------------------ 分配 / 改期 -->
    <el-dialog v-model="milestonePlanVisible" title="调整里程碑计划" width="460px">
      <el-form v-if="milestonePlanRow" label-width="90px" size="small">
        <el-form-item label="阶段">
          <span>{{ milestonePlanRow.phase_code }} {{ milestonePlanRow.phase_name }}</span>
        </el-form-item>
        <el-form-item label="计划开始">
          <el-date-picker v-model="milestonePlanForm.planned_start" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="计划结束">
          <el-date-picker v-model="milestonePlanForm.planned_end" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="milestonePlanVisible = false">取消</el-button>
        <el-button type="primary" :loading="milestonePlanSaving" @click="saveMilestonePlan">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="planDialogVisible" title="改期（只改计划时间，不动状态）" width="460px">
      <el-form v-if="planRow" label-width="90px" size="small">
        <el-form-item label="工序">
          <span>#{{ planRow.id }} {{ planRow.operation_name }}</span>
        </el-form-item>
        <el-form-item label="计划开始">
          <el-date-picker v-model="planForm.planned_start" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" style="width: 100%" />
        </el-form-item>
        <el-form-item label="计划结束">
          <el-date-picker v-model="planForm.planned_end" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" style="width: 100%" />
        </el-form-item>
        <el-alert type="info" :closable="false" show-icon title="改期会记录批次（DT-…），可在「批次记录」撤销；若破坏前后置依赖会提示。" />
      </el-form>
      <template #footer>
        <el-button @click="planDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="planSaving" @click="savePlanDates">保存改期</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="assignDialogVisible" title="分配 / 调整工序" width="520px" @close="assignRow = null">
      <el-form v-if="assignRow" label-width="100px" size="small">
        <el-form-item label="工序">
          <span class="assign-node-name">{{ assignRow.operation_name || '（未命名工序）' }}</span>
          <el-tag :type="nodeStatusTag(assignRow.status)" size="small" style="margin-left: 8px">{{ nodeStatusLabel(assignRow.status) }}</el-tag>
        </el-form-item>
        <el-form-item label="负责人" required>
          <el-select v-model="assignForm.assigned_id" placeholder="选择工人" style="width: 100%" filterable>
            <el-option v-for="worker in workers" :key="worker.id" :label="worker.full_name || worker.name || worker.username" :value="worker.id" />
          </el-select>
          <el-checkbox v-model="assignForm.force" class="force-checkbox">无资质强制派工（应急，会记录；技能/证书/文档仍会提示）</el-checkbox>
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

    <!-- ------------------------------------------------------------ 批次记录 -->
    <el-drawer v-model="batchDrawerVisible" title="批量重排程批次记录" size="560px">
      <div class="batch-toolbar">
        <span class="result-hint">最近 {{ batches.length }} 个批次（应用后可整批撤销）</span>
        <el-button size="small" :loading="batchLoading" @click="loadBatches">刷新</el-button>
      </div>
      <el-table :data="batches" size="small" v-loading="batchLoading" empty-text="还没有重排批次">
        <el-table-column prop="batch_no" label="批次号" min-width="140" />
        <el-table-column label="范围" min-width="150">
          <template #default="{ row }">{{ formatBatchScope(row) }}</template>
        </el-table-column>
        <el-table-column prop="node_count" label="节点" width="70" align="right" />
        <el-table-column label="时间" width="140">
          <template #default="{ row }">{{ String(row.created_at || '').slice(5, 16) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="row.undone_at ? 'info' : 'success'" size="small">{{ row.undone_at ? '已撤销' : '生效中' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" align="center">
          <template #default="{ row }">
            <el-button v-if="!row.undone_at" size="small" type="danger" link :loading="batchLoading" @click="confirmUndo(row)">撤销</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-drawer>

    <!-- ------------------------------------------------------------ 批量重排程 -->
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

    <!-- 2026-11-05：依赖维护（类型 / 间隔） -->
    <DependencyAdminDrawer
      v-model="dependencyDrawerVisible"
      :instance-id="ganttInstance"
      @changed="onDependenciesChanged"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Api } from '../api'
import { useSchedulePage } from '../composables/useSchedulePage'
import GanttChart from './schedule/GanttChart.vue'
import DependencyAdminDrawer from './schedule/DependencyAdminDrawer.vue'
import { monthRange, parseDay, toDayString } from '../domain/gantt'
import {
  NODE_PHASE_META,
  NODE_STATUS_META,
  buildEquipmentBoard,
  formatBatchScope,
  formatPlanRange,
  formatWeekLabel,
  isAbnormal,
  isOverdue,
  nodePhase,
  nodeStatusLabel as labelOfStatus,
  nodeStatusTone,
  overlapsWeek,
  overdueDays,
  primaryAction,
  summarizeNodes,
} from '../domain/scheduleBoard'

const {
  activeTab,
  instances,
  selectedInstance,
  milestones,
  loading,
  weeklyWeek,
  weeklyData,
  weeklyEquipments,
  workers,
  workstations,
  assignDialogVisible,
  assignRow,
  assignForm,
  msTagType,
  milestoneStatusLabel,
  msProgress,
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
  refreshAt,
  batches,
  batchLoading,
  loadBatches,
  undoBatch,
} = useSchedulePage()

// 状态展示统一走 domain（composable 已同步同一份映射，这里直接用函数便于模板调用）
const nodeStatusTag = (status?: string) => nodeStatusTone(status)
const nodeStatusLabel = (status?: string) => labelOfStatus(status)

// ------------------------------------------------------------ 筛选与看板数据
const filters = ref<{ instanceId: number | null; keyword: string; status: string | null; onlyAbnormal: boolean }>({
  instanceId: null,
  keyword: '',
  status: null,
  onlyAbnormal: false,
})

const boards = computed(() => {
  const equipment = weeklyEquipments.value || []
  const scoped = filters.value.instanceId
    ? equipment.filter((item: any) => Number(item.id ?? item.instance_id) === Number(filters.value.instanceId))
    : equipment
  return buildEquipmentBoard(scoped, filters.value)
})

const instanceOptions = computed(() => {
  const seen = new Set<number>()
  const list: any[] = []
  for (const equipment of weeklyEquipments.value || []) {
    const id = Number(equipment.id ?? equipment.instance_id)
    if (!id || seen.has(id)) continue
    seen.add(id)
    list.push({ id, instance_code: equipment.instance_code, instance_name: equipment.instance_name })
  }
  return list
})

const boardSummary = computed(() => {
  const all = (weeklyEquipments.value || []).flatMap((item: any) => item.nodes || item.process_nodes || [])
  const scoped = filters.value.instanceId
    ? (weeklyEquipments.value || [])
      .filter((item: any) => Number(item.id ?? item.instance_id) === Number(filters.value.instanceId))
      .flatMap((item: any) => item.nodes || item.process_nodes || [])
    : all
  return summarizeNodes(scoped)
})

const abnormalCount = computed(() => boardSummary.value.overdue + boardSummary.value.blocked + boardSummary.value.unscheduled)

// 「本周计划」= 计划时间与当前周重叠的节点数（接口会把所有未完成节点都返回，不能直接当本周任务）
const weekPlannedCount = computed(() => {
  const weekStart = weeklyData.value?.week_start
  const weekEnd = weeklyData.value?.week_end
  if (!weekStart) return 0
  const scoped = filters.value.instanceId
    ? (weeklyEquipments.value || [])
      .filter((item: any) => Number(item.id ?? item.instance_id) === Number(filters.value.instanceId))
      .flatMap((item: any) => item.nodes || item.process_nodes || [])
    : (weeklyEquipments.value || []).flatMap((item: any) => item.nodes || item.process_nodes || [])
  return scoped.filter((node: any) => overlapsWeek(node, weekStart, weekEnd)).length
})
const filteredCount = computed(() => boards.value.reduce((sum, board) => sum + board.nodes.length, 0))
const hasFilter = computed(() => Boolean(filters.value.keyword || filters.value.status || filters.value.onlyAbnormal || filters.value.instanceId))

const emptyText = computed(() => {
  if (hasFilter.value) return '没有符合筛选条件的工序，试试清除筛选'
  return '本周没有排程任务：可以在工艺树里排程，或用「批量重排程」把过期计划顺延'
})

const weekLabel = computed(() => formatWeekLabel(weeklyData.value?.week_start, weeklyData.value?.week_end))
const refreshAtText = computed(() => {
  const value = refreshAt.value
  if (!value) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
})

const milestoneDoneCount = computed(() => milestones.value.filter((item: any) => item.status === 'completed').length)

// 只对"有异常"的行做提示色：超期/受阻/未排程
const rowClassName = ({ row }: { row: any }) => {
  if (isAbnormal(row)) return 'row-abnormal'
  if (isOverdue(row)) return 'row-overdue'
  return ''
}

const nodePhaseTag = (row: any) => {
  const phase = nodePhase(row)
  if (phase === 'done' || phase === 'running' || phase === 'upcoming') return null
  return NODE_PHASE_META[phase] || null
}

const toggleAbnormal = () => {
  filters.value.onlyAbnormal = !filters.value.onlyAbnormal
}

const resetFilters = () => {
  filters.value = { instanceId: null, keyword: '', status: null, onlyAbnormal: false }
}

const shiftWeek = (days: number) => {
  const current = weeklyWeek.value instanceof Date ? weeklyWeek.value : new Date(String(weeklyWeek.value || new Date()))
  const next = new Date(current.getTime() + days * 86400000)
  weeklyWeek.value = next
  loadWeekly()
}

const refreshAll = async () => {
  await load()
}

const onRowCommand = async (row: any, command: string) => {
  if (command === 'dates') { openPlanDialog(row); return }
  if (command === 'assign') {
    await openAssign(row)
    return
  }
  await nodeAction(row, command)
}

// ------------------------------------------------------------ 甘特图（2026-11-04）
const ganttLoading = ref(false)
const ganttGroups = ref<any[]>([])
const ganttUnscheduled = ref<any[]>([])
const ganttAnchor = ref(toDayString(new Date(new Date().getFullYear(), new Date().getMonth(), 1)))
const ganttZoom = ref<'day' | 'week' | 'month'>('day')
const ganttInstance = ref<number | null>(null)
const ganttDependencies = ref<any[]>([])
const showGanttDeps = ref(true)
// 2026-11-05：依赖维护抽屉
const dependencyDrawerVisible = ref(false)

const openDependencyAdmin = () => {
  dependencyDrawerVisible.value = true
}

const onDependenciesChanged = async () => {
  await loadGantt()
}

const ganttFrom = computed(() => monthRange(parseDay(ganttAnchor.value) || new Date()).from)
const ganttTo = computed(() => monthRange(parseDay(ganttAnchor.value) || new Date()).to)
const ganttRangeLabel = computed(() => `${ganttFrom.value} ~ ${ganttTo.value}`)
const ganttSummaryText = computed(() => {
  const scheduled = ganttGroups.value.reduce((sum, group) => sum + (group.nodes?.length || 0), 0)
  return `已排程 ${scheduled} 条 · 依赖 ${ganttDependencies.value.length} 条 · 未排程 ${ganttUnscheduled.value.length} 条`
})

const loadGantt = async () => {
  ganttLoading.value = true
  try {
    const data: any = await Api.get('/schedule/gantt', {
      params: {
        from: ganttFrom.value,
        to: ganttTo.value,
        instance_id: ganttInstance.value || undefined,
      },
    })
    ganttGroups.value = data.groups || []
    ganttDependencies.value = data.dependencies || []
    ganttUnscheduled.value = data.unscheduled || []
  } catch (error: any) {
    ElMessage.error('加载甘特图失败: ' + (error?.response?.data?.message || error?.message || error))
  } finally {
    ganttLoading.value = false
  }
}

const shiftGanttMonth = (delta: number) => {
  const base = parseDay(ganttAnchor.value) || new Date()
  ganttAnchor.value = toDayString(new Date(base.getFullYear(), base.getMonth() + delta, 1))
  loadGantt()
}

const goGanttToday = () => {
  ganttAnchor.value = toDayString(new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  loadGantt()
}

const onGanttMove = async (payload: { node: any; planned_start: string | null; planned_end: string | null; delta_days: number }) => {
  try {
    const result: any = await Api.put(`/schedule/process-nodes/${payload.node.id}/dates`, {
      planned_start: payload.planned_start,
      planned_end: payload.planned_end,
    })
    // 2026-11-05（审计 F-03）：后端已记录 DT- 批次（可在「批次记录」撤销），并返回依赖破环告警
    const base = `已改期：${payload.node.operation_name || '工序'} ${payload.delta_days > 0 ? '+' : ''}${payload.delta_days} 天`
    if (result?.warnings?.length) {
      ElMessage.warning(`${base}；注意：${result.warnings.slice(0, 2).join('；')}${result.warnings.length > 2 ? ' 等' : ''}`)
    } else {
      ElMessage.success(result?.batch_no ? `${base}（批次 ${result.batch_no}，可在批次记录撤销）` : base)
    }
    await Promise.all([loadGantt(), loadWeekly(), loadBatches()])
  } catch (error: any) {
    ElMessage.error('改期失败: ' + (error?.response?.data?.message || error?.message || error))
    await loadGantt()
  }
}

const onGanttSelect = async (node: any) => {
  await openAssign(node)
}

// ------------------------------------------------------------ 里程碑计划：补齐 / 编辑（F-09）
const milestoneBackfilling = ref(false)
const milestonePlanVisible = ref(false)
const milestonePlanSaving = ref(false)
const milestonePlanRow = ref<any>(null)
const milestonePlanForm = ref<{ planned_start: string; planned_end: string }>({ planned_start: '', planned_end: '' })
const milestonesMissingPlan = computed(() => milestones.value.filter((item: any) => !item.planned_start || !item.planned_end).length)

const backfillMilestones = async () => {
  if (!selectedInstance.value) return
  try {
    await ElMessageBox.confirm(
      `将为该项目 ${milestonesMissingPlan.value} 个缺少计划日期的里程碑按阶段权重补齐（已完成的里程碑保留原计划）。`,
      '补齐里程碑计划',
      { type: 'warning' },
    )
  } catch {
    return
  }
  milestoneBackfilling.value = true
  try {
    const result: any = await Api.post(`/equipment_instances/${selectedInstance.value}/milestones/backfill`)
    ElMessage.success(`已补齐 ${result.updated || 0} 个里程碑的计划日期`)
    await loadSchedule()
  } catch (error: any) {
    ElMessage.error('补齐失败: ' + (error?.response?.data?.message || error?.message || error))
  } finally {
    milestoneBackfilling.value = false
  }
}

const openMilestonePlan = (row: any) => {
  milestonePlanRow.value = row
  milestonePlanForm.value = {
    planned_start: String(row.planned_start || '').slice(0, 10),
    planned_end: String(row.planned_end || '').slice(0, 10),
  }
  milestonePlanVisible.value = true
}

const saveMilestonePlan = async () => {
  if (!milestonePlanRow.value) return
  const form = milestonePlanForm.value
  if (form.planned_start && form.planned_end && form.planned_end < form.planned_start) {
    ElMessage.warning('计划结束不能早于计划开始')
    return
  }
  milestonePlanSaving.value = true
  try {
    await Api.put(`/milestones/${milestonePlanRow.value.id}`, {
      planned_start: form.planned_start || null,
      planned_end: form.planned_end || null,
    })
    ElMessage.success('里程碑计划已更新')
    milestonePlanVisible.value = false
    await loadSchedule()
  } catch (error: any) {
    ElMessage.error('保存失败: ' + (error?.response?.data?.message || error?.message || error))
  } finally {
    milestonePlanSaving.value = false
  }
}

// ------------------------------------------------------------ 周看板行内改期（F-10）
const planDialogVisible = ref(false)
const planSaving = ref(false)
const planRow = ref<any>(null)
const planForm = ref<{ planned_start: string; planned_end: string }>({ planned_start: '', planned_end: '' })

const openPlanDialog = (row: any) => {
  planRow.value = row
  planForm.value = {
    planned_start: String(row.planned_start || '').slice(0, 19),
    planned_end: String(row.planned_end || '').slice(0, 19),
  }
  planDialogVisible.value = true
}

const savePlanDates = async () => {
  if (!planRow.value) return
  planSaving.value = true
  try {
    const result: any = await Api.put(`/schedule/process-nodes/${planRow.value.id}/dates`, {
      planned_start: planForm.value.planned_start || null,
      planned_end: planForm.value.planned_end || null,
    })
    if (result?.warnings?.length) {
      ElMessage.warning('已改期，但注意：' + result.warnings.slice(0, 2).join('；'))
    } else {
      ElMessage.success(`已改期${result?.batch_no ? `（批次 ${result.batch_no}，可撤销）` : ''}`)
    }
    planDialogVisible.value = false
    await Promise.all([loadWeekly(), loadBatches()])
  } catch (error: any) {
    ElMessage.error('改期失败: ' + (error?.response?.data?.message || error?.message || error))
  } finally {
    planSaving.value = false
  }
}

// 入口引导：本周没有计划任务但存在未排程/超期
const weekGuidance = computed(() => {
  const unscheduled = Number(boardSummary.value.unscheduled || 0)
  const overdue = Number(boardSummary.value.overdue || 0)
  if (weekPlannedCount.value > 0) return null
  if (unscheduled > 0) {
    return {
      type: 'info',
      text: `本周没有计划任务，但有 ${unscheduled} 条工序未排程：可以到单项目甘特按依赖重算，或用批量平移把过期计划顺延。`,
    }
  }
  if (overdue > 0) {
    return {
      type: 'warning',
      text: `本周没有计划任务，但有 ${overdue} 条超期工序：建议批量平移或到单项目甘特重算。`,
    }
  }
  return null
})

const handleTabChange = (tab: string) => {
  onTabChange(tab)
  if (tab === 'gantt' && !ganttGroups.value.length) loadGantt()
}

// ------------------------------------------------------------ 批次记录
const batchDrawerVisible = ref(false)
const openBatches = async () => {
  batchDrawerVisible.value = true
  await loadBatches()
}
const confirmUndo = async (batch: any) => {
  try {
    await ElMessageBox.confirm(`撤销批次 ${batch.batch_no}（${batch.node_count} 个节点）的计划时间调整？`, '撤销确认', { type: 'warning' })
  } catch {
    return
  }
  await undoBatch(batch)
}

// ------------------------------------------------------------ 批量重排程（保留原有能力）
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
    if (!data.stats?.total) ElMessage.warning('没有符合条件的工序节点（检查范围与「只处理未开工且过期」选项）')
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
  } catch {
    return
  }
  applyingReschedule.value = true
  try {
    const result: any = await Api.post('/schedule/reschedule/apply', reschedulePayload())
    ElMessage.success(`已应用：${result.node_count} 个节点，批次号 ${result.batch_no}`)
    rescheduleVisible.value = false
    previewStats.value = null
    previewItems.value = []
    await Promise.all([loadWeekly(), loadBatches()])
  } catch (error: any) {
    ElMessage.error('应用失败: ' + (error?.response?.data?.message || error?.message || error))
  } finally {
    applyingReschedule.value = false
  }
}
</script>

<style scoped>
.schedule-page {
  --schedule-card-radius: 14px;
}

.guidance-alert {
  margin-bottom: 12px;
}

.force-checkbox {
  margin-top: 6px;
}

.page-subtitle {
  color: var(--el-color-info);
  font-size: 12px;
  margin-top: 4px;
}

.refresh-hint {
  color: var(--el-color-info);
  font-size: 12px;
  margin-right: 4px;
}

/* KPI */
.board-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 14px;
}

.summary-tile {
  padding: 14px 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--schedule-card-radius);
  background: linear-gradient(180deg, var(--color-surface-raised, #fff), var(--el-bg-color-overlay, #fff));
  min-height: 96px;
}

.summary-tile.tile-abnormal {
  cursor: pointer;
  transition: border-color 160ms ease, box-shadow 160ms ease;
}

.summary-tile.tile-abnormal:hover {
  border-color: var(--el-color-danger-light-5);
  box-shadow: var(--shadow-sm, 0 2px 10px rgba(0, 0, 0, 0.06));
}

.summary-tile.tile-active {
  border-color: var(--el-color-danger);
  box-shadow: 0 0 0 2px var(--el-color-danger-light-7);
}

.tile-label {
  font-size: 12px;
  color: var(--el-color-info);
  display: flex;
  align-items: center;
  gap: 6px;
}

.tile-value {
  font-size: 26px;
  font-weight: 600;
  line-height: 1.25;
  margin-top: 4px;
}

.tile-value small {
  font-size: 12px;
  font-weight: 400;
  color: var(--el-color-info);
  margin-left: 4px;
}

.tile-hint {
  font-size: 12px;
  color: var(--el-color-info);
}

.tile-progress {
  margin: 8px 0 2px;
}

.tile-done .tile-value {
  color: var(--el-color-success);
}

.tile-running .tile-value {
  color: var(--el-color-warning);
}

.tile-abnormal .tile-value {
  color: var(--el-color-danger);
}

/* 筛选栏 */
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 16px;
}

.filter-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.filter-label {
  font-size: 12px;
  color: var(--el-color-info);
}

.week-buttons {
  margin-left: 4px;
}

.result-hint {
  margin-left: auto;
  font-size: 12px;
  color: var(--el-color-info);
}

/* 项目分组 */
.equipment-card {
  margin-bottom: 14px;
  border-radius: var(--schedule-card-radius);
}

.equipment-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.equipment-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.eq-code {
  font-family: Consolas, monospace;
  font-weight: 600;
}

.eq-name {
  color: var(--color-text-secondary, #606266);
  font-size: 13px;
}

.equipment-stats {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--el-color-info);
}

.stats-progress {
  width: 150px;
}

.node-name {
  display: flex;
  align-items: center;
  gap: 6px;
}

.node-sub {
  font-size: 12px;
  color: var(--el-color-info);
  margin-top: 2px;
}

.phase-code {
  font-size: 12px;
  color: var(--el-color-info);
}

.plan-overdue {
  color: var(--el-color-danger);
  font-weight: 500;
}

.overdue-tag {
  margin-left: 6px;
}

:deep(.row-abnormal) {
  background: var(--el-color-danger-light-9);
}

:deep(.row-abnormal:hover > td),
:deep(.row-overdue:hover > td) {
  background: var(--el-color-danger-light-8) !important;
}

.node-table :deep(.el-table__row) {
  cursor: pointer;
}

.assign-node-name {
  font-weight: 600;
}

/* 批次抽屉 */
.batch-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
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

@media (max-width: 1200px) {
  .board-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .board-summary {
    grid-template-columns: 1fr;
  }

  .result-hint {
    margin-left: 0;
  }

  .equipment-head {
    flex-direction: column;
    align-items: flex-start;
  }
}
.gantt-range {
  font-size: 12px;
  color: var(--el-color-info);
  margin-left: 6px;
}

.gantt-alert {
  margin-bottom: 12px;
}
</style>
