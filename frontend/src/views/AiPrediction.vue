<template>
  <div class="page">
    <PageToolbar class="page-header">
      <div>
        <div class="page-title">AI 预测与模型</div>
        <div class="page-subtitle">设备时序训练、故障风险、质量趋势与异常事件</div>
      </div>
      <div class="header-actions">
        <el-button type="primary" :loading="training" @click="trainModels">训练 IoT 模型</el-button>
        <el-button :loading="loading" @click="refresh">刷新</el-button>
      </div>
    </PageToolbar>

    <el-row :gutter="12" class="overview-row">
      <el-col :span="6"><div class="metric"><span>活跃模型</span><strong>{{ readiness.active_models || 0 }}</strong></div></el-col>
      <el-col :span="6"><div class="metric"><span>可训练时序</span><strong>{{ readiness.iot?.trainable_series || 0 }}</strong></div></el-col>
      <el-col :span="6"><div class="metric"><span>小时样本</span><strong>{{ formatNumber(readiness.iot?.hourly_samples) }}</strong></div></el-col>
      <el-col :span="6"><div class="metric"><span>质量样本</span><strong :class="{ warning: readiness.quality?.status !== 'ready' }">{{ readiness.quality?.samples || 0 }}</strong></div></el-col>
    </el-row>

    <el-tabs v-model="activeTab" type="border-card">
      <el-tab-pane label="模型训练" name="models">
        <div class="toolbar">
          <div class="status-line">
            <el-tag :type="readiness.iot?.status === 'ready' ? 'success' : 'warning'">IoT {{ readiness.iot?.status === 'ready' ? '可训练' : '数据不足' }}</el-tag>
            <el-tag :type="readiness.quality?.status === 'ready' ? 'success' : 'info'">质量 {{ readiness.quality?.samples || 0 }}/{{ readiness.quality?.min_samples || 30 }}</el-tag>
          </div>
          <el-button size="small" type="primary" :loading="training" @click="trainModels">训练新版本</el-button>
        </div>
        <el-table :data="models" size="small" stripe max-height="430" empty-text="尚未训练模型">
          <el-table-column prop="device_code" label="设备" width="105" />
          <el-table-column prop="point_name" label="测点" min-width="130" />
          <el-table-column label="版本" width="75"><template #default="{ row }">v{{ row.version }}</template></el-table-column>
          <el-table-column prop="algorithm" label="算法" width="115" />
          <el-table-column label="训练/验证" width="105"><template #default="{ row }">{{ row.training_rows }}/{{ row.validation_rows }}</template></el-table-column>
          <el-table-column label="MAE" width="80"><template #default="{ row }">{{ number(row.metrics?.mae, 3) }}</template></el-table-column>
          <el-table-column label="RMSE" width="80"><template #default="{ row }">{{ number(row.metrics?.rmse, 3) }}</template></el-table-column>
          <el-table-column label="R²" width="75"><template #default="{ row }"><span :class="metricClass(row.metrics?.r2)">{{ number(row.metrics?.r2, 3) }}</span></template></el-table-column>
          <el-table-column label="基线提升" width="95"><template #default="{ row }">{{ percent(row.metrics?.skill_vs_baseline) }}</template></el-table-column>
          <el-table-column label="阈值" width="90"><template #default="{ row }"><el-tag :type="row.data_quality?.calibration_status === 'ok' ? 'success' : 'warning'" size="small">{{ row.data_quality?.calibration_status === 'ok' ? '正常' : '需校准' }}</el-tag></template></el-table-column>
          <el-table-column prop="trained_at" label="训练时间" width="155" />
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="设备故障预测" name="fault">
        <div class="toolbar">
          <div class="form-row">
            <el-select v-model="faultDevice" placeholder="选择设备" style="width:220px">
              <el-option v-for="device in devices" :key="device.device_code" :label="device.device_name" :value="device.device_code" />
            </el-select>
            <el-select v-model="faultHours" style="width:130px"><el-option v-for="hours in [24, 48, 72, 168, 720]" :key="hours" :label="hours + ' 小时'" :value="hours" /></el-select>
          </div>
          <el-button type="primary" :loading="predicting" @click="predictFault">开始预测</el-button>
        </div>
        <template v-if="faultResult">
          <el-row :gutter="12" class="result-row">
            <el-col :span="6"><div class="result"><span>故障风险</span><strong :class="riskClass(faultResult.fault_risk_pct)">{{ faultResult.fault_risk_pct }}%</strong></div></el-col>
            <el-col :span="6"><div class="result"><span>置信度</span><strong>{{ faultResult.confidence || '-' }}%</strong></div></el-col>
            <el-col :span="6"><div class="result"><span>最高风险测点</span><strong class="small-value">{{ faultResult.highest_risk_point || '-' }}</strong></div></el-col>
            <el-col :span="6"><div class="result"><span>模型来源</span><strong class="small-value">{{ faultResult.model_source || '统计回退' }}</strong></div></el-col>
          </el-row>
          <el-alert :title="faultResult.recommendation" :type="faultResult.fault_risk_pct >= 70 ? 'error' : faultResult.fault_risk_pct >= 40 ? 'warning' : 'success'" show-icon :closable="false" class="result-alert" />
          <el-table :data="faultResult.point_predictions || []" size="small" stripe max-height="320">
            <el-table-column prop="point_name" label="测点" min-width="130" />
            <el-table-column label="当前值" width="95"><template #default="{ row }">{{ number(row.current_value, 2) }} {{ row.unit }}</template></el-table-column>
            <el-table-column label="下一时刻" width="95"><template #default="{ row }">{{ number(row.next_prediction, 2) }}</template></el-table-column>
            <el-table-column label="风险" width="80"><template #default="{ row }"><el-tag :type="row.risk_pct >= 70 ? 'danger' : row.risk_pct >= 40 ? 'warning' : 'success'" size="small">{{ row.risk_pct }}%</el-tag></template></el-table-column>
            <el-table-column label="模型" width="90"><template #default="{ row }">v{{ row.model_version }}</template></el-table-column>
            <el-table-column label="R²" width="80"><template #default="{ row }">{{ number(row.metrics?.r2, 3) }}</template></el-table-column>
            <el-table-column label="阈值状态" width="90"><template #default="{ row }"><el-tag :type="row.calibration_status === 'ok' ? 'success' : 'warning'" size="small">{{ row.calibration_status === 'ok' ? '正常' : '需校准' }}</el-tag></template></el-table-column>
          </el-table>
        </template>
      </el-tab-pane>

      <el-tab-pane label="质量趋势" name="quality">
        <div class="toolbar">
          <div class="form-row">
            <el-select v-model="qualityInstance" placeholder="选择装备" style="width:240px"><el-option v-for="instance in instances" :key="instance.id" :label="instance.instance_name || instance.instance_code" :value="instance.id" /></el-select>
            <el-select v-model="qualityDays" style="width:120px"><el-option v-for="days in [30, 60, 90, 180, 365]" :key="days" :label="days + ' 天'" :value="days" /></el-select>
          </div>
          <el-button type="primary" :loading="predicting" @click="predictQuality">分析</el-button>
        </div>
        <el-alert v-if="readiness.quality?.status !== 'ready'" :title="'质量样本不足：当前 ' + (readiness.quality?.samples || 0) + ' 条，训练门槛 ' + (readiness.quality?.min_samples || 30) + ' 条'" type="warning" show-icon :closable="false" />
        <el-row v-if="qualityResult?.predicted_pass_rate !== undefined" :gutter="12" class="result-row">
          <el-col :span="6"><div class="result"><span>历史合格率</span><strong>{{ qualityResult.historical_pass_rate }}%</strong></div></el-col>
          <el-col :span="6"><div class="result"><span>近期合格率</span><strong>{{ qualityResult.recent_pass_rate }}%</strong></div></el-col>
          <el-col :span="6"><div class="result"><span>预测合格率</span><strong>{{ qualityResult.predicted_pass_rate }}%</strong></div></el-col>
          <el-col :span="6"><div class="result"><span>趋势</span><strong class="small-value">{{ qualityResult.trend }}</strong></div></el-col>
        </el-row>
      </el-tab-pane>

      <el-tab-pane label="异常事件" name="anomaly">
        <div class="toolbar">
          <el-select v-model="anomalyDevice" placeholder="选择设备" style="width:220px"><el-option v-for="device in devices" :key="device.device_code" :label="device.device_name" :value="device.device_code" /></el-select>
          <el-button type="primary" :loading="detecting" @click="detectAnomaly">执行检测</el-button>
        </div>
        <el-table :data="anomalyEvents" size="small" stripe max-height="430" empty-text="暂无异常事件">
          <el-table-column prop="message" label="描述" min-width="220" />
          <el-table-column prop="anomaly_score" label="异常分" width="80" />
          <el-table-column prop="actual_value" label="实际值" width="90" />
          <el-table-column prop="expected_value" label="期望值" width="90" />
          <el-table-column label="级别" width="85"><template #default="{ row }"><el-tag :type="row.severity === 'critical' ? 'danger' : 'warning'" size="small">{{ row.severity }}</el-tag></template></el-table-column>
          <el-table-column prop="created_at" label="时间" width="155" />
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="训练记录" name="runs">
        <el-table :data="trainingRuns" size="small" stripe max-height="430">
          <el-table-column prop="model_code" label="模型" min-width="190" />
          <el-table-column prop="status" label="状态" width="85"><template #default="{ row }"><el-tag :type="row.status === 'completed' ? 'success' : 'danger'" size="small">{{ row.status }}</el-tag></template></el-table-column>
          <el-table-column label="训练/验证" width="100"><template #default="{ row }">{{ row.training_rows }}/{{ row.validation_rows }}</template></el-table-column>
          <el-table-column prop="mae" label="MAE" width="80" />
          <el-table-column prop="rmse" label="RMSE" width="80" />
          <el-table-column prop="r2" label="R²" width="80" />
          <el-table-column prop="message" label="结果" min-width="180" />
          <el-table-column prop="completed_at" label="完成时间" width="155" />
        </el-table>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue"
import { ElMessage } from "element-plus"
import Api from "../api"

const loading = ref(false)
const training = ref(false)
const predicting = ref(false)
const detecting = ref(false)
const activeTab = ref("models")
const devices = ref<any[]>([])
const instances = ref<any[]>([])
const models = ref<any[]>([])
const trainingRuns = ref<any[]>([])
const anomalyEvents = ref<any[]>([])
const readiness = ref<any>({ iot: {}, quality: {} })
const faultDevice = ref("")
const faultHours = ref(168)
const faultResult = ref<any>(null)
const qualityInstance = ref<any>(null)
const qualityDays = ref(90)
const qualityResult = ref<any>(null)
const anomalyDevice = ref("")

const number = (value: unknown, digits = 2) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "-"
const percent = (value: unknown) => Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(1)}%` : "-"
const formatNumber = (value: unknown) => Number(value || 0).toLocaleString()
const metricClass = (value: unknown) => Number(value) >= 0.7 ? "positive" : Number(value) < 0 ? "negative" : ""
const riskClass = (value: number) => value >= 70 ? "negative" : value >= 40 ? "warning" : "positive"

async function refresh() {
  loading.value = true
  try {
    const [deviceRows, instanceRows, modelRows, runRows, readinessRow, events] = await Promise.all([
      Api.get("/iot/devices?status=online"),
      Api.instances(),
      Api.get("/ai/models"),
      Api.get("/ai/training-runs"),
      Api.get("/ai/models/readiness"),
      Api.get("/ai/anomaly-events"),
    ])
    devices.value = deviceRows.items || deviceRows || []
    instances.value = instanceRows.items || instanceRows || []
    models.value = modelRows.items || []
    trainingRuns.value = runRows.items || []
    readiness.value = readinessRow
    anomalyEvents.value = events.items || events || []
    if (!faultDevice.value && devices.value.length) faultDevice.value = devices.value[0].device_code
    if (!anomalyDevice.value && devices.value.length) anomalyDevice.value = devices.value[0].device_code
    if (!qualityInstance.value && instances.value.length) qualityInstance.value = instances.value[0].id
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || error.message || "加载失败")
  } finally {
    loading.value = false
  }
}

async function trainModels() {
  training.value = true
  try {
    const result = await Api.post("/ai/models/train", { min_samples: 48 })
    ElMessage.success(`已训练 ${result.trained} 个模型，失败 ${result.failed}`)
    await refresh()
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || error.message || "训练失败")
  } finally {
    training.value = false
  }
}

async function predictFault() {
  if (!faultDevice.value) return ElMessage.warning("请选择设备")
  predicting.value = true
  try {
    faultResult.value = await Api.post("/ai/predict/fault", { device_code: faultDevice.value, hours_back: faultHours.value })
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || error.message || "预测失败")
  } finally {
    predicting.value = false
  }
}

async function predictQuality() {
  if (!qualityInstance.value) return ElMessage.warning("请选择装备")
  predicting.value = true
  try {
    qualityResult.value = await Api.post("/ai/predict/quality", { instance_id: qualityInstance.value, days_back: qualityDays.value })
    if (qualityResult.value.status === "insufficient_data") ElMessage.warning(qualityResult.value.message)
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || error.message || "分析失败")
  } finally {
    predicting.value = false
  }
}

async function detectAnomaly() {
  if (!anomalyDevice.value) return ElMessage.warning("请选择设备")
  detecting.value = true
  try {
    const result = await Api.post("/ai/detect/anomalies", { device_code: anomalyDevice.value })
    ElMessage.success(`检测完成，发现 ${result.anomalies_found} 个异常`)
    await refresh()
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || error.message || "检测失败")
  } finally {
    detecting.value = false
  }
}

onMounted(refresh)
</script>

<style scoped>
.page { padding: 16px; }
.page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
.page-title { font-size: 20px; font-weight: 700; }
.page-subtitle { color: var(--color-text-muted); margin-top: 4px; font-size: 13px; }
.header-actions, .toolbar, .form-row, .status-line { display: flex; align-items: center; gap: 8px; }
.toolbar { justify-content: space-between; margin-bottom: 12px; }
.overview-row, .result-row { margin-bottom: 12px; }
.metric, .result { min-height: 82px; padding: 14px 16px; border: 1px solid var(--el-border-color-light); border-radius: 6px; background: var(--el-color-white); display: flex; flex-direction: column; justify-content: center; }
.metric span, .result span { color: var(--color-text-muted); font-size: 12px; }
.metric strong, .result strong { font-size: 25px; margin-top: 5px; color: var(--el-text-color-primary); }
.result .small-value { font-size: 15px; line-height: 1.3; }
.result-alert { margin-bottom: 12px; }
.positive { color: #3a8b5c !important; }
.warning { color: #c27c0e !important; }
.negative { color: #d64545 !important; }
</style>
