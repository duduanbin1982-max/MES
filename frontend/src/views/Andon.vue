<template>
  <div class="page">
    <div class="page-header"><div class="page-title">🚨 ANDON 安灯报警</div></div>

    <el-tabs v-model="activeTab" type="border-card">
      <!-- Tab 1: 报警列表 (existing) -->
      <el-tab-pane label="报警列表" name="alerts">
        <el-row :gutter="16" style="margin-bottom:16px">
          <el-col :span="6"><el-card shadow="hover"><el-statistic title="总计" :value="stats.total"/></el-card></el-col>
          <el-col :span="6"><el-card shadow="hover"><el-statistic title="未处理" :value="stats.open"><template #suffix><el-tag type="danger" size="small">待确认</el-tag></template></el-statistic></el-card></el-col>
          <el-col :span="6"><el-card shadow="hover"><el-statistic title="已确认" :value="stats.acknowledged"/></el-card></el-col>
          <el-col :span="6"><el-card shadow="hover"><el-statistic title="已解决" :value="stats.resolved"><template #suffix><el-tag type="success" size="small">完成</el-tag></template></el-statistic></el-card></el-col>
        </el-row>
        <div class="toolbar">
          <el-select v-model="f.level" placeholder="级别" clearable @change="load" style="width:100px"><el-option label="严重" value="danger"/><el-option label="警告" value="warning"/><el-option label="提示" value="info"/></el-select>
          <el-select v-model="f.status" placeholder="状态" clearable @change="load" style="width:110px"><el-option label="未处理" value="open"/><el-option label="已确认" value="acknowledged"/><el-option label="已解决" value="resolved"/></el-select>
          <el-select v-model="f.type" placeholder="类型" clearable @change="load" style="width:120px"><el-option label="库存低" value="inventory_low"/><el-option label="工单逾期" value="wo_overdue"/><el-option label="设备故障" value="equipment_down"/><el-option label="质检不合格" value="qc_fail"/></el-select>
          <el-button type="primary" @click="load" :loading="loading">刷新</el-button>
          <el-button @click="doScan" :loading="scanning">🔍 扫描触发</el-button>
        </div>
        <el-table :data="alerts" stripe v-loading="loading" size="small" max-height="500">
          <el-table-column label="级别" width="80"><template #default="{row}"><el-tag :type="row.level" size="small">{{ {danger:'严重',warning:'警告',info:'提示'}[row.level]||row.level }}</el-tag></template></el-table-column>
          <el-table-column prop="title" label="标题" min-width="180" show-overflow-tooltip />
          <el-table-column prop="message" label="详情" min-width="200" show-overflow-tooltip />
          <el-table-column label="类型" width="100"><template #default="{row}"><el-tag size="small">{{ {inventory_low:'库存低',wo_overdue:'工单逾期',equipment_down:'设备故障',qc_fail:'质检不合格'}[row.alert_type]||row.alert_type }}</el-tag></template></el-table-column>
          <el-table-column label="状态" width="100"><template #default="{row}"><el-tag :type="row.status==='open'?'danger':row.status==='acknowledged'?'warning':'success'" size="small">{{ {open:'未处理',acknowledged:'已确认',resolved:'已解决'}[row.status]||row.status }}</el-tag></template></el-table-column>
          <el-table-column prop="created_at" label="时间" width="160" />
          <el-table-column label="操作" width="160" align="center" fixed="right">
            <template #default="{row}"><el-button v-if="row.status==='open'" size="small" type="warning" @click="ack(row)">确认</el-button><el-button v-if="row.status!=='resolved'" size="small" type="success" @click="resolve(row)">解决</el-button></template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- Tab 2: 通知渠道 -->
      <el-tab-pane label="通知渠道" name="channels">
        <el-card>
          <div style="display:flex;justify-content:flex-end;margin-bottom:12px"><el-button type="primary" @click="showChannelCreate = true">+ 添加渠道</el-button></div>
          <el-table :data="channels" stripe v-loading="channelLoading" size="small">
            <el-table-column label="类型" width="100"><template #default="{row}"><el-tag :type="row.channel_type==='dingtalk'?'primary':'success'" size="small">{{ row.channel_type==='dingtalk'?'钉钉':'飞书' }}</el-tag></template></el-table-column>
            <el-table-column prop="channel_name" label="渠道名称" width="160" />
            <el-table-column prop="webhook_url" label="Webhook URL" min-width="220" show-overflow-tooltip><template #default="{row}">{{ maskUrl(row.webhook_url) }}</template></el-table-column>
            <el-table-column label="启用" width="80" align="center"><template #default="{row}"><el-switch v-model="row.is_active" @change="toggleChannel(row)" /></template></el-table-column>
            <el-table-column label="操作" width="200" align="center" fixed="right">
              <template #default="{row}"><el-button size="small" type="success" @click="testChannel(row)">测试</el-button><el-button size="small" type="primary" @click="editChannel(row)">编辑</el-button><el-button size="small" type="danger" @click="deleteChannel(row)">删除</el-button></template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <!-- Tab 3: 升级规则 -->
      <el-tab-pane label="升级规则" name="escalation">
        <el-card>
          <div style="display:flex;justify-content:flex-end;margin-bottom:12px"><el-button type="primary" @click="showEscalationCreate = true">+ 添加规则</el-button></div>
          <el-table :data="escalationRules" stripe v-loading="escalationLoading" size="small">
            <el-table-column label="报警类型" width="120"><template #default="{row}"><el-tag size="small">{{ {inventory_low:'库存低',wo_overdue:'工单逾期',equipment_down:'设备故障',qc_fail:'质检不合格'}[row.andon_type]||row.andon_type }}</el-tag></template></el-table-column>
            <el-table-column label="严重级别" width="100"><template #default="{row}"><el-tag :type="row.severity" size="small">{{ {danger:'严重',warning:'警告',info:'提示'}[row.severity]||row.severity }}</el-tag></template></el-table-column>
            <el-table-column prop="escalate_after_minutes" label="升级时间(分)" width="130" />
            <el-table-column prop="escalate_to_role" label="升级至角色" min-width="180" />
          </el-table>
        </el-card>
      </el-tab-pane>

      <!-- Tab 4: 报警统计 -->
      <el-tab-pane label="报警统计" name="stats">
        <el-card>
          <el-form :inline="true" style="margin-bottom:12px">
            <el-form-item label="天数"><el-input-number v-model="statsDays" :min="1" :max="365" style="width:120px" @change="loadStats" /></el-form-item>
            <el-form-item><el-button type="primary" @click="loadStats">刷新</el-button></el-form-item>
          </el-form>
          <el-row :gutter="16" style="margin-bottom:16px">
            <el-col :span="8"><el-card shadow="hover"><el-statistic title="总报警数" :value="statsData.total || 0" /></el-card></el-col>
            <el-col :span="8"><el-card shadow="hover"><el-statistic title="严重报警" :value="statsData.critical || 0"><template #suffix><el-tag type="danger" size="small">严重</el-tag></template></el-statistic></el-card></el-col>
            <el-col :span="8"><el-card shadow="hover"><el-statistic title="警告报警" :value="statsData.warning || 0"><template #suffix><el-tag type="warning" size="small">警告</el-tag></template></el-statistic></el-card></el-col>
          </el-row>
          <div v-if="statsTrend.length" ref="statsChartRef" style="width:100%;height:350px"></div>
          <el-empty v-else description="暂无统计数据" />
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <!-- Channel Create/Edit Dialog -->
    <el-dialog v-model="showChannelCreate" :title="editingChannel ? '编辑渠道' : '添加通知渠道'" width="550px">
      <el-form :model="channelForm" label-width="120px">
        <el-form-item label="渠道类型" required><el-select v-model="channelForm.channel_type" style="width:100%"><el-option label="钉钉" value="dingtalk" /><el-option label="飞书" value="feishu" /></el-select></el-form-item>
        <el-form-item label="渠道名称" required><el-input v-model="channelForm.channel_name" placeholder="如: 生产群通知" /></el-form-item>
        <el-form-item label="Webhook URL" required><el-input v-model="channelForm.webhook_url" placeholder="https://..." /></el-form-item>
        <el-form-item label="Secret"><el-input v-model="channelForm.secret" placeholder="签名密钥(可选)" /></el-form-item>
        <el-form-item label="通知级别"><el-checkbox-group v-model="channelForm.notify_severities"><el-checkbox label="danger">严重</el-checkbox><el-checkbox label="warning">警告</el-checkbox><el-checkbox label="info">提示</el-checkbox></el-checkbox-group></el-form-item>
      </el-form>
      <template #footer><el-button @click="showChannelCreate = false">取消</el-button><el-button type="primary" @click="saveChannel" :loading="channelSaving">保存</el-button></template>
    </el-dialog>

    <!-- Escalation Rule Create Dialog -->
    <el-dialog v-model="showEscalationCreate" title="添加升级规则" width="500px">
      <el-form :model="escalationForm" label-width="130px">
        <el-form-item label="报警类型" required><el-select v-model="escalationForm.andon_type" style="width:100%"><el-option label="库存低" value="inventory_low" /><el-option label="工单逾期" value="wo_overdue" /><el-option label="设备故障" value="equipment_down" /><el-option label="质检不合格" value="qc_fail" /></el-select></el-form-item>
        <el-form-item label="严重级别" required><el-select v-model="escalationForm.severity" style="width:100%"><el-option label="严重" value="danger" /><el-option label="警告" value="warning" /><el-option label="提示" value="info" /></el-select></el-form-item>
        <el-form-item label="升级时间(分钟)" required><el-input-number v-model="escalationForm.escalate_after_minutes" :min="1" style="width:100%" /></el-form-item>
        <el-form-item label="升级至角色" required><el-input v-model="escalationForm.escalate_to_role" placeholder="如: 生产主管、质量经理" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="showEscalationCreate = false">取消</el-button><el-button type="primary" @click="saveEscalation" :loading="escalationSaving">保存</el-button></template>
    </el-dialog>
  </div>
</template>
<script setup lang="ts">
import { ref, reactive, onMounted, nextTick } from 'vue'
import { Api } from '../api'
import { ElMessage, ElMessageBox } from 'element-plus'
import * as echarts from 'echarts'

const activeTab = ref('alerts')

// ========== Tab 1: Alerts (existing) ==========
const alerts = ref([])
const loading = ref(false)
const scanning = ref(false)
const stats = reactive({ total: 0, open: 0, acknowledged: 0, resolved: 0 })
const f = reactive({ level: '', status: '', type: '' })

const load = async () => {
  loading.value = true
  try {
    const p: any = {}
    if (f.level) p.level = f.level
    if (f.status) p.status = f.status
    if (f.type) p.alert_type = f.type
    alerts.value = await Api.get('/andon/alerts', { params: p })
    const s = await Api.get('/andon/stats')
    Object.assign(stats, s)
  } catch (_) { alerts.value = []; ElMessage.error('加载报警失败') } finally { loading.value = false }
}

const ack = async (row: any) => { try { await Api.post('/andon/alerts/'+row.id+'/ack'); ElMessage.success('已确认'); load() } catch { ElMessage.error('失败') } }
const resolve = async (row: any) => { try { await Api.post('/andon/alerts/'+row.id+'/resolve'); ElMessage.success('已解决'); load() } catch { ElMessage.error('失败') } }
const doScan = async () => { scanning.value=true; try { const r = await Api.post('/andon/scan'); ElMessage.success('扫描完成, 触发 '+r.triggered+' 条报警') } catch { ElMessage.error('扫描失败') } finally { scanning.value=false } }

// ========== Tab 2: Channels ==========
const channels = ref<any[]>([])
const channelLoading = ref(false)
const showChannelCreate = ref(false)
const channelSaving = ref(false)
const editingChannel = ref<any>(null)
const channelForm = reactive({
  channel_type: 'dingtalk', channel_name: '', webhook_url: '', secret: '',
  notify_severities: ['danger', 'warning'] as string[]
})

const maskUrl = (url: string) => {
  if (!url) return ''
  if (url.length <= 40) return url
  return url.substring(0, 25) + '...' + url.substring(url.length - 15)
}

const loadChannels = async () => {
  channelLoading.value = true
  try { channels.value = await Api.get('/andon/channels') } catch { channels.value = [] } finally { channelLoading.value = false }
}

const saveChannel = async () => {
  if (!channelForm.channel_name || !channelForm.webhook_url) { ElMessage.warning('请填写必填项'); return }
  channelSaving.value = true
  try {
    if (editingChannel.value) {
      await Api.put(`/andon/channels/${editingChannel.value.id}`, channelForm)
      ElMessage.success('渠道已更新')
    } else {
      await Api.post('/andon/channels', channelForm)
      ElMessage.success('渠道已添加')
    }
    showChannelCreate.value = false
    editingChannel.value = null
    Object.assign(channelForm, { channel_type: 'dingtalk', channel_name: '', webhook_url: '', secret: '', notify_severities: ['danger', 'warning'] })
    await loadChannels()
  } catch { ElMessage.error('保存失败') } finally { channelSaving.value = false }
}

const editChannel = (row: any) => {
  editingChannel.value = row
  Object.assign(channelForm, {
    channel_type: row.channel_type,
    channel_name: row.channel_name,
    webhook_url: row.webhook_url,
    secret: row.secret || '',
    notify_severities: row.notify_severities || ['danger', 'warning']
  })
  showChannelCreate.value = true
}

const deleteChannel = async (row: any) => {
  try {
    await ElMessageBox.confirm('确定删除该通知渠道?', '确认', { type: 'warning' })
    await Api.del(`/andon/channels/${row.id}`)
    ElMessage.success('已删除')
    await loadChannels()
  } catch { /* cancelled */ }
}

const toggleChannel = async (row: any) => {
  try {
    await Api.put(`/andon/channels/${row.id}`, { is_active: row.is_active })
    ElMessage.success(row.is_active ? '已启用' : '已停用')
  } catch { row.is_active = !row.is_active; ElMessage.error('操作失败') }
}

const testChannel = async (row: any) => {
  try {
    const r = await Api.post(`/andon/channels/${row.id}/test`)
    ElMessage.success('测试发送成功: ' + (r.message || 'OK'))
  } catch { ElMessage.error('测试失败') }
}

// ========== Tab 3: Escalation Rules ==========
const escalationRules = ref<any[]>([])
const escalationLoading = ref(false)
const showEscalationCreate = ref(false)
const escalationSaving = ref(false)
const escalationForm = reactive({
  andon_type: 'equipment_down', severity: 'danger',
  escalate_after_minutes: 30, escalate_to_role: ''
})

const loadEscalationRules = async () => {
  escalationLoading.value = true
  try { escalationRules.value = await Api.get('/andon/escalation-rules') } catch { escalationRules.value = [] } finally { escalationLoading.value = false }
}

const saveEscalation = async () => {
  if (!escalationForm.escalate_to_role) { ElMessage.warning('请填写升级角色'); return }
  escalationSaving.value = true
  try {
    await Api.post('/andon/escalation-rules', escalationForm)
    ElMessage.success('规则已添加')
    showEscalationCreate.value = false
    Object.assign(escalationForm, { andon_type: 'equipment_down', severity: 'danger', escalate_after_minutes: 30, escalate_to_role: '' })
    await loadEscalationRules()
  } catch { ElMessage.error('保存失败') } finally { escalationSaving.value = false }
}

// ========== Tab 4: Stats ==========
const statsDays = ref(30)
const statsData = ref<any>({ total: 0, critical: 0, warning: 0 })
const statsTrend = ref<any[]>([])
const statsChartRef = ref(null)
let statsChartInst: any = null

const loadStats = async () => {
  try {
    const r = await Api.get('/andon/stats', { params: { days: statsDays.value } })
    statsData.value = { total: r.total || 0, critical: r.critical || 0, warning: r.warning || 0 }
    statsTrend.value = r.trend || []
    await nextTick(); renderStatsChart()
  } catch { statsTrend.value = [] }
}

const renderStatsChart = () => {
  if (!statsTrend.value.length || !statsChartRef.value) return
  const dates = statsTrend.value.map((d: any) => d.date)
  const totals = statsTrend.value.map((d: any) => d.count)

  if (!statsChartInst) statsChartInst = echarts.init(statsChartRef.value)
  statsChartInst.setOption({
    title: { text: '报警趋势 (' + statsDays.value + '天)', left: 'center', textStyle: { fontSize: 14 } },
    tooltip: { trigger: 'axis' },
    grid: { left: 60, right: 30, top: 40, bottom: 30 },
    xAxis: { type: 'category', data: dates, axisLabel: { rotate: 30 } },
    yAxis: { type: 'value', name: '报警数' },
    series: [{
      name: '报警数', type: 'line', data: totals, smooth: true,
      areaStyle: { color: 'rgba(245,108,108,0.15)' },
      itemStyle: { color: '#F56C6C' }
    }]
  })
}

onMounted(() => { load(); loadChannels(); loadEscalationRules(); loadStats() })
</script>

<style scoped>
.page{padding:16px 24px}
.page-header{margin-bottom:16px}
.page-title{font-size:20px;font-weight:600}
.toolbar{display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap}
</style>