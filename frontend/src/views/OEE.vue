<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title">⚙️ 设备综合效率 (OEE)</div>
    </div>

    <el-tabs v-model="activeTab" @tab-change="onTabChange">
      <el-tab-pane label="工位概览" name="overview">
        <div style="display:flex;gap:8px;margin-bottom:12px;align-items:center">
          <el-select v-model="days" style="width:120px" @change="load">
            <el-option v-for="d in [7,14,30,60,90]" :key="d" :label="d+' 天'" :value="d" />
          </el-select>
          <el-button @click="load" type="primary" :loading="loading">刷新</el-button>
        </div>

        <el-row :gutter="12" style="margin-bottom:12px" v-loading="loading">
          <el-col :span="6"><div class="stat-card"><div class="stat-label">车队利用率</div><div class="stat-value" :style="{color:utilColor(summary.fleet_utilization_pct)}">{{ summary.fleet_utilization_pct || 0 }}%</div><div class="stat-label" style="font-size:11px">{{ summary.fleet_busy_hours }}h / {{ summary.fleet_available_hours }}h</div></div></el-col>
          <el-col :span="6"><div class="stat-card"><div class="stat-label">工位</div><div class="stat-value">{{ summary.workstation_count || 0 }}</div><div class="stat-label" style="font-size:11px">总工位</div></div></el-col>
          <el-col :span="6"><div class="stat-card"><div class="stat-label">过载</div><div class="stat-value" :style="{color:(summary.overloaded_count||0)>0?'#f56c6c':'#67c23a'}">{{ summary.overloaded_count || 0 }}</div><div class="stat-label" style="font-size:11px">&ge;90% 利用率</div></div></el-col>
          <el-col :span="6"><div class="stat-card"><div class="stat-label">闲置</div><div class="stat-value" style="color:#909399">{{ summary.idle_count || 0 }}</div><div class="stat-label" style="font-size:11px">&lt;30% 利用率</div></div></el-col>
        </el-row>

        <el-row :gutter="12" style="margin-bottom:12px">
          <el-col :span="12">
            <el-card><template #header><span style="color:#f56c6c;font-weight:500">🔥 瓶颈工位</span></template>
              <div v-if="summary.bottleneck">
                <div style="font-size:18px;font-weight:600">{{ summary.bottleneck.name }}</div>
                <el-progress :percentage="summary.bottleneck.utilization_pct" :status="summary.bottleneck.utilization_pct>=90?'exception':'warning'" style="margin-top:8px" />
                <div style="font-size:12px;color:#909399;margin-top:4px">利用率最高，建议优先调度</div>
              </div>
              <el-empty v-else description="暂无数据" :image-size="60" />
            </el-card>
          </el-col>
          <el-col :span="12">
            <el-card><template #header><span style="color:#67c23a;font-weight:500">💤 闲置工位</span></template>
              <div v-if="summary.least_busy">
                <div style="font-size:18px;font-weight:600">{{ summary.least_busy.name }}</div>
                <el-progress :percentage="summary.least_busy.utilization_pct" :status="summary.least_busy.utilization_pct<30?'success':'warning'" style="margin-top:8px" />
                <div style="font-size:12px;color:#909399;margin-top:4px">利用率最低，可承接更多任务</div>
              </div>
              <el-empty v-else description="暂无数据" :image-size="60" />
            </el-card>
          </el-col>
        </el-row>

        <el-card>
          <template #header><span style="font-weight:500">🏭 各工位利用率（按利用率降序）</span></template>
          <el-table :data="workstations" stripe size="small" empty-text="加载中">
            <el-table-column type="index" width="50" />
            <el-table-column prop="name" label="工位" width="160" />
            <el-table-column prop="workshop" label="车间" width="120" />
            <el-table-column label="利用率" min-width="220">
              <template #default="{row}"><div style="display:flex;align-items:center;gap:8px"><el-progress :percentage="row.utilization_pct" :status="utilStatus(row.level)" style="flex:1" /><span style="font-weight:600;min-width:40px">{{ row.utilization_pct }}%</span></div></template>
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

        <el-alert v-if="oeeNote" :title="oeeNote" type="info" :closable="false" style="margin-top:12px" />
      </el-tab-pane>

      <el-tab-pane label="损失分析" name="loss">
        <div class="tab-toolbar">
          <el-select v-model="lossFilter.instance_id" placeholder="选择设备实例" filterable style="width:260px" @change="loadLossAnalysis">
            <el-option v-for="inst in instances" :key="inst.id" :label="inst.instance_code+' '+(inst.instance_name||'')" :value="inst.id" />
          </el-select>
          <el-date-picker v-model="lossFilter.dateRange" type="daterange" range-separator="→" start-placeholder="开始" end-placeholder="结束" value-format="YYYY-MM-DD" @change="loadLossAnalysis" style="width:260px" />
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

        <el-row :gutter="12" style="margin-top:16px" v-if="lossRecords.length">
          <el-col :span="12"><div ref="lossPieRef" style="height:320px"></div></el-col>
          <el-col :span="12"><div ref="lossBarRef" style="height:320px"></div></el-col>
        </el-row>

        <el-dialog v-model="showLossDialog" title="记录损失" width="500px" @close="resetLossForm">
          <el-form :model="lossForm" label-width="90px">
            <el-form-item label="设备实例">
              <el-select v-model="lossForm.instance_id" placeholder="选择设备实例" filterable style="width:100%">
                <el-option v-for="inst in instances" :key="inst.id" :label="inst.instance_code+' '+(inst.instance_name||'')" :value="inst.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="损失类别">
              <el-select v-model="lossForm.loss_category" placeholder="选择类别" style="width:100%">
                <el-option v-for="c in lossCategories" :key="c.value" :label="c.label" :value="c.value" />
              </el-select>
            </el-form-item>
            <el-form-item label="开始时间">
              <el-date-picker v-model="lossForm.start_time" type="datetime" placeholder="选择开始时间" value-format="YYYY-MM-DD HH:mm:ss" @change="calcLossDuration" style="width:100%" />
            </el-form-item>
            <el-form-item label="结束时间">
              <el-date-picker v-model="lossForm.end_time" type="datetime" placeholder="选择结束时间" value-format="YYYY-MM-DD HH:mm:ss" @change="calcLossDuration" style="width:100%" />
            </el-form-item>
            <el-form-item label="时长(分钟)">
              <el-input-number v-model="lossForm.duration_minutes" :min="0" :step="1" style="width:100%" />
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
          <el-select v-model="shiftFilter.instance_id" placeholder="选择设备实例" filterable style="width:260px" @change="loadShiftComparison">
            <el-option v-for="inst in instances" :key="inst.id" :label="inst.instance_code+' '+(inst.instance_name||'')" :value="inst.id" />
          </el-select>
          <el-date-picker v-model="shiftFilter.dateRange" type="daterange" range-separator="→" start-placeholder="开始" end-placeholder="结束" value-format="YYYY-MM-DD" @change="loadShiftComparison" style="width:260px" />
        </div>

        <el-table :data="shiftData" v-loading="shiftLoading" border stripe size="small" empty-text="请选择设备实例" max-height="350">
          <el-table-column prop="shift_name" label="班组" width="120" />
          <el-table-column prop="oee" label="OEE" width="80" align="right">
            <template #default="{row}"><span style="font-weight:600" :style="{color:row.oee>=85?'#67c23a':row.oee>=60?'#e6a23c':'#f56c6c'}">{{ row.oee }}%</span></template>
          </el-table-column>
          <el-table-column prop="availability" label="可用性" width="80" align="right" />
          <el-table-column prop="performance" label="性能" width="80" align="right" />
          <el-table-column prop="quality" label="质量" width="80" align="right" />
          <el-table-column prop="total_output" label="总产出" width="90" align="right" />
        </el-table>

        <el-row :gutter="12" style="margin-top:16px" v-if="shiftData.length">
          <el-col :span="12"><div ref="shiftGroupRef" style="height:320px"></div></el-col>
          <el-col :span="12"><div ref="shiftStackRef" style="height:320px"></div></el-col>
        </el-row>
      </el-tab-pane>

      <el-tab-pane label="OEE趋势" name="trend">
        <div class="tab-toolbar">
          <el-select v-model="trendFilter.instance_id" placeholder="选择设备实例" filterable style="width:260px" @change="loadTrend">
            <el-option v-for="inst in instances" :key="inst.id" :label="inst.instance_code+' '+(inst.instance_name||'')" :value="inst.id" />
          </el-select>
          <el-select v-model="trendFilter.days" style="width:100px" @change="loadTrend">
            <el-option v-for="d in [30,60,90,180]" :key="d" :label="d+' 天'" :value="d" />
          </el-select>
        </div>
        <div ref="trendRef" style="height:400px" v-loading="trendLoading"></div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, nextTick } from 'vue'
import * as echarts from 'echarts'
import { Api } from '../api'
import { ElMessage } from 'element-plus'

const activeTab = ref('overview')

const days = ref(30)
const loading = ref(false)
const summary = ref<any>({})
const workstations = ref<any[]>([])
const oeeNote = ref<string>('')

const utilColor = (p: number) => p >= 90 ? '#f56c6c' : p >= 70 ? '#e6a23c' : p >= 30 ? '#67c23a' : '#909399'
const utilStatus = (level: string) => ({ overload: 'exception', busy: 'warning', normal: 'success', idle: '' }[level] || '')
const levelTag = (level: string) => ({ overload: 'danger', busy: 'warning', normal: 'success', idle: 'info' }[level] || 'info')
const levelLabel = (level: string) => ({ overload: '过载', busy: '繁忙', normal: '正常', idle: '闲置' }[level] || level)

const load = async () => {
  loading.value = true
  try {
    const data = await Api.oee({ days: days.value })
    summary.value = data.summary || {}
    workstations.value = data.workstations || []
    oeeNote.value = data.note || ''
  } finally { loading.value = false }
}

const instances = ref<any[]>([])
const loadInstances = async () => {
  try { instances.value = await Api.instances() } catch (_) {}
}

const lossCategories = [
  { value: 'equipment_failure', label: '设备故障' },
  { value: 'setup_adjustment', label: '换型调整' },
  { value: 'idling_minor_stops', label: '空转短暂停机' },
  { value: 'reduced_speed', label: '速度降低' },
  { value: 'startup_defects', label: '启动次品' },
  { value: 'production_defects', label: '运行次品' }
]
const lossCategoryLabel = (v: string) => lossCategories.find(c => c.value === v)?.label || v
const lossCategoryTag = (v: string): any => {
  const m: any = { equipment_failure: 'danger', setup_adjustment: 'warning', idling_minor_stops: 'info', reduced_speed: '', startup_defects: 'danger', production_defects: 'warning' }
  return m[v] || 'info'
}

const lossFilter = reactive({ instance_id: null as number | null, dateRange: null as string[] | null })
const lossRecords = ref<any[]>([])
const lossLoading = ref(false)
const showLossDialog = ref(false)
const lossSaving = ref(false)
const lossForm = reactive({ instance_id: null as number | null, loss_category: 'equipment_failure', start_time: '', end_time: '', duration_minutes: 0, description: '' })

const lossPieRef = ref<HTMLDivElement>()
const lossBarRef = ref<HTMLDivElement>()
let lossPieChart: echarts.ECharts | null = null
let lossBarChart: echarts.ECharts | null = null

const calcLossDuration = () => {
  if (lossForm.start_time && lossForm.end_time) {
    const diff = (new Date(lossForm.end_time).getTime() - new Date(lossForm.start_time).getTime()) / 60000
    lossForm.duration_minutes = Math.max(0, Math.round(diff * 10) / 10)
  }
}

const resetLossForm = () => {
  Object.assign(lossForm, { instance_id: null, loss_category: 'equipment_failure', start_time: '', end_time: '', duration_minutes: 0, description: '' })
}

const saveLossRecord = async () => {
  if (!lossForm.instance_id || !lossForm.loss_category || !lossForm.start_time || !lossForm.end_time) {
    return ElMessage.warning('请完整填写损失记录')
  }
  lossSaving.value = true
  try {
    await Api.post('/oee/loss-events', { ...lossForm })
    ElMessage.success('损失记录已保存')
    showLossDialog.value = false
    loadLossAnalysis()
  } catch (_) { ElMessage.error('保存失败') }
  finally { lossSaving.value = false }
}

const loadLossAnalysis = async () => {
  if (!lossFilter.instance_id) { lossRecords.value = []; return }
  lossLoading.value = true
  try {
    const params: any = { instance_id: lossFilter.instance_id }
    if (lossFilter.dateRange) { params.start_date = lossFilter.dateRange[0]; params.end_date = lossFilter.dateRange[1] }
    lossRecords.value = await Api.get('/oee/loss-events', { params }) || []
    await nextTick()
    renderLossCharts()
  } catch (_) { lossRecords.value = [] }
  finally { lossLoading.value = false }
}

const renderLossCharts = async () => {
  await nextTick()
  if (lossPieRef.value) {
    if (!lossPieChart) lossPieChart = echarts.init(lossPieRef.value)
    const catMap: Record<string, number> = {}
    lossRecords.value.forEach(r => { catMap[r.loss_category] = (catMap[r.loss_category] || 0) + (r.duration_minutes || 0) })
    lossPieChart.setOption({
      title: { text: '损失分类分布', left: 'center', textStyle: { fontSize: 14 } },
      tooltip: { trigger: 'item', formatter: '{b}: {c} 分钟 ({d}%)' },
      series: [{
        type: 'pie', radius: ['40%', '70%'],
        data: Object.entries(catMap).map(([k, v]) => ({ name: lossCategoryLabel(k), value: v })),
        label: { formatter: '{b}\n{d}%' }
      }]
    }, true)
  }

  if (lossBarRef.value) {
    if (!lossBarChart) lossBarChart = echarts.init(lossBarRef.value)
    try {
      const pareto = await Api.get('/oee/loss-pareto', { params: { instance_id: lossFilter.instance_id, days: 30 } })
      const cats = (pareto?.categories || []).map((c: any) => lossCategoryLabel(c.name || c.category || c))
      const vals = (pareto?.categories || []).map((c: any) => c.total_minutes || c.value || 0)
      lossBarChart.setOption({
        title: { text: '损失柏拉图 (30天)', left: 'center', textStyle: { fontSize: 14 } },
        tooltip: { trigger: 'axis' },
        xAxis: { type: 'category', data: cats, axisLabel: { rotate: 20, fontSize: 10 } },
        yAxis: { type: 'value', name: '分钟' },
        series: [{ type: 'bar', data: vals, itemStyle: { color: '#f56c6c' } }]
      }, true)
    } catch (_) {}
  }
}

const shiftFilter = reactive({ instance_id: null as number | null, dateRange: null as string[] | null })
const shiftData = ref<any[]>([])
const shiftLoading = ref(false)
const shiftGroupRef = ref<HTMLDivElement>()
const shiftStackRef = ref<HTMLDivElement>()
let shiftGroupChart: echarts.ECharts | null = null
let shiftStackChart: echarts.ECharts | null = null

const loadShiftComparison = async () => {
  if (!shiftFilter.instance_id) { shiftData.value = []; return }
  shiftLoading.value = true
  try {
    const params: any = { instance_id: shiftFilter.instance_id }
    if (shiftFilter.dateRange) { params.start_date = shiftFilter.dateRange[0]; params.end_date = shiftFilter.dateRange[1] }
    shiftData.value = await Api.get('/oee/shift-comparison', { params }) || []
    await nextTick()
    renderShiftCharts()
  } catch (_) { shiftData.value = [] }
  finally { shiftLoading.value = false }
}

const renderShiftCharts = async () => {
  await nextTick()
  if (shiftGroupRef.value && shiftData.value.length) {
    if (!shiftGroupChart) shiftGroupChart = echarts.init(shiftGroupRef.value)
    const names = shiftData.value.map((s: any) => s.shift_name)
    shiftGroupChart.setOption({
      title: { text: '班组 OEE 对比', left: 'center', textStyle: { fontSize: 14 } },
      tooltip: { trigger: 'axis' },
      legend: { data: ['可用性', '性能', '质量'], bottom: 0 },
      xAxis: { type: 'category', data: names },
      yAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%' } },
      series: [
        { name: '可用性', type: 'bar', data: shiftData.value.map((s: any) => s.availability), itemStyle: { color: '#5470c6' } },
        { name: '性能', type: 'bar', data: shiftData.value.map((s: any) => s.performance), itemStyle: { color: '#91cc75' } },
        { name: '质量', type: 'bar', data: shiftData.value.map((s: any) => s.quality), itemStyle: { color: '#fac858' } }
      ]
    }, true)
  }
  if (shiftStackRef.value && shiftData.value.length) {
    if (!shiftStackChart) shiftStackChart = echarts.init(shiftStackRef.value)
    const names = shiftData.value.map((s: any) => s.shift_name)
    const breakdownKeys = shiftData.value[0]?.losses_breakdown ? Object.keys(shiftData.value[0].losses_breakdown) : []
    const series = breakdownKeys.map((k: string) => ({
      name: lossCategoryLabel(k), type: 'bar', stack: 'total',
      data: shiftData.value.map((s: any) => (s.losses_breakdown || {})[k] || 0)
    }))
    shiftStackChart.setOption({
      title: { text: '损失分解 (堆叠)', left: 'center', textStyle: { fontSize: 14 } },
      tooltip: { trigger: 'axis' },
      legend: { data: breakdownKeys.map((k: string) => lossCategoryLabel(k)), bottom: 0, type: 'scroll' },
      xAxis: { type: 'category', data: names },
      yAxis: { type: 'value', name: '分钟' },
      series
    }, true)
  }
}

const trendFilter = reactive({ instance_id: null as number | null, days: 90 })
const trendLoading = ref(false)
const trendRef = ref<HTMLDivElement>()
let trendChart: echarts.ECharts | null = null

const loadTrend = async () => {
  if (!trendFilter.instance_id) return
  trendLoading.value = true
  try {
    const data = await Api.get('/oee/trend', { params: { instance_id: trendFilter.instance_id, days: trendFilter.days } })
    await nextTick()
    if (trendRef.value) {
      if (!trendChart) trendChart = echarts.init(trendRef.value)
      const rows = data?.dates || data?.rows || []
      const dates = rows.map((r: any) => r.date || r.day || r)
      const aData = rows.map((r: any) => r.availability || 0)
      const pData = rows.map((r: any) => r.performance || 0)
      const qData = rows.map((r: any) => r.quality || 0)
      const oeeData = rows.map((r: any) => r.oee || 0)
      trendChart.setOption({
        title: { text: 'OEE 趋势 (' + trendFilter.days + '天)', left: 'center', textStyle: { fontSize: 14 } },
        tooltip: { trigger: 'axis' },
        legend: { data: ['可用性', '性能', '质量', 'OEE'], bottom: 0 },
        xAxis: { type: 'category', data: dates, axisLabel: { rotate: 30, fontSize: 10 } },
        yAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%' } },
        series: [
          { name: '可用性', type: 'line', data: aData, smooth: true, lineStyle: { color: '#5470c6' } },
          { name: '性能', type: 'line', data: pData, smooth: true, lineStyle: { color: '#91cc75' } },
          { name: '质量', type: 'line', data: qData, smooth: true, lineStyle: { color: '#fac858' } },
          { name: 'OEE', type: 'line', data: oeeData, smooth: true, lineStyle: { color: '#ee6666', width: 3 }, symbol: 'circle', symbolSize: 6 }
        ]
      }, true)
    }
  } catch (_) {}
  finally { trendLoading.value = false }
}

const onTabChange = (tab: string) => {
  if ((tab === 'loss' || tab === 'shift' || tab === 'trend') && instances.value.length === 0) loadInstances()
  if (tab === 'loss') { nextTick(() => { if (lossRecords.value.length) renderLossCharts() }) }
  if (tab === 'shift') { nextTick(() => { if (shiftData.value.length) renderShiftCharts() }) }
}

const handleResize = () => {
  lossPieChart?.resize()
  lossBarChart?.resize()
  shiftGroupChart?.resize()
  shiftStackChart?.resize()
  trendChart?.resize()
}

onMounted(() => {
  load()
  loadInstances()
  window.addEventListener('resize', handleResize)
})
</script>

<style scoped>
.stat-card { background:#fff; padding:16px; border-radius:6px; text-align:center; border:1px solid #ebeef5; }
.stat-label { font-size:12px; color:#909399; margin-bottom:6px; }
.stat-value { font-size:28px; font-weight:600; color:#303133; line-height:1.2; }
.tab-toolbar { display:flex; gap:12px; align-items:center; margin-bottom:12px; flex-wrap:wrap; }
</style>