<template>
  <div class="mobile-center">
    <PageToolbar class="page-header">
      <div class="page-title">移动端设置</div>
      <el-button @click="loadDevices">刷新</el-button>
    </PageToolbar>

    <el-alert type="info" :closable="false" show-icon style="margin-bottom: 12px">
      当前页面用于设备绑定、通知与离线补传状态；现场扫码入口为“扫码报工”。
    </el-alert>

    <el-card shadow="never" style="margin-bottom: 12px">
      <template #header><b>设备绑定</b></template>
      <el-descriptions :column="1" border size="small">
        <el-descriptions-item label="本机设备 ID"><code>{{ deviceId }}</code></el-descriptions-item>
        <el-descriptions-item label="平台">{{ platform }}</el-descriptions-item>
        <el-descriptions-item label="绑定账号">{{ auth.user?.full_name || auth.user?.username || '-' }}</el-descriptions-item>
      </el-descriptions>
      <div class="bind-row">
        <el-input v-model="deviceName" placeholder="设备名称，如：装配一班 PDA-01" style="max-width: 320px" />
        <el-button type="primary" :loading="binding" @click="bindDevice">绑定本机</el-button>
      </div>
      <el-table :data="devices" size="small" stripe style="margin-top: 12px">
        <el-table-column prop="device_name" label="设备" />
        <el-table-column prop="device_id" label="设备 ID" show-overflow-tooltip />
        <el-table-column prop="full_name" label="绑定人" width="100" />
        <el-table-column prop="last_seen_at" label="最后在线" width="160" />
        <el-table-column label="操作" width="90">
          <template #default="{ row }"><el-button size="small" type="danger" link @click="unbind(row)">解绑</el-button></template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never" style="margin-bottom: 12px">
      <template #header><b>通知与消息中心</b></template>
      <div class="notify-row">
        <el-tag :type="permission === 'granted' ? 'success' : permission === 'denied' ? 'danger' : 'info'">通知权限：{{ permissionLabel }}</el-tag>
        <el-button v-if="permission !== 'granted'" size="small" @click="enableNotification">开启通知</el-button>
        <el-button size="small" @click="testNotification">发送测试通知</el-button>
        <el-button size="small" @click="clearMessages">清空消息</el-button>
      </div>
      <div v-if="!messages.length" class="empty">暂无消息；离线补传成功/失败会记录在这里。</div>
      <div v-for="message in messages" :key="message.id" class="message-item">
        <el-tag size="small" :type="message.type === 'failed' ? 'danger' : message.type === 'sync' ? 'success' : 'info'">{{ message.type }}</el-tag>
        <div>
          <div class="message-title">{{ message.title }}</div>
          <div class="message-body">{{ message.body }}</div>
          <div class="message-time">{{ new Date(message.at).toLocaleString() }}</div>
        </div>
      </div>
    </el-card>

    <el-card shadow="never" style="margin-bottom: 12px">
      <template #header><b>离线补传</b></template>
      <div class="notify-row">
        <span>待同步 <b>{{ scanSyncState.pending }}</b> 条</span>
        <span>失败 <b>{{ scanSyncState.failed }}</b> 条</span>
        <el-button size="small" :loading="scanSyncState.syncing" @click="syncScanQueue()">立即同步</el-button>
        <el-button size="small" @click="retryFailedScanActions()">重试失败</el-button>
      </div>
      <div class="hint">扫码动作会先写入本机 IndexedDB；联网后按时间顺序补传，服务端按 Idempotency-Key 去重。</div>
    </el-card>

    <el-card shadow="never" style="margin-bottom: 12px">
      <template #header><b>账号与数据范围</b></template>
      <el-descriptions :column="1" border size="small">
        <el-descriptions-item label="角色">{{ auth.user?.role || '-' }}</el-descriptions-item>
        <el-descriptions-item label="权限数">{{ permissionCount }}</el-descriptions-item>
        <el-descriptions-item label="数据范围">由服务端 dataScope 按角色/组织限制，前端不能绕过后端校验。</el-descriptions-item>
      </el-descriptions>
    </el-card>

    <el-card shadow="never" style="margin-bottom: 12px">
      <template #header><b>安装到主屏幕</b></template>
      <div class="notify-row">
        <el-button type="primary" :disabled="!installAvailable" @click="installPwa">安装 TBM-MES</el-button>
        <span class="hint">{{ installAvailable ? '浏览器已允许安装，点击即可添加到主屏幕。' : '若按钮不可用，请用浏览器菜单“添加到主屏幕”；需 HTTPS 与 Service Worker。' }}</span>
      </div>
    </el-card>

    <el-card shadow="never">
      <template #header><b>生物识别登录</b></template>
      <div class="hint">
        当前浏览器 {{ webAuthnSupported ? '支持 WebAuthn' : '不支持 WebAuthn' }}；服务端凭据注册/挑战接口尚未接入，生物识别登录暂未启用。
        当前版本请使用账号密码登录，并依赖设备绑定记录做设备审计。
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Api } from '../api'
import { useAuthStore } from '../stores/auth'
import { getDeviceId } from '../mobile/scanQueue'
import { scanSyncState, syncScanQueue, retryFailedScanActions } from '../mobile/useScanSync'
import {
  clearMobileMessages, listMobileMessages, notificationPermission,
  requestNotificationPermission, showMobileNotification, type MobileMessage,
} from '../mobile/notifications'

const auth = useAuthStore()
const deviceId = getDeviceId()
const platform = `${navigator.platform || ''} · ${navigator.userAgent.includes('Mobile') ? '移动浏览器' : '浏览器'}`.trim()
const deviceName = ref('')
const devices = ref<any[]>([])
const binding = ref(false)
const permission = ref(notificationPermission())
const messages = ref<MobileMessage[]>(listMobileMessages())
const webAuthnSupported = typeof window !== 'undefined' && 'PublicKeyCredential' in window
const installAvailable = ref(false)
let installPrompt: any = null
const permissionCount = computed(() => {
  const perms = auth.user?.permissions
  return Array.isArray(perms) ? perms.length : 0
})
const permissionLabel = computed(() => ({ granted: '已允许', denied: '已拒绝', default: '未开启', unsupported: '浏览器不支持' } as Record<string, string>)[permission.value] || permission.value)

const refreshMessages = () => { messages.value = listMobileMessages(); permission.value = notificationPermission() }

async function loadDevices() {
  try { devices.value = await Api.get('/mobile/devices') } catch { devices.value = [] }
}
async function bindDevice() {
  binding.value = true
  try {
    await Api.post('/mobile/devices/bind', { device_id: deviceId, device_name: deviceName.value || '移动设备', platform })
    ElMessage.success('本机已绑定')
    await loadDevices()
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.error || error?.message || '绑定失败')
  } finally { binding.value = false }
}
async function unbind(row: any) {
  try {
    await Api.delete(`/mobile/devices/${row.id}`)
    ElMessage.success('已解绑')
    await loadDevices()
  } catch (error: any) { ElMessage.error(error?.response?.data?.error || '解绑失败') }
}
async function enableNotification() {
  permission.value = await requestNotificationPermission()
  if (permission.value === 'granted') ElMessage.success('通知已开启')
  else if (permission.value === 'denied') ElMessage.warning('通知被拒绝，可在浏览器站点设置中修改')
  else if (permission.value === 'unsupported') ElMessage.warning('当前浏览器不支持通知')
}
async function testNotification() {
  await showMobileNotification('TBM-MES 测试通知', '移动端通知通道正常')
  ElMessage.success('已发送测试通知')
}
function clearMessages() { clearMobileMessages(); refreshMessages() }
function refreshInstall() { installPrompt = (window as any).__tbmInstallPrompt || null; installAvailable.value = !!installPrompt }
async function installPwa() {
  if (!installPrompt) return
  await installPrompt.prompt()
  installPrompt = null
  installAvailable.value = false
}

onMounted(() => {
  loadDevices()
  refreshMessages()
  window.addEventListener('mobile-messages-changed', refreshMessages)
  window.addEventListener('tbm-install-available', refreshInstall)
  refreshInstall()
})
onUnmounted(() => {
  window.removeEventListener('mobile-messages-changed', refreshMessages)
  window.removeEventListener('tbm-install-available', refreshInstall)
})
</script>

<style scoped>
.mobile-center { padding: 16px; max-width: 900px; margin: 0 auto; }
.bind-row, .notify-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 10px; }
.hint { color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.6; }
.empty { color: var(--el-text-color-secondary); font-size: 13px; padding: 12px 0; }
.message-item { display: flex; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--el-border-color-lighter); }
.message-title { font-weight: 600; font-size: 14px; }
.message-body { font-size: 13px; color: var(--el-text-color-regular); margin-top: 2px; }
.message-time { font-size: 12px; color: var(--el-text-color-secondary); margin-top: 2px; }
</style>
