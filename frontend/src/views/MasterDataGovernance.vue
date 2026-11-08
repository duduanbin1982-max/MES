<template>
  <div class="page">
    <PageToolbar class="page-header">
      <div>
        <div class="page-title">主数据治理</div>
        <div class="page-subtitle">物料、BOM、图纸、供应商、工序工位、人员资质的数据质量检查</div>
      </div>
      <el-button :icon="Refresh" size="small" :loading="loading" @click="loadAll">刷新</el-button>
    </PageToolbar>

    <el-alert v-if="summary.scan_errors?.length" type="warning" :closable="false" show-icon class="scan-alert"
      :title="`有 ${summary.scan_errors.length} 条规则扫描失败，结果可能不完整`">
      <span class="hint">{{ summary.scan_errors[0]?.message }}</span>
    </el-alert>

    <el-row :gutter="16" class="kpi-row">
      <el-col :span="6"><el-card class="kpi-card"><div class="stat-label">治理评分</div><div class="stat-value">{{ summary.avg_score || 0 }}</div><div class="stat-sub">平均质量分</div></el-card></el-col>
      <el-col :span="6"><el-card class="kpi-card"><div class="stat-label">检查域</div><div class="stat-value">{{ summary.domains || 0 }}</div><div class="stat-sub">编码/层级/版本/资质</div></el-card></el-col>
      <el-col :span="6"><el-card class="kpi-card"><div class="stat-label">问题数</div><div class="stat-value warning">{{ summary.issue_count || 0 }}</div><div class="stat-sub">需治理项</div></el-card></el-col>
      <el-col :span="6"><el-card class="kpi-card"><div class="stat-label">严重问题</div><div class="stat-value danger">{{ summary.by_severity?.critical || 0 }}</div><div class="stat-sub">会影响业务闭环</div></el-card></el-col>
    </el-row>

    <el-row :gutter="16">
      <el-col :span="8">
        <el-card>
          <template #header><div class="card-header"><span>治理域</span><el-tag size="small">6 类规则</el-tag></div></template>
          <el-table :data="domains" size="small" height="560" @row-click="selectDomain">
            <el-table-column prop="label" label="对象" min-width="100" />
            <el-table-column prop="total" label="记录" width="70" />
            <el-table-column prop="issues" label="问题" width="70" />
            <el-table-column label="评分" width="120">
              <template #default="{ row }">
                <el-progress :percentage="row.score" :stroke-width="7" :color="scoreColor(row.score)" />
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>

      <el-col :span="16">
        <el-card>
          <template #header>
            <div class="toolbar">
              <span>问题清单 <el-tag v-if="issuesTotal" size="small" type="info">{{ issuesTotal }} 项<template v-if="truncated">（仅显示前 {{ issues.length }} 项）</template></el-tag></span>
              <div class="filters">
                <el-select v-model="filters.domain" clearable size="small" placeholder="治理域" style="width: 150px" @change="loadAll">
                  <el-option v-for="d in domains" :key="d.domain" :label="d.label" :value="d.domain" />
                </el-select>
                <el-segmented v-model="filters.severity" :options="severityOptions" size="small" @change="loadAll" />
                <el-button v-if="canManage" size="small" @click="openWaivers">已忽略问题</el-button>
              </div>
            </div>
          </template>
          <el-table :data="issues" size="small" height="560">
            <el-table-column label="级别" width="80"><template #default="{ row }"><el-tag :type="severityTag(row.severity)" size="small">{{ severityLabel(row.severity) }}</el-tag></template></el-table-column>
            <el-table-column prop="title" label="问题" min-width="180" show-overflow-tooltip />
            <el-table-column prop="detail" label="说明" min-width="260" show-overflow-tooltip />
            <el-table-column label="对象" width="100"><template #default="{ row }">{{ domainLabel(row.domain) }}</template></el-table-column>
            <el-table-column prop="source" label="来源表" width="120" />
            <el-table-column label="操作" width="150" fixed="right">
              <template #default="{ row }">
                <el-button link size="small" @click="go(row.source_path)">处理</el-button>
                <el-button v-if="canManage" link size="small" type="warning" @click="waive(row)">忽略</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>
    <el-dialog v-model="waiverDlg.show" title="已忽略的主数据问题" width="760px">
      <el-table :data="waiverDlg.rows" size="small" max-height="420">
        <el-table-column prop="issue_id" label="问题 ID" min-width="220" show-overflow-tooltip />
        <el-table-column prop="reason" label="原因" min-width="150" show-overflow-tooltip />
        <el-table-column prop="created_at" label="忽略时间" width="160" />
        <el-table-column label="操作" width="80"><template #default="{ row }"><el-button link size="small" type="primary" @click="reopen(row)">恢复</el-button></template></el-table-column>
      </el-table>
      <template #footer><el-button @click="waiverDlg.show = false">关闭</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAuthStore } from '../stores/auth'
import { Refresh } from '@element-plus/icons-vue'
import { Api } from '../api'

const router = useRouter()
const auth = useAuthStore()
const canManage = auth.hasPerm('settings:write')
const loading = ref(false)
const summary = reactive<any>({ by_severity: {} })
const domains = ref<any[]>([])
const issues = ref<any[]>([])
const issuesTotal = ref(0)
const truncated = ref(false)
const waiverDlg = reactive<{ show: boolean; rows: any[] }>({ show: false, rows: [] })
const filters = reactive({ domain: '', severity: 'all' })
const severityOptions = [{ label: '全部', value: 'all' }, { label: '严重', value: 'critical' }, { label: '高', value: 'high' }, { label: '预警', value: 'warning' }]
const domainMap = computed(() => Object.fromEntries(domains.value.map((d) => [d.domain, d.label])))

function scoreColor(score: number) { return score >= 85 ? 'var(--el-color-success)' : score >= 65 ? 'var(--el-color-warning)' : 'var(--el-color-danger)' }
function severityTag(severity: string) { return severity === 'critical' || severity === 'high' ? 'danger' : severity === 'warning' ? 'warning' : 'info' }
function severityLabel(severity: string) { return ({ critical: '严重', high: '高', warning: '中', info: '低' } as any)[severity] || severity }
function domainLabel(domain: string) { return domainMap.value[domain] || domain }
function go(path?: string) { if (path) router.push(path) }

async function waive(row: any) {
  try {
    const { value } = await ElMessageBox.prompt('请填写忽略原因（会写入审计日志）', '忽略问题：' + row.title, { inputValue: '业务确认可接受', confirmButtonText: '忽略', cancelButtonText: '取消' })
    await Api.mdmWaive(row.id, value || '业务确认可接受')
    ElMessage.success('已忽略，问题已从清单移除')
    await loadAll()
  } catch (error: any) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error('忽略失败：' + (error?.response?.data?.message || error.message))
  }
}

async function openWaivers() {
  try {
    const data: any = await Api.mdmWaivers({ active: 1 })
    waiverDlg.rows = data.waivers || []
    waiverDlg.show = true
  } catch (error: any) {
    ElMessage.error('加载已忽略问题失败：' + (error?.response?.data?.message || error.message))
  }
}

async function reopen(row: any) {
  try {
    await Api.mdmReopen(row.issue_id)
    ElMessage.success('已恢复，重新进入问题清单')
    waiverDlg.show = false
    await loadAll()
  } catch (error: any) {
    ElMessage.error('恢复失败：' + (error?.response?.data?.message || error.message))
  }
}
function selectDomain(row: any) { filters.domain = row.domain; loadAll() }

async function loadAll() {
  loading.value = true
  try {
    const params: any = {}
    if (filters.domain) params.domain = filters.domain
    if (filters.severity !== 'all') params.severity = filters.severity
    const [data, overview]: any[] = await Promise.all([
      Api.mdmIssues(params),
      Api.mdmOverview({ include_issues: '0' }),
    ])
    Object.assign(summary, data.summary || {})
    domains.value = overview.domains || []
    issues.value = data.issues || []
    issuesTotal.value = Number(data.total ?? issues.value.length)
    truncated.value = Boolean(data.truncated)
  } catch (error: any) {
    ElMessage.error('加载主数据治理失败：' + (error?.response?.data?.message || error.message))
  } finally {
    loading.value = false
  }
}

onMounted(loadAll)
</script>

<style scoped>
.page-subtitle { color: var(--el-text-color-secondary); font-size: 13px; margin-top: 4px; }
.kpi-row { margin-bottom: 16px; }
.kpi-card { min-height: 104px; }
.stat-label { color: var(--el-text-color-secondary); font-size: 13px; }
.stat-value { font-size: 30px; font-weight: 700; margin-top: 10px; }
.stat-value.warning { color: var(--el-color-warning); }
.stat-value.danger { color: var(--el-color-danger); }
.stat-sub { color: var(--el-text-color-secondary); font-size: 12px; margin-top: 6px; }
.card-header, .toolbar, .filters { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.filters { justify-content: flex-end; }
.scan-alert { margin-bottom: 12px; }
.hint { font-size: 12px; }
</style>
