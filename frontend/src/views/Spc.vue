<template>
  <div class="page">
    <div class="page-header"><div class="page-title">📊 SPC 统计过程控制</div></div>

    <el-tabs v-model="activeTab" type="border-card">
      <!-- Tab 1: SPC 分析 (existing) -->
      <el-tab-pane label="SPC 分析" name="analyze">
        <div class="toolbar">
          <el-select v-model="sel.node" placeholder="选择工序" filterable @change="onNodeChange" style="width:240px">
            <el-option v-for="n in nodes" :key="n.id" :label="'#'+n.id+' '+ (n.operation_name||'')" :value="n.id" />
          </el-select>
          <el-select v-model="sel.param" placeholder="选择参数" @change="analyze" style="width:160px">
            <el-option v-for="p in params" :key="p.code" :label="p.label" :value="p.code" />
          </el-select>
          <el-input-number v-model="sel.ss" :min="2" :max="20" style="width:100px" placeholder="子组大小" />
          <el-button type="primary" @click="analyze" :loading="loading">分析</el-button>
        </div>

        <div v-if="data" class="result-area">
          <el-row :gutter="16" style="margin-bottom:16px">
            <el-col :span="4"><el-card shadow="hover"><el-statistic title="数据量" :value="data.data_count"/></el-card></el-col>
            <el-col :span="4"><el-card shadow="hover"><el-statistic title="子组数" :value="data.subgroup_count"/></el-card></el-col>
            <el-col :span="4"><el-card shadow="hover"><el-statistic title="Cp" :value="data.capability?.cp" :precision="3"/></el-card></el-col>
            <el-col :span="4"><el-card shadow="hover"><el-statistic title="Cpk" :value="data.capability?.cpk" :precision="3"/></el-card></el-col>
            <el-col :span="4"><el-card shadow="hover"><el-statistic title="Pp" :value="data.capability?.pp" :precision="3"/></el-card></el-col>
            <el-col :span="4"><el-card shadow="hover"><el-statistic title="Ppk" :value="data.capability?.ppk" :precision="3"/></el-card></el-col>
          </el-row>
          <el-alert v-if="data.weco_alert_count" :title="data.weco_alert_count+' 条 WECO 规则违规'" type="warning" show-icon style="margin-bottom:12px" closable />
          <div ref="chartRef" style="width:100%;height:350px"></div>
          <el-table :data="data.subgroups||[]" size="small" border style="margin-top:16px" max-height="350">
            <el-table-column prop="index" label="子组" width="70" align="center" />
            <el-table-column label="值" min-width="200"><template #default="{row}"><span v-for="(v,i) in row.values" :key="i" style="margin-right:6px">{{ v }}</span></template></el-table-column>
            <el-table-column prop="mean" label="X̄" width="80" align="right"><template #default="{row}">{{ row.mean?.toFixed(3) }}</template></el-table-column>
            <el-table-column prop="range" label="R" width="80" align="right"><template #default="{row}">{{ row.range?.toFixed(3) }}</template></el-table-column>
            <el-table-column label="失控" width="70" align="center"><template #default="{row}"><el-tag v-if="row.outOfControl" type="danger" size="small">●</el-tag></template></el-table-column>
          </el-table>
        </div>
        <el-empty v-else description="选择工序和参数开始 SPC 分析" />
      </el-tab-pane>

      <!-- Tab 2: Xbar-R 控制图 -->
      <el-tab-pane label="Xbar-R 控制图" name="xbar">
        <el-card>
          <el-form label-width="120px">
            <el-form-item label="子组数据">
              <el-input v-model="xbarInput" type="textarea" :rows="6" placeholder="每行一个子组，用 | 分隔各值&#10;例: 1.2 1.3 1.1 | 1.4 1.2 1.3" />
            </el-form-item>
            <el-form-item><el-button type="primary" @click="calcXbarR" :loading="xbarLoading">计算</el-button></el-form-item>
          </el-form>
          <div v-if="xbarResult" ref="xbarChartRef" style="width:100%;height:400px;margin-top:12px"></div>
        </el-card>
      </el-tab-pane>

      <!-- Tab 3: 过程能力 Cpk -->
      <el-tab-pane label="过程能力 Cpk" name="cpk">
        <el-card>
          <el-form :inline="true" label-width="80px">
            <el-form-item label="测量值"><el-input v-model="cpkInput" type="textarea" :rows="4" placeholder="每行一个测量值" style="width: 300px" /></el-form-item>
            <div>
              <el-form-item label="USL"><el-input-number v-model="cpkUsl" :precision="3" style="width: 140px" /></el-form-item>
              <el-form-item label="LSL"><el-input-number v-model="cpkLsl" :precision="3" style="width: 140px" /></el-form-item>
              <el-form-item><el-button type="primary" @click="calcCpk" :loading="cpkLoading">计算</el-button></el-form-item>
            </div>
          </el-form>
          <div v-if="cpkResult">
            <el-row :gutter="16" style="margin: 16px 0">
              <el-col :span="6"><el-card shadow="hover"><el-statistic title="Cp" :value="cpkResult.cp" :precision="4" /></el-card></el-col>
              <el-col :span="6"><el-card shadow="hover"><el-statistic title="Cpk" :value="cpkResult.cpk" :precision="4" /></el-card></el-col>
              <el-col :span="6"><el-card shadow="hover"><el-statistic title="Ppk" :value="cpkResult.ppk" :precision="4" /></el-card></el-col>
              <el-col :span="6"><el-card shadow="hover"><el-statistic title="合格率" :value="cpkResult.within_spec_pct" :precision="2"><template #suffix>%</template></el-statistic></el-card></el-col>
            </el-row>
            <div ref="cpkChartRef" style="width:100%;height:350px"></div>
          </div>
        </el-card>
      </el-tab-pane>

      <!-- Tab 4: Pareto 图 -->
      <el-tab-pane label="Pareto 图" name="pareto">
        <el-card>
          <el-form :inline="true">
            <el-form-item label="设备实例"><el-select v-model="paretoInstance" placeholder="选设备实例" style="width: 220px"><el-option v-for="i in instances" :key="i.id" :label="i.instance_code" :value="i.id" /></el-select></el-form-item>
            <el-form-item label="天数"><el-input-number v-model="paretoDays" :min="1" :max="365" style="width: 120px" /></el-form-item>
            <el-form-item><el-button type="primary" @click="loadPareto" :loading="paretoLoading">查询</el-button></el-form-item>
          </el-form>
          <div v-if="paretoData" ref="paretoChartRef" style="width:100%;height:400px"></div>
        </el-card>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>
<script setup lang="ts">
import { ref, reactive, onMounted, nextTick, watch } from 'vue'
import { Api } from '../api'
import * as echarts from 'echarts'
import { ElMessage } from 'element-plus'

const activeTab = ref('analyze')

// ========== Tab 1: SPC Analysis (existing) ==========
const nodes = ref([])
const params = [{code:'temperature_c',label:'温度 (°C)'},{code:'current_amp',label:'电流 (A)'},{code:'voltage_v',label:'电压 (V)'},{code:'speed_mm_min',label:'速度 (mm/min)'},{code:'pressure_mpa',label:'压力 (MPa)'},{code:'feed_rate',label:'进给率'}]
const sel = reactive({ node: null, param: 'temperature_c', ss: 5 })
const loading = ref(false)
const data = ref(null)
const chartRef = ref(null)
let chartInst = null

onMounted(async () => {
  try { nodes.value = await Api.get('/spc/nodes-with-params') } catch (_) { nodes.value = [] }
})

const onNodeChange = () => {}

const analyze = async () => {
  if (!sel.node || !sel.param) return
  loading.value = true
  try {
    data.value = await Api.get('/spc/analyze', { params: { process_node_id: sel.node, param: sel.param, subgroup_size: sel.ss } })
    await nextTick(); renderChart()
  } catch (_) { data.value = null } finally { loading.value = false }
}

const renderChart = () => {
  if (!data.value?.subgroups?.length) return
  const subs = data.value.subgroups
  const xr = data.value
  const xdata = subs.map(s => s.index)
  const means = subs.map(s => s.mean)

  if (!chartRef.value) return
  if (!chartInst) chartInst = echarts.init(chartRef.value)
  else chartInst.resize()

  chartInst.setOption({
    title: { text: xr.parameter?.label + ' Xbar-R 控制图', left: 'center', textStyle: { fontSize: 14 } },
    tooltip: { trigger: 'axis' },
    grid: { left: 60, right: 30, top: 50, height: '40%' },
    xAxis: { data: xdata, name: '子组序号' },
    yAxis: { name: 'X̄' },
    series: [{
      name: 'X̄', type: 'line', data: means, markLine: {
        silent: true, data: [
          { yAxis: xr.xbar?.x_double_bar, name: 'CL', label: { formatter: 'CL={c}' } },
          { yAxis: xr.xbar?.ucl, name: 'UCL', lineStyle: { color: 'red', type: 'dashed' } },
          { yAxis: xr.xbar?.lcl, name: 'LCL', lineStyle: { color: 'red', type: 'dashed' } },
        ].filter(m => m.yAxis != null)
      }
    }]
  })
}

// ========== Tab 2: Xbar-R ==========
const xbarInput = ref('')
const xbarResult = ref(null)
const xbarLoading = ref(false)
const xbarChartRef = ref(null)
let xbarChartInst = null

const calcXbarR = async () => {
  if (!xbarInput.value.trim()) { ElMessage.warning('请输入子组数据'); return }
  xbarLoading.value = true
  try {
    const subgroups = xbarInput.value.trim().split('\n').filter(l => l.trim()).map(line => {
      const parts = line.split('|')
      return parts.length > 1 ? parts.map(p => p.trim()).filter(Boolean).map(Number) : line.trim().split(/\s+/).map(Number)
    })
    xbarResult.value = await Api.post('/spc/xbar-r', { subgroups })
    await nextTick(); renderXbarChart()
  } catch { ElMessage.error('计算失败'); xbarResult.value = null } finally { xbarLoading.value = false }
}

const renderXbarChart = () => {
  if (!xbarResult.value || !xbarChartRef.value) return
  const d = xbarResult.value
  const xdata = d.subgroups.map((_, i) => i + 1)
  const means = d.subgroups.map(s => s.mean)
  const ocPoints = d.subgroups.map((s, i) => s.out_of_control ? i : null).filter(i => i !== null)

  if (!xbarChartInst) xbarChartInst = echarts.init(xbarChartRef.value)
  xbarChartInst.setOption({
    title: { text: 'Xbar-R 控制图', left: 'center', textStyle: { fontSize: 14 } },
    tooltip: { trigger: 'axis' },
    legend: { bottom: 0, data: ['X̄', 'UCL', 'LCL', 'CL', '失控点'] },
    grid: { left: 60, right: 30, top: 40, bottom: 30 },
    xAxis: { type: 'category', data: xdata, name: '子组序号' },
    yAxis: { type: 'value', name: 'X̄' },
    series: [
      { name: 'X̄', type: 'line', data: means, symbol: 'circle', symbolSize: 6,
        markLine: {
          silent: true, symbol: 'none',
          lineStyle: { type: 'dashed' },
          data: [
            { yAxis: d.cl, name: 'CL', label: { formatter: 'CL={c}' }, lineStyle: { color: '#333' } },
            { yAxis: d.ucl, name: 'UCL', label: { formatter: 'UCL={c}' }, lineStyle: { color: 'red' } },
            { yAxis: d.lcl, name: 'LCL', label: { formatter: 'LCL={c}' }, lineStyle: { color: 'red' } }
          ]
        }
      },
      { name: '失控点', type: 'scatter', data: ocPoints.map(i => [i, means[i]]),
        symbolSize: 12, itemStyle: { color: 'red' } }
    ]
  })
}

// ========== Tab 3: Cpk ==========
const cpkInput = ref('')
const cpkUsl = ref(10)
const cpkLsl = ref(0)
const cpkResult = ref(null)
const cpkLoading = ref(false)
const cpkChartRef = ref(null)
let cpkChartInst = null

const calcCpk = async () => {
  if (!cpkInput.value.trim()) { ElMessage.warning('请输入测量值'); return }
  cpkLoading.value = true
  try {
    const measurements = cpkInput.value.trim().split('\n').filter(l => l.trim()).map(Number)
    cpkResult.value = await Api.post('/spc/cpk', { measurements, usl: cpkUsl.value, lsl: cpkLsl.value })
    await nextTick(); renderCpkChart()
  } catch { ElMessage.error('计算失败'); cpkResult.value = null } finally { cpkLoading.value = false }
}

const renderCpkChart = () => {
  if (!cpkResult.value || !cpkChartRef.value) return
  const d = cpkResult.value
  const bins = d.histogram?.bins || []
  const counts = d.histogram?.counts || []

  if (!cpkChartInst) cpkChartInst = echarts.init(cpkChartRef.value)
  cpkChartInst.setOption({
    title: { text: '过程能力直方图', left: 'center', textStyle: { fontSize: 14 } },
    tooltip: { trigger: 'axis' },
    grid: { left: 60, right: 30, top: 40, bottom: 30 },
    xAxis: { type: 'category', data: bins.map(b => b.toFixed(3)), name: '区间', axisLabel: { rotate: 30 } },
    yAxis: { type: 'value', name: '频次' },
    series: [{
      name: '频次', type: 'bar', data: counts, barWidth: '90%',
      markLine: {
        silent: true, symbol: 'none',
        lineStyle: { type: 'dashed', color: 'red' },
        data: [
          { xAxis: bins.length > 0 ? bins[0].toFixed(3) : 0, name: 'LSL', label: { formatter: 'LSL' } },
          { xAxis: bins.length > 0 ? bins[bins.length-1].toFixed(3) : 0, name: 'USL', label: { formatter: 'USL' } }
        ]
      }
    }]
  })
}

// ========== Tab 4: Pareto ==========
const paretoInstance = ref(null)
const paretoDays = ref(30)
const paretoData = ref(null)
const paretoLoading = ref(false)
const paretoChartRef = ref(null)
let paretoChartInst = null
const instances = ref([])

const loadPareto = async () => {
  if (!paretoInstance.value) { ElMessage.warning('请选择设备实例'); return }
  paretoLoading.value = true
  try {
    paretoData.value = await Api.get('/spc/pareto', { params: { equipment_instance_id: paretoInstance.value, days: paretoDays.value } })
    await nextTick(); renderParetoChart()
  } catch { ElMessage.error('查询失败'); paretoData.value = null } finally { paretoLoading.value = false }
}

const renderParetoChart = () => {
  if (!paretoData.value || !paretoChartRef.value) return
  const d = paretoData.value
  const categories = d.categories || []
  const counts = d.counts || []
  const cumPct = d.cumulative_pct || []

  if (!paretoChartInst) paretoChartInst = echarts.init(paretoChartRef.value)
  paretoChartInst.setOption({
    title: { text: 'Pareto 图', left: 'center', textStyle: { fontSize: 14 } },
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
    legend: { bottom: 0, data: ['缺陷数量', '累计百分比'] },
    grid: { left: 60, right: 60, top: 40, bottom: 30 },
    xAxis: { type: 'category', data: categories, axisLabel: { rotate: 30 } },
    yAxis: [
      { type: 'value', name: '数量' },
      { type: 'value', name: '%', max: 100 }
    ],
    series: [
      { name: '缺陷数量', type: 'bar', data: counts, itemStyle: { color: '#409EFF' } },
      { name: '累计百分比', type: 'line', yAxisIndex: 1, data: cumPct,
        itemStyle: { color: '#F56C6C' },
        markLine: { silent: true, symbol: 'none',
          lineStyle: { type: 'dashed', color: '#E6A23C' },
          data: [{ yAxis: 80, name: '80%', label: { formatter: '80%' } }]
        }
      }
    ]
  })
}

// Load instances for Pareto tab
const loadInstances = async () => {
  try { instances.value = await Api.get('/equipment_instances') } catch { instances.value = [] }
}
onMounted(() => { loadInstances() })
</script>

<style scoped>
.page{padding:16px 24px}
.page-header{margin-bottom:16px}
.page-title{font-size:20px;font-weight:600}
.toolbar{display:flex;gap:10px;align-items:center;margin-bottom:16px;flex-wrap:wrap}
.result-area{margin-top:8px}
</style>