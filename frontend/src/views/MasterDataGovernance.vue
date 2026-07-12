<template>
  <div class="page">
    <div class="page-header">
      <div>
        <div class="page-title">主数据治理</div>
        <div class="page-subtitle">物料、BOM、图纸、供应商、工序工位、人员资质的数据质量检查</div>
      </div>
      <el-button :icon="Refresh" size="small" :loading="loading" @click="loadAll">刷新</el-button>
    </div>

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
              <span>问题清单</span>
              <div class="filters">
                <el-select v-model="filters.domain" clearable size="small" placeholder="治理域" style="width: 150px" @change="loadAll">
                  <el-option v-for="d in domains" :key="d.domain" :label="d.label" :value="d.domain" />
                </el-select>
                <el-segmented v-model="filters.severity" :options="severityOptions" size="small" @change="loadAll" />
              </div>
            </div>
          </template>
          <el-table :data="issues" size="small" height="560">
            <el-table-column label="级别" width="80"><template #default="{ row }"><el-tag :type="severityTag(row.severity)" size="small">{{ severityLabel(row.severity) }}</el-tag></template></el-table-column>
            <el-table-column prop="title" label="问题" min-width="180" show-overflow-tooltip />
            <el-table-column prop="detail" label="说明" min-width="260" show-overflow-tooltip />
            <el-table-column label="对象" width="100"><template #default="{ row }">{{ domainLabel(row.domain) }}</template></el-table-column>
            <el-table-column prop="source" label="来源表" width="120" />
            <el-table-column label="操作" width="90" fixed="right"><template #default="{ row }"><el-button link size="small" @click="go(row.source_path)">处理</el-button></template></el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Refresh } from '@element-plus/icons-vue'
import { Api } from '../api'

const router = useRouter()
const loading = ref(false)
const summary = reactive<any>({ by_severity: {} })
const domains = ref<any[]>([])
const issues = ref<any[]>([])
const filters = reactive({ domain: '', severity: 'all' })
const severityOptions = [{ label: '全部', value: 'all' }, { label: '严重', value: 'critical' }, { label: '高', value: 'high' }, { label: '预警', value: 'warning' }]
const domainMap = computed(() => Object.fromEntries(domains.value.map((d) => [d.domain, d.label])))

function scoreColor(score: number) { return score >= 85 ? 'var(--el-color-success)' : score >= 65 ? 'var(--el-color-warning)' : 'var(--el-color-danger)' }
function severityTag(severity: string) { return severity === 'critical' || severity === 'high' ? 'danger' : severity === 'warning' ? 'warning' : 'info' }
function severityLabel(severity: string) { return ({ critical: '严重', high: '高', warning: '中', info: '低' } as any)[severity] || severity }
function domainLabel(domain: string) { return domainMap.value[domain] || domain }
function go(path?: string) { if (path) router.push(path) }
function selectDomain(row: any) { filters.domain = row.domain; loadAll() }

async function loadAll() {
  loading.value = true
  try {
    const params: any = {}
    if (filters.domain) params.domain = filters.domain
    if (filters.severity !== 'all') params.severity = filters.severity
    const data: any = await Api.mdmIssues(params)
    Object.assign(summary, data.summary || {})
    const overview: any = await Api.mdmOverview()
    domains.value = overview.domains || []
    issues.value = data.issues || []
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
</style>
