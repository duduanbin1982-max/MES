<template>
  <div class="scan-page">
    <div class="scan-header">
      <h2 style="margin: 0 0 12px 0"><el-icon><Iphone /></el-icon> PDA 扫码报工</h2>
      <el-input
        aria-label="工单号 WO-xxx 或 工艺节点 PN-xxx" v-model="code"
        size="large"
        placeholder="工单号 WO-xxx 或 工艺节点 PN-xxx"
        @keyup.enter="lookup"
        clearable
      >
        <template #append>
          <el-button type="primary" size="large" @click="lookup" :loading="loading">
            <el-icon><Search /></el-icon>查询
          </el-button>
        </template>
      </el-input>
    </div>

    <el-alert
      v-if="scanSyncState.pending || scanSyncState.failed"
      :title="`待同步 ${scanSyncState.pending} 条${scanSyncState.failed ? '，失败 ' + scanSyncState.failed + ' 条' : ''}；联网后自动补传`"
      :type="scanSyncState.failed ? 'error' : 'warning'"
      :closable="false"
      show-icon
      class="sync-alert"
    >
      <template #default>
        <el-button size="small" :loading="scanSyncState.syncing" @click="syncScanQueue()">立即同步</el-button>
        <el-button v-if="scanSyncState.failed" size="small" @click="retryFailedScanActions()">重试失败</el-button>
      </template>
    </el-alert>

    <div class="camera-row">
      <el-button type="primary" plain @click="openCamera">摄像头扫码</el-button>
      <span class="camera-hint">PDA 扫码枪可直接输入；手机可用摄像头</span>
    </div>

    <!-- 类型提示 -->
    <div v-if="target" class="type-bar">
      <el-tag :type="target.type === 'work_order' ? 'primary' : 'success'" size="large">
        <template v-if="target.type === 'work_order'"><el-icon><Document /></el-icon> 工单</template><template v-else><el-icon><Tools /></el-icon> 工艺节点</template>
      </el-tag>
      <span style="margin-left: 12px; color: var(--el-text-color-regular)">{{ target.data?.wo_code || 'PN-' + target.data?.id }}</span>
    </div>

    <!-- 工单详情 -->
    <div v-if="target && target.type === 'work_order'" class="wo-card">
      <el-card shadow="never">
        <div class="wo-title">
          <div>
            <div style="font-size: 18px; font-weight: 600">{{ target.data.wo_code }}</div>
            <div style="color: var(--el-text-color-regular); font-size: 14px; margin-top: 4px">{{ target.data.title }}</div>
          </div>
          <el-tag :type="woTagType(target.data.status)" size="large">{{ target.data.status }}</el-tag>
        </div>

        <el-descriptions :column="1" border style="margin-top: 12px">
          <el-descriptions-item label="所属实例">{{ target.data.instance_code }} · {{ target.data.instance_name || '' }}</el-descriptions-item>
          <el-descriptions-item label="子系统">{{ target.data.subsystem_name || '-' }}</el-descriptions-item>
          <el-descriptions-item label="工位">{{ target.data.workstation_name || '-' }}</el-descriptions-item>
        </el-descriptions>

        <div class="timer-panel">
          <div>
            <div class="timer-label">现场计时</div>
            <div class="timer-value">{{ timerText }}</div>
          </div>
          <div class="timer-meta">
            <el-tag :type="timerStatus === 'running' ? 'success' : timerStatus === 'paused' ? 'warning' : timerStatus === 'stale' ? 'danger' : 'info'" size="small">
              {{ timerStatusLabel }}
            </el-tag>
            <div class="timer-start" v-if="wakeLock.active">屏幕常亮已开启</div>
            <div class="timer-start">开始：{{ target.data.actual_start || '-' }}</div>
            <div class="timer-start" v-if="target.data.actual_end">结束：{{ target.data.actual_end }}</div>
          </div>
        </div>

        <!-- 报工输入区 -->
        <el-card shadow="never" style="margin-top: 12px; background: var(--el-bg-color)">
          <template #header><span style="font-weight: 600"><el-icon><Edit /></el-icon> 报工信息</span></template>
          <el-form :model="reportForm" label-width="100px" size="default">
            <el-form-item label="操作员">
              <el-input :model-value="currentUserName" disabled />
            </el-form-item>
            <el-form-item label="补充工时(h)">
              <el-input-number v-model="reportForm.hours_worked" :min="0" :step="0.5" style="width: 100%" />
            </el-form-item>
            <el-form-item label="完成数量">
              <el-input-number v-model="reportForm.quantity_completed" :min="0" style="width: 100%" />
            </el-form-item>
            <el-form-item label="不良数量">
              <el-input-number v-model="reportForm.defect_quantity" :min="0" style="width: 100%" />
            </el-form-item>
            <el-form-item label="备注">
              <el-input v-model="reportForm.notes" type="textarea" :rows="2" placeholder="可选备注" />
            </el-form-item>
          </el-form>
        </el-card>

        <div class="action-grid">
          <el-button type="primary" size="large" :disabled="target.data.status === 'in_progress' || target.data.status === 'completed'" @click="doAction('start')">▶ 开始</el-button>
          <el-button type="warning" size="large" :disabled="target.data.status !== 'in_progress'" @click="doAction('pause')">⏸ 暂停</el-button>
          <el-button type="success" size="large" :disabled="target.data.status === 'completed'" @click="doAction('complete')"><el-icon><Select /></el-icon> 完成</el-button>
          <el-button type="danger" size="large" @click="showIssue = true"><el-icon><Warning /></el-icon> 异常</el-button>
        </div>
      </el-card>
    </div>

    <!-- 工艺节点详情 -->
    <div v-if="target && target.type === 'process_node'" class="wo-card">
      <el-card shadow="never">
        <div class="wo-title">
          <div>
            <div style="font-size: 18px; font-weight: 600">PN-{{ target.data.id }} · {{ target.data.operation_name }}</div>
            <div style="color: var(--el-text-color-regular); font-size: 14px; margin-top: 4px">{{ target.data.material_name || '(总装/上级工序)' }}</div>
          </div>
          <el-tag :type="pnTagType(target.data.status)" size="large">{{ target.data.status }}</el-tag>
        </div>

        <el-descriptions :column="1" border style="margin-top: 12px">
          <el-descriptions-item label="所属项目">{{ target.data.instance_code }}</el-descriptions-item>
          <el-descriptions-item label="工序类型">{{ target.data.operation_type }}</el-descriptions-item>
          <el-descriptions-item label="估时">{{ target.data.estimated_hours }} 小时</el-descriptions-item>
          <el-descriptions-item label="前置节点">{{ target.data.predecessors?.length || 0 }} 个</el-descriptions-item>
          <el-descriptions-item label="后继节点">{{ target.data.successors?.length || 0 }} 个</el-descriptions-item>
        </el-descriptions>

        <!-- 报工输入区 -->
        <el-card shadow="never" style="margin-top: 12px; background: var(--el-bg-color)">
          <template #header><span style="font-weight: 600"><el-icon><Edit /></el-icon> 报工信息</span></template>
          <el-form :model="reportForm" label-width="100px" size="default">
            <el-form-item label="操作员">
              <el-input :model-value="currentUserName" disabled />
            </el-form-item>
            <el-form-item label="工时">
              <el-input-number v-model="reportForm.hours_worked" :min="0" :step="0.5" style="width: 100%" />
            </el-form-item>
            <el-form-item label="完成数量">
              <el-input-number v-model="reportForm.quantity_completed" :min="0" style="width: 100%" />
            </el-form-item>
            <el-form-item label="不良数量">
              <el-input-number v-model="reportForm.defect_quantity" :min="0" style="width: 100%" />
            </el-form-item>
            <el-form-item label="备注">
              <el-input v-model="reportForm.notes" type="textarea" :rows="2" placeholder="可选备注" />
            </el-form-item>
          </el-form>
        </el-card>

        <div class="action-grid">
          <el-button type="primary" size="large" :disabled="target.data.status === 'in_progress' || target.data.status === 'completed'" @click="doAction('start')">▶ 开始</el-button>
          <el-button type="success" size="large" :disabled="target.data.status === 'completed'" @click="doAction('complete')"><el-icon><Select /></el-icon> 完成</el-button>
          <el-button type="danger" size="large" @click="doAction('block')"><el-icon><Warning /></el-icon> 卡住</el-button>
          <el-button type="warning" size="large" @click="showIssue = true"><el-icon><Edit /></el-icon> 备注</el-button>
        </div>
      </el-card>
    </div>

    <!-- 执行结果摘要 -->
    <div v-if="resultSummary" class="result-card">
      <el-card shadow="never">
        <div class="result-header" :style="{ color: resultSummary.color }">
          <span style="font-size: 20px">{{ resultSummary.icon }}</span>
          <span style="font-size: 18px; font-weight: 600; margin-left: 8px">{{ resultSummary.title }}</span>
        </div>
        <el-descriptions :column="2" border style="margin-top: 12px">
          <el-descriptions-item label="操作">{{ resultSummary.action }}</el-descriptions-item>
          <el-descriptions-item label="目标类型">{{ resultSummary.target_type }}</el-descriptions-item>
          <el-descriptions-item label="现场用时">{{ resultSummary.timer_text || (resultSummary.hours ? resultSummary.hours + ' h' : '-') }}</el-descriptions-item>
          <el-descriptions-item label="完成数量">{{ resultSummary.quantity ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="不良数量">{{ resultSummary.defects ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="备注">{{ resultSummary.notes || '-' }}</el-descriptions-item>
        </el-descriptions>
      </el-card>
    </div>

    <PageState state="empty" compact :show-action="false" v-else-if="!loading && searched" description="未找到该码" />

    <el-dialog v-model="cameraDlg.show" title="摄像头扫码" width="92%" max-width="480px" @closed="stopCamera">
      <video ref="videoRef" class="camera-video" playsinline muted></video>
      <div v-if="camera.error" class="camera-error">{{ camera.error }}</div>
      <div v-if="camera.scanning" class="camera-scanning">将二维码放入取景框…</div>
    </el-dialog>

    <el-dialog v-model="showIssue" :title="target?.type === 'work_order' ? '<el-icon><Warning /></el-icon> 上报异常' : '<el-icon><Edit /></el-icon> 添加备注'" width="90%" max-width="500px">
      <el-form :model="issueForm" label-width="80px">
        <el-form-item :label="target?.type === 'work_order' ? '问题描述' : '备注内容'" required>
          <el-input v-model="issueForm.notes" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item label="工时">
          <el-input-number v-model="issueForm.hours_worked" :min="0" :step="0.5" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showIssue = false">取消</el-button>
        <el-button :type="target?.type === 'work_order' ? 'danger' : 'primary'" @click="submitNote">提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'
import { useCameraScanner } from '../mobile/useCameraScanner'
import { useWakeLock } from '../mobile/useWakeLock'
import { enqueueScan, syncScanQueue, retryFailedScanActions, scanSyncState } from '../mobile/useScanSync'
import { getDeviceId, newScanActionId } from '../mobile/scanQueue'

const route = useRoute()
const code = ref('')
const target = ref<any>(null)
const loading = ref(false)
const searched = ref(false)
const showIssue = ref(false)
const issueForm = reactive({ notes: '', hours_worked: 0 })
const resultSummary = ref<any>(null)
const cameraDlg = reactive({ show: false })
const videoRef = ref<HTMLVideoElement>()
const wakeLock = useWakeLock()
const camera = useCameraScanner(videoRef, (value: string) => {
  code.value = value
  cameraDlg.show = false
  camera.stop()
  lookup()
})
const openCamera = async () => {
  cameraDlg.show = true
  await nextTick()
  await camera.start()
}
const stopCamera = () => { camera.stop() }

const reportForm = reactive({
  hours_worked: 0,
  quantity_completed: 0,
  defect_quantity: 0,
  notes: ''
})

const timerNow = ref(Date.now())
let timerHandle: any = null
const timerStatus = computed(() => target.value?.type === 'work_order' ? (target.value.data?.timer_status || 'stopped') : 'stopped')
const timerStatusLabel = computed(() => (({ running: '计时中', paused: '已暂停', stale: '超时未结束', stopped: '未计时' } as Record<string, string>)[timerStatus.value] || timerStatus.value))
const timerSeconds = computed(() => {
  if (target.value?.type !== 'work_order') return 0
  const base = Number(target.value.data?.actual_duration_seconds || 0)
  if (timerStatus.value !== 'running') return base
  const started = target.value.data?.timer_started_at
  if (!started) return base
  const startedMs = Date.parse(String(started).replace(' ', 'T') + 'Z')
  if (!Number.isFinite(startedMs)) return base
  return base + Math.max(0, Math.floor((timerNow.value - startedMs) / 1000))
})
const timerText = computed(() => {
  const total = Math.max(0, timerSeconds.value)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = total % 60
  return [h, m, sec].map((v) => String(v).padStart(2, '0')).join(':')
})

// current user - try to read from localStorage
const currentUser = computed(() => {
  try {
    const raw = localStorage.getItem('tbm_user')
    return raw ? JSON.parse(raw) : null
  } catch { return null }
})
const currentUserId = computed(() => currentUser.value?.id || currentUser.value?.user_id || 4)
const currentUserName = computed(() => currentUser.value?.display_name || currentUser.value?.username || '当前用户')

function formatSeconds(value: number) {
  const total = Math.max(0, Number(value || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = total % 60
  return [h, m, sec].map((v) => String(v).padStart(2, '0')).join(':')
}

const woTagType = (s: string) => ({ pending: 'info', in_progress: 'primary', paused: 'warning', completed: 'success', issue: 'danger', rework: 'danger' }[s] || 'info')
const pnTagType = (s: string) => ({ pending: 'info', ready: 'primary', in_progress: 'success', completed: 'success', blocked: 'danger', paused: 'warning' }[s] || 'info')

const lookup = async () => {
  if (!code.value.trim()) { ElMessage.warning('请输入码'); return }
  loading.value = true
  searched.value = true
  resultSummary.value = null
  try {
    const res: any = await api.get('/scan/lookup?code=' + encodeURIComponent(code.value.trim()))
    if (res.error) {
      target.value = null
      ElMessage.error(res.error)
    } else {
      target.value = res
      // 工艺节点额外获取 detail (含 predecessors/successors)
      if (res.type === 'process_node') {
        const detail: any = await api.get('/process_nodes/' + res.data.id)
        target.value.data = Object.assign({}, res.data, { predecessors: detail.predecessors, successors: detail.successors })
      }
    }
  } catch (e: any) {
    target.value = null
    ElMessage.error(e.response?.data?.error || '查询失败')
  } finally {
    loading.value = false
  }
}

const doAction = async (action: string) => {
  if (!target.value) return
  if (action === 'complete') {
    try { await ElMessageBox.confirm('确认' + (target.value.type === 'work_order' ? '工单' : '节点') + '已完成？', '完成确认', { type: 'success' }) } catch { return }
  }
  try {
    const payload: any = {
      code: code.value.trim(),
      action,
      operator_id: currentUserId.value,
      hours_worked: reportForm.hours_worked,
      quantity_completed: reportForm.quantity_completed,
      defect_quantity: reportForm.defect_quantity,
      notes: reportForm.notes
    }
    payload.occurred_at = new Date().toISOString()
    payload.client_now = new Date().toISOString()
    let res: any = null
    if (!navigator.onLine) {
      await enqueueScan(payload)
      ElMessage.warning('当前离线，操作已暂存，联网后自动补传')
      return
    }
    try {
      res = await api.post('/scan/execute', payload, { headers: { 'Idempotency-Key': newScanActionId(), 'X-Device-Id': getDeviceId() } })
      ElMessage.success(res.message)
    } catch (error: any) {
      const status = Number(error?.response?.status || 0)
      if (!status || status >= 500) {
        await enqueueScan(payload)
        ElMessage.warning('网络异常，操作已暂存，联网后自动补传')
        return
      }
      throw error
    }

    // Show result summary
    const colorMap: Record<string, string> = { complete: 'var(--el-color-success)', start: 'var(--el-color-primary)', pause: 'var(--el-color-warning)' }
    const iconMap: Record<string, string> = { complete: '<el-icon><CircleCheck /></el-icon>', start: '▶️', pause: '⏸️' }
    const actionLabelMap: Record<string, string> = { complete: '完成', start: '开始', pause: '暂停' }
    resultSummary.value = {
      title: res.message || '操作成功',
      icon: iconMap[action] || '<el-icon><Document /></el-icon>',
      color: colorMap[action] || 'var(--el-color-primary)',
      action: actionLabelMap[action] || action,
      target_type: target.value.type === 'work_order' ? '工单' : '工艺节点',
      hours: res.actual_duration_hours ?? reportForm.hours_worked,
      timer_text: res.actual_duration_seconds != null ? formatSeconds(res.actual_duration_seconds) : undefined,
      quantity: reportForm.quantity_completed,
      defects: reportForm.defect_quantity,
      notes: reportForm.notes
    }

    await lookup()  // 刷新
  } catch (e: any) {
    ElMessage.error(e.response?.data?.error || '操作失败')
  }
}

const submitNote = async () => {
  if (!issueForm.notes) { ElMessage.warning('请填写内容'); return }
  const payload = {
    code: code.value.trim(),
    action: 'note',
    operator_id: currentUserId.value,
    notes: issueForm.notes,
    hours_worked: issueForm.hours_worked,
    quantity_completed: reportForm.quantity_completed,
    defect_quantity: reportForm.defect_quantity,
    occurred_at: new Date().toISOString(),
    client_now: new Date().toISOString(),
  }
  try {
    if (!navigator.onLine) {
      await enqueueScan(payload)
      ElMessage.warning('当前离线，异常/备注已暂存，联网后自动补传')
    } else {
      try {
        await api.post('/scan/execute', payload, { headers: { 'Idempotency-Key': newScanActionId(), 'X-Device-Id': getDeviceId() } })
        ElMessage.success('已记录')
      } catch (error: any) {
        const status = Number(error?.response?.status || 0)
        if (!status || status >= 500) {
          await enqueueScan(payload)
          ElMessage.warning('网络异常，异常/备注已暂存，联网后自动补传')
        } else {
          throw error
        }
      }
    }
    showIssue.value = false
    issueForm.notes = ''; issueForm.hours_worked = 0
    if (navigator.onLine) await lookup()
  } catch (_e: any) { ElMessage.error('提交失败') }
}
watch(timerStatus, (status) => {
  if (status === 'running') wakeLock.request()
  else wakeLock.release()
}, { immediate: true })
onMounted(async () => {
  timerHandle = setInterval(() => { timerNow.value = Date.now() }, 1000)
  const preset = String(route.query.code || '').trim()
  if (preset) { code.value = preset; await lookup() }
})
onUnmounted(() => { if (timerHandle) clearInterval(timerHandle); wakeLock.release(); camera.stop() })
</script>

<style scoped>
.scan-page { padding: 12px; max-width: 600px; margin: 0 auto; }
.sync-alert { margin-bottom: 10px; }
.camera-row { display:flex; align-items:center; gap:10px; margin-bottom:10px; flex-wrap:wrap; }
.camera-hint { color: var(--el-text-color-secondary); font-size:12px; }
.camera-video { width:100%; max-height:60vh; background:#000; border-radius:8px; object-fit:cover; }
.camera-error { color:var(--el-color-danger); font-size:13px; margin-top:8px; }
.camera-scanning { color:var(--el-color-primary); font-size:13px; margin-top:8px; text-align:center; }
.scan-header { background: var(--el-color-white); padding: 16px; border-radius: 8px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
.type-bar { background: var(--el-color-white); padding: 12px 16px; border-radius: 8px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
.wo-card { margin-bottom: 12px; }
.wo-title { display: flex; justify-content: space-between; align-items: flex-start; }
.action-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 16px; }
.action-grid .el-button { height: 60px; font-size: 18px; font-weight: 500; }
.result-card { margin-bottom: 12px; }
.timer-panel{display:flex;justify-content:space-between;align-items:center;background:linear-gradient(135deg,var(--el-color-primary-light-9),var(--el-fill-color-light));border:1px solid var(--el-color-primary-light-7);border-radius:8px;padding:12px 16px;margin-top:12px}
.timer-label{font-size:12px;color:var(--el-text-color-secondary)}
.timer-value{font-size:30px;font-weight:700;color:var(--el-color-primary);font-variant-numeric:tabular-nums;line-height:1.2}
.timer-meta{text-align:right}
.timer-start{font-size:12px;color:var(--el-text-color-secondary);margin-top:4px}
.result-header { display: flex; align-items: center; }
@media (max-width: 480px) {
  .scan-page { padding: 8px; }
  .action-grid .el-button { height: 50px; font-size: 16px; }
}
</style>
