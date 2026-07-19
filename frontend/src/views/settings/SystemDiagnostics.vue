<template>
  <div class="diagnostics-panel">
    <DiagnosticsToolbar
      :loading="loading"
      :action-loading="actionLoading"
      @refresh="loadAll"
      @probe-feishu="probeFeishu"
      @scan-andon="scanAndon"
    />

    <DiagnosticsKpis
      :loading="loading"
      :health="health"
      :db-stats="dbStats"
      :project-status="projectStatus"
      :project-status-text="projectStatusText"
      :andon-diag="andonDiag"
    />

    <NotificationDiagnostics
      :action-loading="actionLoading"
      :feishu-diag="feishuDiag"
      :andon-diag="andonDiag"
      :probe-result="probeResult"
      @send-feishu-test="sendFeishuTest"
    />

    <RawDiagnostics
      :health="health"
      :db-stats="dbStats"
      :project-status="projectStatus"
      :settings-all="settingsAll"
    />

    <LegacyApiCoverage
      :field-service-count="legacyFieldServiceCount"
      :maintenance-count="legacyMaintenanceCount"
      :spare-alert-count="legacySpareAlertCount"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import Api from '../../api'
import DiagnosticsKpis from './diagnostics/DiagnosticsKpis.vue'
import DiagnosticsToolbar from './diagnostics/DiagnosticsToolbar.vue'
import LegacyApiCoverage from './diagnostics/LegacyApiCoverage.vue'
import NotificationDiagnostics from './diagnostics/NotificationDiagnostics.vue'
import RawDiagnostics from './diagnostics/RawDiagnostics.vue'

const loading = ref(false)
const actionLoading = ref('')
const health = ref<any>(null)
const dbStats = ref<any>(null)
const projectStatus = ref<any>(null)
const settingsAll = ref<any>(null)
const feishuDiag = ref<any>(null)
const andonDiag = ref<any>(null)
const probeResult = ref<any>(null)
const legacyFieldService = ref<any>(null)
const legacyMaintenance = ref<any>(null)
const legacySpareAlerts = ref<any>(null)

const projectStatusText = computed(() => {
  if (!projectStatus.value) return '未加载'
  if (projectStatus.value.ok === false) return projectStatus.value.error || '项目主数据异常'
  return projectStatus.value.message || projectStatus.value.status || '项目主数据可用'
})

const legacyFieldServiceCount = computed(() =>
  Array.isArray(legacyFieldService.value) ? legacyFieldService.value.length : Number(legacyFieldService.value?.count || legacyFieldService.value?.items?.length || 0),
)
const legacyMaintenanceCount = computed(() =>
  Number(legacyMaintenance.value?.total || legacyMaintenance.value?.count || legacyMaintenance.value?.items?.length || 0),
)
const legacySpareAlertCount = computed(() =>
  Number(legacySpareAlerts.value?.total || legacySpareAlerts.value?.count || legacySpareAlerts.value?.items?.length || 0),
)

async function quietCall(fn: () => Promise<any>) {
  try {
    return await fn()
  } catch (error: any) {
    return { ok: false, error: error?.response?.data?.error || error?.message || '请求失败' }
  }
}

async function loadAll() {
  loading.value = true
  try {
    const [
      healthResult,
      dbResult,
      projectResult,
      settingsResult,
      feishuResult,
      andonResult,
      legacyFieldResult,
      legacyMaintenanceResult,
      legacySpareResult,
    ] = await Promise.all([
      quietCall(() => Api.get('/health')),
      quietCall(() => Api.get('/debug/db-stats')),
      quietCall(() => Api.get('/project-master/status')),
      quietCall(() => Api.get('/settings-all')),
      quietCall(() => Api.get('/admin/diag/feishu')),
      quietCall(() => Api.get('/admin/diag/andon')),
      quietCall(() => Api.get('/field_service')),
      quietCall(() => Api.get('/maintenance_plans/stats')),
      quietCall(() => Api.get('/spare_parts/alerts')),
    ])
    health.value = healthResult
    dbStats.value = dbResult
    projectStatus.value = projectResult
    settingsAll.value = settingsResult
    feishuDiag.value = feishuResult
    andonDiag.value = andonResult
    legacyFieldService.value = legacyFieldResult
    legacyMaintenance.value = legacyMaintenanceResult
    legacySpareAlerts.value = legacySpareResult
  } finally {
    loading.value = false
  }
}

async function probeFeishu() {
  actionLoading.value = 'probe'
  try {
    probeResult.value = await Api.post('/admin/diag/feishu/probe', {})
    ElMessage.success(probeResult.value?.next_step || '飞书探测完成')
  } finally {
    actionLoading.value = ''
  }
}

async function sendFeishuTest() {
  actionLoading.value = 'feishu'
  try {
    const result = await Api.post('/admin/diag/feishu/test', {
      title: 'TBM-MES 运维诊断测试',
      content: '来自系统设置 / 运维诊断页的飞书链路测试。',
    })
    ElMessage.success(result?.next_step || '飞书测试已触发')
    await loadAll()
  } finally {
    actionLoading.value = ''
  }
}

async function scanAndon() {
  actionLoading.value = 'andon'
  try {
    const result = await Api.post('/admin/diag/andon/scan', {})
    ElMessage.success(result?.message || 'ANDON 扫描已触发')
    await loadAll()
  } finally {
    actionLoading.value = ''
  }
}

onMounted(loadAll)
</script>

<style scoped>
.diagnostics-panel {
  display: grid;
  gap: 14px;
}
</style>
