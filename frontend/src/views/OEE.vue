<template>
  <div class="page">
    <PageToolbar
      title="设备综合效率 (OEE)"
      subtitle="统一查看工位利用率、六大损失、班次对比与趋势分析。"
      aria-label="OEE 工具栏"
    >
      <template #icon>
        <el-icon><Setting /></el-icon>
      </template>
      <template v-if="activeTab === 'overview'" #filters>
        <div class="toolbar-form">
          <span class="toolbar-label">统计周期</span>
          <el-select v-model="days" class="days-select" @change="load">
            <el-option v-for="d in [7,14,30,60,90]" :key="d" :label="d+' 天'" :value="d" />
          </el-select>
          <el-button :icon="Refresh" type="primary" :loading="loading" @click="load">刷新</el-button>
        </div>
      </template>
    </PageToolbar>

    <el-tabs v-model="activeTab" @tab-change="onTabChange">
      <el-tab-pane label="工位概览" name="overview">
        <PageState
          v-if="loadError"
          state="error"
          title="OEE 数据加载失败"
          :description="loadError"
          action-text="重新加载"
          @retry="load"
        />
        <PageState
          v-else-if="loading && !workstations.length"
          state="loading"
          title="正在加载 OEE 数据"
          description="正在汇总工位利用率、瓶颈与负荷数据。"
        />
        <PageState
          v-else-if="!loading && !workstations.length && !summary.workstation_count"
          state="empty"
          title="暂无 OEE 工位数据"
          description="当前周期没有可统计的工位负荷数据，可调整天数或先维护工位/工单。"
          action-text="刷新"
          @retry="load"
        />
        <template v-else>
        <el-row :gutter="12" class="metric-row" v-loading="loading">
          <el-col :span="6"><div class="stat-card"><div class="stat-label">车队利用率</div><div class="stat-value" :class="utilToneClass(summary.fleet_utilization_pct)">{{ summary.fleet_utilization_pct || 0 }}%</div><div class="stat-label stat-caption">{{ summary.fleet_busy_hours }}h / {{ summary.fleet_available_hours }}h</div></div></el-col>
          <el-col :span="6"><div class="stat-card"><div class="stat-label">工位</div><div class="stat-value">{{ summary.workstation_count || 0 }}</div><div class="stat-label stat-caption">总工位</div></div></el-col>
          <el-col :span="6"><div class="stat-card"><div class="stat-label">过载</div><div class="stat-value" :class="binaryToneClass((summary.overloaded_count||0)>0)">{{ summary.overloaded_count || 0 }}</div><div class="stat-label stat-caption">&ge;90% 利用率</div></div></el-col>
          <el-col :span="6"><div class="stat-card"><div class="stat-label">闲置</div><div class="stat-value text-info">{{ summary.idle_count || 0 }}</div><div class="stat-label stat-caption">&lt;30% 利用率</div></div></el-col>
        </el-row>

        <el-row :gutter="12" class="metric-row">
          <el-col :span="12">
            <el-card><template #header><span class="card-title text-danger"><el-icon><Sunny /></el-icon> 瓶颈工位</span></template>
              <div v-if="summary.bottleneck">
                <div class="item-title">{{ summary.bottleneck.name }}</div>
                <el-progress :percentage="summary.bottleneck.utilization_pct" :status="summary.bottleneck.utilization_pct>=90?'exception':'warning'" class="mt-xs" />
                <div class="hint-text">利用率最高，建议优先调度</div>
              </div>
              <el-empty v-else description="暂无数据" :image-size="60" />
            </el-card>
          </el-col>
          <el-col :span="12">
            <el-card><template #header><span class="card-title text-success"><el-icon><Moon /></el-icon> 闲置工位</span></template>
              <div v-if="summary.least_busy">
                <div class="item-title">{{ summary.least_busy.name }}</div>
                <el-progress :percentage="summary.least_busy.utilization_pct" :status="summary.least_busy.utilization_pct<30?'success':'warning'" class="mt-xs" />
                <div class="hint-text">利用率最低，可承接更多任务</div>
              </div>
              <el-empty v-else description="暂无数据" :image-size="60" />
            </el-card>
          </el-col>
        </el-row>

        <el-card>
          <template #header><span class="card-title"><el-icon><OfficeBuilding /></el-icon> 各工位利用率（按利用率降序）</span></template>
          <el-table :data="workstations" stripe size="small" empty-text="加载中">
            <el-table-column type="index" width="50" />
            <el-table-column prop="name" label="工位" width="160" />
            <el-table-column prop="workshop" label="车间" width="120" />
            <el-table-column label="利用率" min-width="220">
              <template #default="{row}"><div class="util-bar"><el-progress :percentage="row.utilization_pct" :status="utilStatus(row.level)" class="util-progress" /><span class="util-value">{{ row.utilization_pct }}%</span></div></template>
            </el-table-column>
            <el-table-column prop="busy_hours" label="已用工时" width="100" sortable />
            <el-table-column prop="available_hours" label="可用工时" width="100" />
            <el-table-column prop="idle_hours" label="空闲工时" width="100" />
            <el-table-column prop="item_count" label="任务数" width="80" sortable />
            <el-table-column label="状态" width="100">
              <template #default="{row}"><el-tag :type="levelTag(row.level)" size="small">{{ levelLabel(row.level) }}</el-tag></template>
            </el-table-column>
          </el-table>
        </el-card>

        <el-alert v-if="oeeNote" :title="oeeNote" type="info" :closable="false" class="mt-md" />
        </template>
      </el-tab-pane>

      <el-tab-pane label="损失分析" name="loss">
        <div class="tab-toolbar">
          <el-select v-model="lossFilter.instance_id" placeholder="选择设备实例" filterable class="filter-wide" @change="loadLossAnalysis">
            <el-option v-for="inst in instances" :key="inst.id" :label="inst.instance_code+' '+(inst.instance_name||'')" :value="inst.id" />
          </el-select>
          <el-date-picker v-model="lossFilter.dateRange" type="daterange" range-separator="→" start-placeholder="开始" end-placeholder="结束" value-format="YYYY-MM-DD" @change="loadLossAnalysis" class="filter-wide" />
          <el-button type="primary" @click="showLossDialog=true">+ 记录损失</el-button>
        </div>

        <el-table :data="lossRecords" v-loading="lossLoading" border stripe size="small" empty-text="请选择设备实例" max-height="400">
          <el-table-column label="损失类别" width="130">
            <template #default="{row}"><el-tag :type="lossCategoryTag(row.loss_category)" size="small">{{ lossCategoryLabel(row.loss_category) }}</el-tag></template>
          </el-table-column>
          <el-table-column prop="start_time" label="开始时间" width="160" />
          <el-table-column prop="end_time" label="结束时间" width="160" />
          <el-table-column prop="duration_minutes" label="时长(分)" width="90" align="right" sortable />
          <el-table-column prop="description" label="描述" min-width="160" show-overflow-tooltip />
        </el-table>

        <el-row :gutter="12" class="chart-row" v-if="lossRecords.length">
          <el-col :span="12"><div ref="lossPieRef" class="chart-box-sm"></div></el-col>
          <el-col :span="12"><div ref="lossBarRef" class="chart-box-sm"></div></el-col>
        </el-row>

        <el-dialog v-model="showLossDialog" title="记录损失" width="500px" @close="resetLossForm">
          <el-form :model="lossForm" label-width="90px">
            <el-form-item label="设备实例">
              <el-select v-model="lossForm.instance_id" placeholder="选择设备实例" filterable class="form-full">
                <el-option v-for="inst in instances" :key="inst.id" :label="inst.instance_code+' '+(inst.instance_name||'')" :value="inst.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="损失类别">
              <el-select v-model="lossForm.loss_category" placeholder="选择类别" class="form-full">
                <el-option v-for="c in lossCategories" :key="c.value" :label="c.label" :value="c.value" />
              </el-select>
            </el-form-item>
            <el-form-item label="开始时间">
              <el-date-picker v-model="lossForm.start_time" type="datetime" placeholder="选择开始时间" value-format="YYYY-MM-DD HH:mm:ss" @change="calcLossDuration" class="form-full" />
            </el-form-item>
            <el-form-item label="结束时间">
              <el-date-picker v-model="lossForm.end_time" type="datetime" placeholder="选择结束时间" value-format="YYYY-MM-DD HH:mm:ss" @change="calcLossDuration" class="form-full" />
            </el-form-item>
            <el-form-item label="时长(分钟)">
              <el-input-number v-model="lossForm.duration_minutes" :min="0" :step="1" class="form-full" />
            </el-form-item>
            <el-form-item label="描述">
              <el-input v-model="lossForm.description" type="textarea" :rows="3" placeholder="可选描述" />
            </el-form-item>
          </el-form>
          <template #footer>
            <el-button @click="showLossDialog=false">取消</el-button>
            <el-button type="primary" @click="saveLossRecord" :loading="lossSaving">保存</el-button>
          </template>
        </el-dialog>
      </el-tab-pane>

      <el-tab-pane label="班组对比" name="shift">
        <div class="tab-toolbar">
          <el-select v-model="shiftFilter.instance_id" placeholder="选择设备实例" filterable class="filter-wide" @change="loadShiftComparison">
            <el-option v-for="inst in instances" :key="inst.id" :label="inst.instance_code+' '+(inst.instance_name||'')" :value="inst.id" />
          </el-select>
          <el-date-picker v-model="shiftFilter.dateRange" type="daterange" range-separator="→" start-placeholder="开始" end-placeholder="结束" value-format="YYYY-MM-DD" @change="loadShiftComparison" class="filter-wide" />
        </div>

        <el-table :data="shiftData" v-loading="shiftLoading" border stripe size="small" empty-text="请选择设备实例" max-height="350">
          <el-table-column prop="shift_name" label="班组" width="120" />
          <el-table-column prop="oee" label="OEE" width="80" align="right">
            <template #default="{row}"><span class="score-value" :class="shiftOeeToneClass(row.oee)">{{ row.oee }}%</span></template>
          </el-table-column>
          <el-table-column prop="availability" label="可用性" width="80" align="right" />
          <el-table-column prop="performance" label="性能" width="80" align="right" />
          <el-table-column prop="quality" label="质量" width="80" align="right" />
          <el-table-column prop="total_output" label="总产出" width="90" align="right" />
        </el-table>

        <el-row :gutter="12" class="chart-row" v-if="shiftData.length">
          <el-col :span="12"><div ref="shiftGroupRef" class="chart-box-sm"></div></el-col>
          <el-col :span="12"><div ref="shiftStackRef" class="chart-box-sm"></div></el-col>
        </el-row>
      </el-tab-pane>

      <el-tab-pane label="OEE趋势" name="trend">
        <div class="tab-toolbar">
          <el-select v-model="trendFilter.instance_id" placeholder="选择设备实例" filterable class="filter-wide" @change="loadTrend">
            <el-option v-for="inst in instances" :key="inst.id" :label="inst.instance_code+' '+(inst.instance_name||'')" :value="inst.id" />
          </el-select>
          <el-select v-model="trendFilter.days" class="trend-days-select" @change="loadTrend">
            <el-option v-for="d in [30,60,90,180]" :key="d" :label="d+' 天'" :value="d" />
          </el-select>
        </div>
        <div ref="trendRef" class="chart-box-lg" v-loading="trendLoading"></div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { Refresh, Setting } from '@element-plus/icons-vue'
import PageState from '../components/PageState.vue'
import PageToolbar from '../components/PageToolbar.vue'
import { useOeePage } from '../composables/useOeePage'

const {
  activeTab,
  days,
  loading,
  summary,
  workstations,
  oeeNote,
  loadError,
  utilColor,
  utilToneClass,
  binaryToneClass,
  shiftOeeToneClass,
  utilStatus,
  levelTag,
  levelLabel,
  themeColor,
  chartTones,
  load,
  instances,
  loadInstances,
  lossCategories,
  lossCategoryLabel,
  lossCategoryTag,
  lossFilter,
  lossRecords,
  lossLoading,
  showLossDialog,
  lossSaving,
  lossForm,
  lossPieRef,
  lossBarRef,
  calcLossDuration,
  resetLossForm,
  saveLossRecord,
  loadLossAnalysis,
  renderLossCharts,
  shiftFilter,
  shiftData,
  shiftLoading,
  shiftGroupRef,
  shiftStackRef,
  loadShiftComparison,
  renderShiftCharts,
  trendFilter,
  trendLoading,
  trendRef,
  loadTrend,
  onTabChange,
  handleResize,
} = useOeePage()
</script>

<style scoped>
.stat-card { background:var(--el-bg-color-overlay); padding:16px; border-radius:var(--radius-lg); text-align:center; border:1px solid var(--el-border-color-lighter); box-shadow:var(--shadow-sm); }
.stat-label { font-size:12px; color:var(--el-color-info); margin-bottom:6px; }
.stat-caption { font-size:11px; }
.stat-value { font-size:28px; font-weight:600; color:var(--el-text-color-primary); line-height:1.2; }
.toolbar-form { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.toolbar-label { color:var(--el-text-color-secondary); font-size:13px; }
.days-select { width:120px; }
.metric-row { margin-bottom:12px; }
.card-title { display:inline-flex; align-items:center; gap:6px; font-weight:600; }
.item-title { font-size:18px; font-weight:600; color:var(--el-text-color-primary); }
.hint-text { font-size:12px; color:var(--el-color-info); margin-top:4px; }
.mt-xs { margin-top:8px; }
.mt-md { margin-top:12px; }
.util-bar { display:flex; align-items:center; gap:8px; }
.util-progress { flex:1; }
.util-value { font-weight:600; min-width:40px; text-align:right; }
.filter-wide { width:260px; }
.trend-days-select { width:100px; }
.form-full { width:100%; }
.chart-row { margin-top:16px; }
.chart-box-sm { height:320px; }
.chart-box-lg { height:400px; }
.score-value { font-weight:600; }
.text-success { color:var(--el-color-success); }
.text-warning { color:var(--el-color-warning); }
.text-danger { color:var(--el-color-danger); }
.text-info { color:var(--el-color-info); }
.tab-toolbar { display:flex; gap:12px; align-items:center; margin-bottom:12px; flex-wrap:wrap; }
</style>
