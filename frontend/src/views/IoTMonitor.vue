<template>
    <el-alert
    type="warning"
    show-icon
    :closable="false"
    style="margin-bottom: 12px"
    title="IoT 尚未接入真实设备"
    description="当前 IOT_MODE=production，采集器不产生数据（iot_readings=0）。本页仅展示数据结构与界面，待接入 Modbus/OPC-UA 后自动生效。"
  />
<div class="page">
    <PageToolbar class="page-header">
      <div class="page-title"><el-icon><Cellphone /></el-icon> IoT 设备监控</div>
      <div style="display:flex;gap: 8px">
        <el-button type="primary" @click="showAddDevice=true">+ 添加设备</el-button>
        <el-button @click="refreshAll" :loading="loading">刷新</el-button>
      </div>
    </PageToolbar>

    <!-- Dashboard Stats -->
    <el-row :gutter="12" style="margin-bottom:12px">
      <el-col :span="6"><div class="stat-card"><div class="stat-label">在线设备</div><div class="stat-value" style="color:var(--el-color-success)">{{ dash.devices?.online||0 }}</div><div class="stat-sub">/ {{ dash.devices?.total||0 }} 总设备</div></div></el-col>
      <el-col :span="6"><div class="stat-card"><div class="stat-label">24h读数</div><div class="stat-value" style="color:var(--el-color-primary)">{{ dash.readings_24h||0 }}</div></div></el-col>
      <el-col :span="6"><div class="stat-card"><div class="stat-label">未确认报警</div><div class="stat-value" :style="{color: (dash.unack_alarms||0)>0?'var(--el-color-danger)':'var(--el-color-success)'}">{{ dash.unack_alarms||0 }}</div></div></el-col>
      <el-col :span="6"><div class="stat-card"><div class="stat-label">配置就绪</div><div class="stat-value" style="color:var(--el-color-info)">{{ dash.configured_devices||0 }}</div><div class="stat-sub">{{ dash.mode==='production'?'生产模式':'模拟模式' }}</div></div></el-col>
    </el-row>

    <!-- Device Cards -->
    <el-row :gutter="12" style="margin-bottom:12px">
      <el-col :span="8" v-for="dev in devices" :key="dev.id">
        <el-card shadow="hover" :class="['device-card', dev.status==='online'?'online':'offline']" @click="selectDevice(dev)">
          <template #header>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span style="font-weight:600">{{ dev.device_name }}</span>
              <el-tag :type="dev.status==='online'?'success':'info'" size="small">{{ dev.status==='online'?'在线':'离线' }}</el-tag>
              <el-tag :type="dev.readiness?.configured?'success':'warning'" size="small">{{ dev.readiness?.configured?'已配置':'待配置' }}</el-tag>
            </div>
          </template>
          <div style="font-size:12px;color:var(--el-color-info)">
            <div>编码: {{ dev.device_code }}</div>
            <div>协议: {{ dev.protocol?.toUpperCase() }} {{ dev.ip_address }}:{{ dev.port }}</div>
            <div>位置: {{ dev.location||'-' }}</div>
            <div v-if="dev.last_seen_at">最后活跃: {{ dev.last_seen_at?.substring(5,16) }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="24" v-if="devices.length===0">
        <PageState state="empty" compact :show-action="false" description="暂无设备，点击上方添加" />
      </el-col>
    </el-row>

    <!-- Selected Device Detail -->
    <el-card v-if="selected" style="margin-bottom:12px">
      <template #header>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:600"><el-icon><Search /></el-icon> {{ selected.device_name }} — 数据点与读数</span>
          <div style="display:flex;gap:8px">
            <el-button size="small" @click="showAddPoint=true">+ 添加数据点</el-button>
            <el-button v-if="dash.mode==='simulator'" size="small" type="success" @click="showPushReading=true">模拟采集</el-button>
          </div>
        </div>
      </template>
      <el-table :data="selectedPoints" size="small" empty-text="暂无数据点" max-height="500">
        <el-table-column prop="point_code" label="编码" width="140" />
        <el-table-column prop="point_name" label="名称" width="120" />
        <el-table-column prop="unit" label="单位" width="60" />
        <el-table-column label="报警范围" width="160">
          <template #default="{row}">{{ row.alarm_low||'-' }} ~ {{ row.alarm_high||'-' }}</template>
        </el-table-column>
        <el-table-column label="最新读数" width="120">
          <template #default="{row}">
            <span :style="{color:(row.alarm_high&&latestReadings[row.point_code]?.value>row.alarm_high)?'var(--el-color-danger)':''}">
              {{ latestReadings[row.point_code]?.value||'-' }} {{ row.unit }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="data_type" label="类型" width="80" />
      </el-table>
    </el-card>

    <!-- Alarms Panel -->
    <el-card>
      <template #header>
        <span style="font-weight:600;color:var(--el-color-danger)"><el-icon><Warning /></el-icon> 报警面板</span>
      </template>
      <el-table :data="alarms" size="small" empty-text="无报警" max-height="500">
        <el-table-column prop="device_code" label="设备" width="120" />
        <el-table-column prop="point_name" label="数据点" width="100" />
        <el-table-column label="报警" min-width="200">
          <template #default="{row}">{{ row.message }}</template>
        </el-table-column>
        <el-table-column label="级别" width="80">
          <template #default="{row}"><el-tag :type="row.severity==='critical'?'danger':'warning'" size="small">{{ row.severity }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="created_at" label="时间" width="160" />
        <el-table-column label="操作" width="80">
          <template #default="{row}">
            <el-button v-if="!row.acknowledged" size="small" type="primary" @click="ackAlarm(row.id)">确认</el-button>
            <span v-else style="color:var(--el-color-success);font-size:12px">已确认</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- Add Device Dialog -->
    <el-dialog v-model="showAddDevice" title="添加 IoT 设备" width="480px">
      <el-form :model="newDevice" label-width="100px" size="small">
        <el-form-item label="设备编码" required><el-input v-model="newDevice.device_code" /></el-form-item>
        <el-form-item label="设备名称" required><el-input v-model="newDevice.device_name" /></el-form-item>
        <el-form-item label="设备类型"><el-select v-model="newDevice.device_type" style="width:100%"><el-option v-for="t in ['sensor','machine','controller','camera']" :key="t" :label="t" :value="t"/></el-select></el-form-item>
        <el-form-item label="协议"><el-select v-model="newDevice.protocol" style="width:100%"><el-option label="Modbus TCP" value="modbus"/><el-option label="OPC UA" value="opcua"/><el-option label="MQTT" value="mqtt"/></el-select></el-form-item>
        <el-form-item label="IP地址"><el-input v-model="newDevice.ip_address" placeholder="192.168.1.100"/></el-form-item>
        <el-form-item label="端口"><el-input-number v-model="newDevice.port" :min="1" :max="65535"/></el-form-item>
        <el-form-item label="从站ID"><el-input-number v-model="newDevice.slave_id" :min="1"/></el-form-item>
        <el-form-item label="寄存器起始"><el-input-number v-model="newDevice.register_start" :min="0"/></el-form-item>
        <el-form-item label="寄存器数量"><el-input-number v-model="newDevice.register_count" :min="1" :max="256"/></el-form-item>
        <el-form-item label="扫描间隔(ms)"><el-input-number v-model="newDevice.scan_interval_ms" :min="100" :max="60000" :step="100"/></el-form-item>
        <el-form-item label="位置"><el-input v-model="newDevice.location" placeholder="车间A区"/></el-form-item>
      </el-form>
      <template #footer><el-button @click="showAddDevice=false">取消</el-button><el-button type="primary" @click="addDevice" :loading="saving">确定</el-button></template>
    </el-dialog>

    <!-- Add Point Dialog -->
    <el-dialog v-model="showAddPoint" title="添加数据点" width="400px">
      <el-form :model="newPoint" label-width="100px" size="small">
        <el-form-item label="编码" required><el-input v-model="newPoint.point_code" /></el-form-item>
        <el-form-item label="名称" required><el-input v-model="newPoint.point_name" /></el-form-item>
        <el-form-item label="数据类型"><el-select v-model="newPoint.data_type" style="width:100%"><el-option v-for="t in ['float','int','bool','string']" :key="t" :label="t" :value="t"/></el-select></el-form-item>
        <el-form-item label="单位"><el-input v-model="newPoint.unit" placeholder="rpm/°C/MPa"/></el-form-item>
        <el-form-item v-if="selected?.protocol==='modbus'" label="寄存器地址" required><el-input-number v-model="newPoint.register_offset" :min="0" /></el-form-item>
        <el-form-item label="下限报警"><el-input-number v-model="newPoint.alarm_low" :precision="1"/></el-form-item>
        <el-form-item label="上限报警"><el-input-number v-model="newPoint.alarm_high" :precision="1"/></el-form-item>
      </el-form>
      <template #footer><el-button @click="showAddPoint=false">取消</el-button><el-button type="primary" @click="addPoint" :loading="saving">确定</el-button></template>
    </el-dialog>

    <!-- Push Reading Dialog -->
    <el-dialog v-model="showPushReading" title="模拟数据采集" width="400px">
      <div v-for="pt in selectedPoints" :key="pt.point_code" style="margin-bottom:8px">
        <div style="font-size:12px;margin-bottom:2px">{{ pt.point_name }} ({{ pt.point_code }}) {{ pt.unit }}</div>
        <el-input-number v-model="readingValues[pt.point_code]" :precision="1" size="small" style="width:100%"/>
      </div>
      <template #footer><el-button @click="showPushReading=false">取消</el-button><el-button type="primary" @click="pushReadings" :loading="saving">提交</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onBeforeUnmount } from 'vue'
import Api from '../api'
import { ElMessage } from 'element-plus'

const loading = ref(false); const saving = ref(false)
const devices = ref<any[]>([]); const alarms = ref<any[]>([]); const dash = ref<any>({})
const selected = ref<any>(null); const selectedPoints = ref<any[]>([])
const latestReadings = ref<Record<string,any>>({})
const readingValues = ref<Record<string,number>>({})
const showAddDevice = ref(false); const showAddPoint = ref(false); const showPushReading = ref(false)

const newDevice = reactive({ device_code:'', device_name:'', device_type:'machine', protocol:'modbus', ip_address:'', port:502, slave_id:1, register_start:40001, register_count:10, scan_interval_ms:5000, location:'' })
const newPoint = reactive({ point_code:'', point_name:'', data_type:'float', unit:'', register_offset:null, alarm_low:null, alarm_high:null })

async function refreshAll() {
  loading.value = true
  try {
    const [d, a, dsh] = await Promise.all([
      Api.get('/iot/devices'),
      Api.get('/iot/alarms?acknowledged=0'),
      Api.get('/iot/dashboard')
    ])
    devices.value = d; alarms.value = a; dash.value = dsh
  } catch(e:any) { ElMessage.error(e.message) }
  finally { loading.value = false }
}

async function selectDevice(dev: any) {
  selected.value = dev
  try {
    const detail = await Api.get(`/iot/devices/${dev.id}`)
    selectedPoints.value = detail.points || []
    const latest = await Api.get('/iot/readings/latest')
    const map: Record<string,any> = {}
    latest.forEach((r:any) => { if (r.device_id === dev.id) map[r.point_name?.toLowerCase()] = r })
    latestReadings.value = map
  } catch(e:any) { ElMessage.error(e.message) }
}

async function addDevice() {
  saving.value = true
  try { await Api.post('/iot/devices', newDevice); showAddDevice.value = false; Object.assign(newDevice, {device_code:'',device_name:'',ip_address:''}); await refreshAll(); ElMessage.success('设备添加成功') }
  catch(e:any) { ElMessage.error(e.message) }
  finally { saving.value = false }
}

async function addPoint() {
  if (!selected.value) return
  saving.value = true
  try { await Api.post(`/iot/devices/${selected.value.id}/points`, newPoint); showAddPoint.value = false; await selectDevice(selected.value); ElMessage.success('数据点添加成功') }
  catch(e:any) { ElMessage.error(e.message) }
  finally { saving.value = false }
}

async function pushReadings() {
  if (!selected.value) return
  saving.value = true
  const points = Object.entries(readingValues.value).map(([code,value]) => ({code, value}))
  try { const r = await Api.post('/iot/readings', { device_code: selected.value.device_code, points }); ElMessage.success(`提交 ${r.ingested} 条读数`); if(r.alarms_triggered>0) ElMessage.warning(`触发 ${r.alarms_triggered} 条报警`); showPushReading.value = false; await selectDevice(selected.value); await refreshAll() }
  catch(e:any) { ElMessage.error(e.message) }
  finally { saving.value = false }
}

async function ackAlarm(id: number) {
  try { await Api.patch(`/iot/alarms/${id}/ack`, {}); ElMessage.success('已确认'); await refreshAll() }
  catch(e:any) { ElMessage.error(e.message) }
}

// MESA #5: WebSocket 实时推送 (IoT readings & alarms)
let ws: WebSocket | null = null
let wsReconnectTimer: any = null
function connectWS() {
  const token = localStorage.getItem('token') || ''
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const url = proto + '://' + location.host + '/ws?token=' + encodeURIComponent(token)
  try {
    ws = new WebSocket(url)
    ws.onopen = () => { /* 2026-10-17: 移除前端调试日志（前端统一用 ElMessage 提示） */ if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null } }
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'event') {
          const { event, payload } = msg
          if (event === 'iot.dashboard' || event === 'iot.reading' || event === 'iot.device.online' || event === 'iot.device.offline') {
            refreshAll()  // 刷新仪表板数据
          }
          if (event === 'iot.alarm') {
            ElMessage.warning('报警: ' + (payload.point_name || '未知') + ' = ' + payload.value)
            refreshAll()
          }
        }
      } catch (ex) { /* ignore malformed */ }
    }
    ws.onclose = () => { /* 2026-10-17: 移除前端调试日志（前端统一用 ElMessage 提示） */ wsReconnectTimer = setTimeout(connectWS, 5000) }
    ws.onerror = () => { ws?.close() }
  } catch (ex) {
    wsReconnectTimer = setTimeout(connectWS, 5000)
  }
}

onMounted(() => {
  refreshAll()
  connectWS()
})

onBeforeUnmount(() => {
  if (ws) { ws.close(); ws = null }
  if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null }
})
</script>

<style scoped>
.page { padding: 16px }
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px }
.page-title { font-size: 20px; font-weight: 700 }
.stat-card { background: var(--el-fill-color-light); border-radius: 8px; padding: 16px; text-align: center }
.stat-label { font-size: 12px; color: var(--el-color-info) }
.stat-value { font-size: 28px; font-weight: 700; margin: 4px 0 }
.stat-sub { font-size: 11px; color: var(--el-text-color-placeholder) }
.device-card { cursor: pointer; border-left: 3px solid var(--el-border-color) }
.device-card.online { border-left-color: var(--el-color-success) }
.device-card.offline { border-left-color: var(--el-text-color-placeholder) }
</style>
