<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title">🤖 AI 预测分析</div>
      <el-button @click="refresh" :loading="loading">刷新</el-button>
    </div>

    <el-tabs v-model="activeTab">
      <!-- Tab: 故障预测 -->
      <el-tab-pane label="🔧 设备故障预测" name="fault">
        <el-card>
          <el-form :inline="true" size="small">
            <el-form-item label="设备"><el-select v-model="faultDevice" placeholder="选择设备" style="width:200px"><el-option v-for="d in devices" :key="d.device_code" :label="d.device_name" :value="d.device_code"/></el-select></el-form-item>
            <el-form-item label="回溯时长(h)"><el-select v-model="faultHours" style="width:120px"><el-option v-for="h in [24,48,72,168,720]" :key="h" :label="h+'h'" :value="h"/></el-select></el-form-item>
            <el-form-item><el-button type="primary" @click="predictFault" :loading="predicting">开始预测</el-button></el-form-item>
          </el-form>
          <div v-if="faultResult" style="margin-top:12px">
            <el-row :gutter="12">
              <el-col :span="6"><div class="stat-card"><div class="stat-label">故障风险</div><div class="stat-value" :style="{color: faultResult.fault_risk_pct>70?'#f56c6c':faultResult.fault_risk_pct>40?'#e6a23c':'#67c23a'}">{{ faultResult.fault_risk_pct }}%</div></div></el-col>
              <el-col :span="6"><div class="stat-card"><div class="stat-label">当前均值</div><div class="stat-value">{{ faultResult.current_avg }}</div></div></el-col>
              <el-col :span="6"><div class="stat-card"><div class="stat-label">趋势</div><div class="stat-value" style="font-size:16px">{{ faultResult.trend_direction==='rising'?'📈上升':faultResult.trend_direction==='falling'?'📉下降':'➡稳定' }}</div></div></el-col>
              <el-col :span="6"><div class="stat-card"><div class="stat-label">建议</div><div class="stat-value" style="font-size:14px">{{ faultResult.recommendation }}</div></div></el-col>
            </el-row>
            <div v-if="faultResult.predicted_failure_hours" style="margin-top:8px;padding:8px;background:#fef0f0;border-radius:6px;color:#f56c6c;font-weight:600">
              ⚠️ 预计 {{ faultResult.predicted_failure_hours }} 小时后达到报警阈值 {{ faultResult.alarm_threshold }}
            </div>
          </div>
        </el-card>
      </el-tab-pane>

      <!-- Tab: 质量预测 -->
      <el-tab-pane label="📊 质量趋势预测" name="quality">
        <el-card>
          <el-form :inline="true" size="small">
            <el-form-item label="装备实例"><el-select v-model="qualityInstance" style="width:200px"><el-option v-for="i in instances" :key="i.id" :label="i.instance_code" :value="i.id"/></el-select></el-form-item>
            <el-form-item label="回溯天数"><el-select v-model="qualityDays" style="width:120px"><el-option v-for="d in [30,60,90,180,365]" :key="d" :label="d+'天'" :value="d"/></el-select></el-form-item>
            <el-form-item><el-button type="primary" @click="predictQuality" :loading="predicting">分析</el-button></el-form-item>
          </el-form>
          <div v-if="qualityResult" style="margin-top:12px">
            <el-row :gutter="12">
              <el-col :span="6"><div class="stat-card"><div class="stat-label">历史合格率</div><div class="stat-value" :style="{color:qualityResult.historical_pass_rate>=95?'#67c23a':qualityResult.historical_pass_rate>=85?'#e6a23c':'#f56c6c'}">{{ qualityResult.historical_pass_rate }}%</div></div></el-col>
              <el-col :span="6"><div class="stat-card"><div class="stat-label">近期合格率</div><div class="stat-value">{{ qualityResult.recent_pass_rate }}%</div></div></el-col>
              <el-col :span="6"><div class="stat-card"><div class="stat-label">预测合格率</div><div class="stat-value" style="color:#409eff">{{ qualityResult.predicted_pass_rate }}%</div></div></el-col>
              <el-col :span="6"><div class="stat-card"><div class="stat-label">趋势</div><div class="stat-value" style="font-size:14px">{{ qualityResult.trend==='improving'?'📈改善':qualityResult.trend==='declining'?'📉下降':'➡稳定' }}</div></div></el-col>
            </el-row>
            <div style="margin-top:8px;color:#909399">分析样本: {{ qualityResult.total_inspections }} 次检验 | {{ qualityResult.recommendation }}</div>
          </div>
        </el-card>
      </el-tab-pane>

      <!-- Tab: 异常检测 -->
      <el-tab-pane label="🔍 异常检测" name="anomaly">
        <el-card style="margin-bottom:12px">
          <el-form :inline="true" size="small">
            <el-form-item label="设备"><el-select v-model="anomalyDevice" style="width:200px"><el-option v-for="d in devices" :key="d.device_code" :label="d.device_name" :value="d.device_code"/></el-select></el-form-item>
            <el-form-item><el-button type="primary" @click="detectAnomaly" :loading="detecting">检测</el-button></el-form-item>
          </el-form>
          <div v-if="anomalyResult">
            <el-tag :type="anomalyResult.anomalies_found>0?'danger':'success'">{{ anomalyResult.anomalies_found }} 个异常</el-tag>
            <span style="font-size:12px;color:#909399;margin-left:8px">分析 {{ anomalyResult.readings_analyzed }} 条读数</span>
          </div>
        </el-card>
        <el-card>
          <template #header><span style="font-weight:600">📋 异常事件列表</span></template>
          <el-table :data="anomalyEvents" size="small" empty-text="暂无异常">
            <el-table-column prop="message" label="描述" min-width="200" />
            <el-table-column prop="anomaly_score" label="异常分" width="80" />
            <el-table-column prop="actual_value" label="实际值" width="80" />
            <el-table-column prop="expected_value" label="期望值" width="80" />
            <el-table-column label="级别" width="80"><template #default="{row}"><el-tag :type="row.severity==='critical'?'danger':'warning'" size="small">{{row.severity}}</el-tag></template></el-table-column>
            <el-table-column prop="created_at" label="时间" width="160" />
          </el-table>
        </el-card>
      </el-tab-pane>

      <!-- Tab: 异常规则 -->
      <el-tab-pane label="⚙️ 异常规则" name="rules">
        <el-button type="primary" size="small" style="margin-bottom:8px" @click="showAddRule=true">+ 添加规则</el-button>
        <el-table :data="rules" size="small" empty-text="暂无规则">
          <el-table-column prop="rule_name" label="名称" width="160" />
          <el-table-column prop="method" label="方法" width="80" />
          <el-table-column prop="threshold" label="阈值" width="80" />
          <el-table-column prop="window_size" label="窗口" width="80" />
          <el-table-column prop="severity" label="级别" width="80" />
          <el-table-column prop="is_active" label="状态" width="80"><template #default="{row}"><el-tag :type="row.is_active?'success':'info'" size="small">{{row.is_active?'启用':'禁用'}}</el-tag></template></el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <!-- Add Rule Dialog -->
    <el-dialog v-model="showAddRule" title="添加异常规则" width="400px">
      <el-form :model="newRule" label-width="100px" size="small">
        <el-form-item label="名称" required><el-input v-model="newRule.rule_name"/></el-form-item>
        <el-form-item label="方法"><el-select v-model="newRule.method" style="width:100%"><el-option label="Z-Score" value="zscore"/><el-option label="IQR" value="iqr"/><el-option label="Moving Avg" value="moving_avg"/></el-select></el-form-item>
        <el-form-item label="窗口大小"><el-input-number v-model="newRule.window_size" :min="5" :max="1000"/></el-form-item>
        <el-form-item label="阈值"><el-input-number v-model="newRule.threshold" :min="0.5" :max="10" :step="0.1"/></el-form-item>
        <el-form-item label="级别"><el-select v-model="newRule.severity" style="width:100%"><el-option label="Warning" value="warning"/><el-option label="Critical" value="critical"/></el-select></el-form-item>
      </el-form>
      <template #footer><el-button @click="showAddRule=false">取消</el-button><el-button type="primary" @click="addRule" :loading="saving">确定</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import Api from '../api'
import { ElMessage } from 'element-plus'

const loading = ref(false); const predicting = ref(false); const detecting = ref(false); const saving = ref(false)
const activeTab = ref('fault')
const devices = ref<any[]>([]); const instances = ref<any[]>([]); const anomalyEvents = ref<any[]>([]); const rules = ref<any[]>([])
const faultDevice = ref(''); const faultHours = ref(24); const faultResult = ref<any>(null)
const qualityInstance = ref(1); const qualityDays = ref(90); const qualityResult = ref<any>(null)
const anomalyDevice = ref(''); const anomalyResult = ref<any>(null)
const showAddRule = ref(false)
const newRule = reactive({ rule_name:'', method:'zscore', window_size:30, threshold:2.0, severity:'warning' })

async function refresh() {
  loading.value = true
  try {
    devices.value = await Api.get('/iot/devices?status=online')
    const dash = await Api.get('/iot/dashboard')
    instances.value = [{id:1,instance_code:'TBM-2026-001'}]
    anomalyEvents.value = await Api.get('/ai/anomaly-events')
    rules.value = await Api.get('/ai/anomaly-rules')
  } catch(e:any) { ElMessage.error('预测失败: ' + (e.response?.data?.error || e.message)) }
  finally { loading.value = false }
}

async function predictFault() {
  if (!faultDevice.value) return ElMessage.warning('请选择设备')
  predicting.value = true
  try { faultResult.value = await Api.post('/ai/predict/fault', {device_code:faultDevice.value, hours_back:faultHours.value}) }
  catch(e:any) { ElMessage.error(e.message) }
  finally { predicting.value = false }
}

async function predictQuality() {
  predicting.value = true
  try { qualityResult.value = await Api.post('/ai/predict/quality', {instance_id:qualityInstance.value, days_back:qualityDays.value}) }
  catch(e:any) { ElMessage.error(e.message) }
  finally { predicting.value = false }
}

async function detectAnomaly() {
  if (!anomalyDevice.value) return ElMessage.warning('请选择设备')
  detecting.value = true
  try { anomalyResult.value = await Api.post('/ai/detect/anomalies', {device_code:anomalyDevice.value}); await refresh() }
  catch(e:any) { ElMessage.error(e.message) }
  finally { detecting.value = false }
}

async function addRule() {
  saving.value = true
  try { await Api.post('/ai/anomaly-rules', newRule); showAddRule.value = false; await refresh(); ElMessage.success('规则添加成功') }
  catch(e:any) { ElMessage.error(e.message) }
  finally { saving.value = false }
}

onMounted(refresh)
</script>

<style scoped>
.page { padding: 16px }
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px }
.page-title { font-size: 20px; font-weight: 700 }
.stat-card { background: #f5f7fa; border-radius: 8px; padding: 16px; text-align: center }
.stat-label { font-size: 12px; color: #909399 }
.stat-value { font-size: 28px; font-weight: 700; margin: 4px 0 }
</style>