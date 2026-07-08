<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title">📊 报表中心</div>
    </div>

    <el-tabs v-model="tab">
      <!-- ========== Tab 1: 即时报表 ========== -->
      <el-tab-pane label="即时报表" name="instant">
        <el-card style="margin-bottom:12px">
          <div class="tb">
            <span style="font-weight:500;margin-right:8px">报表类型:</span>
            <el-radio-group v-model="instant.type" size="small">
              <el-radio-button label="daily_production">生产日报</el-radio-button>
              <el-radio-button label="quality_monthly">质量月报</el-radio-button>
              <el-radio-button label="oee_weekly">OEE周报</el-radio-button>
              <el-radio-button label="inventory_snapshot">库存快照</el-radio-button>
              <el-radio-button label="cost_summary">成本汇总</el-radio-button>
            </el-radio-group>
          </div>
          <div class="tb" style="margin-top:10px">
            <el-select v-model="instant.instance_id" placeholder="装备实例 (可选)" clearable style="width:240px">
              <el-option v-for="i in instances" :key="i.id" :label="i.instance_code + ' | ' + (i.instance_name||'')" :value="i.id" />
            </el-select>
            <el-date-picker v-model="instant.dateRange" type="daterange" range-separator="至" start-placeholder="开始" end-placeholder="结束" style="width:280px" />
            <el-button type="primary" @click="generateReport" :loading="genLoading">生成报表</el-button>
            <el-button type="success" @click="exportCSV" :disabled="!lastResult">导出CSV</el-button>
          </div>
        </el-card>

        <el-card v-if="lastResult" style="margin-top:12px">
          <template #header>
            <span>
              {{ reportTypeLabel(instant.type) }} · {{ lastResult.generated_at || '' }}
            </span>
          </template>
          <div v-if="lastResult.summary" style="margin-bottom:12px;display:flex;gap:16px;flex-wrap:wrap">
            <div v-for="(val,key) in lastResult.summary" :key="key" class="mini-stat">
              <span class="mini-stat-label">{{ key }}</span>
              <span class="mini-stat-value">{{ val }}</span>
            </div>
          </div>
          <el-table :data="lastResult.rows || []" stripe size="small" max-height="450">
            <el-table-column v-for="col in lastResult.columns" :key="col" :prop="col" :label="col" min-width="140" show-overflow-tooltip />
          </el-table>
        </el-card>
        <el-empty v-else description="选择报表类型并点击【生成报表】" :image-size="80" />
      </el-tab-pane>

      <!-- ========== Tab 2: 定时报表 ========== -->
      <el-tab-pane label="定时报表" name="scheduled">
        <div class="tb">
          <el-button type="primary" @click="openScheduledDialog()">+ 新建定时</el-button>
        </div>
        <el-table :data="scheduledList" stripe size="small" v-loading="schLoading" style="margin-top:10px">
          <el-table-column prop="report_name" label="报表名称" min-width="180" />
          <el-table-column prop="report_type" label="类型" width="140">
            <template #default="{row}">{{ reportTypeLabel(row.report_type) }}</template>
          </el-table-column>
          <el-table-column prop="schedule_cron" label="Cron表达式" width="160" />
          <el-table-column prop="recipients" label="接收人" width="200" show-overflow-tooltip />
          <el-table-column label="启用" width="80">
            <template #default="{row}">
              <el-switch v-model="row.is_active" size="small" @change="toggleScheduled(row)" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="220">
            <template #default="{row}">
              <el-button size="small" link @click="openScheduledDialog(row)">编辑</el-button>
              <el-button size="small" link type="warning" @click="runScheduled(row)">立即执行</el-button>
              <el-popconfirm title="确认删除?" @confirm="deleteScheduled(row)">
                <template #reference><el-button size="small" link type="danger">删除</el-button></template>
              </el-popconfirm>
            </template>
          </el-table-column>
        </el-table>

        <el-dialog v-model="schDlgVisible" :title="editingSch?.id ? '编辑定时报表' : '新建定时报表'" width="520px">
          <el-form :model="schForm" label-width="80px">
            <el-form-item label="报表名称">
              <el-input v-model="schForm.report_name" placeholder="如: 每日生产报表" />
            </el-form-item>
            <el-form-item label="报表类型">
              <el-select v-model="schForm.report_type" style="width:100%">
                <el-option label="生产日报" value="daily_production" />
                <el-option label="质量月报" value="quality_monthly" />
                <el-option label="OEE周报" value="oee_weekly" />
                <el-option label="库存快照" value="inventory_snapshot" />
                <el-option label="成本汇总" value="cost_summary" />
              </el-select>
            </el-form-item>
            <el-form-item label="Cron表达式">
              <el-input v-model="schForm.schedule_cron" placeholder="0 8 * * *" />
              <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
                <el-button size="small" @click="schForm.schedule_cron='0 8 * * *'">每日 8:00</el-button>
                <el-button size="small" @click="schForm.schedule_cron='0 8 * * 1'">每周一 8:00</el-button>
                <el-button size="small" @click="schForm.schedule_cron='0 8 1 * *'">每月1号 8:00</el-button>
              </div>
            </el-form-item>
            <el-form-item label="接收人">
              <el-input v-model="schForm.recipients" placeholder="邮箱,逗号分隔" />
            </el-form-item>
          </el-form>
          <template #footer>
            <el-button @click="schDlgVisible=false">取消</el-button>
            <el-button type="primary" @click="saveScheduled" :loading="schSaving">保存</el-button>
          </template>
        </el-dialog>
      </el-tab-pane>

      <!-- ========== Tab 3: 执行历史 ========== -->
      <el-tab-pane label="执行历史" name="history">
        <div class="tb">
          <el-select v-model="histFilter.report_name" placeholder="按报表筛选" clearable style="width:200px" @change="loadHistory">
            <el-option v-for="n in histReportNames" :key="n" :label="n" :value="n" />
          </el-select>
          <el-select v-model="histFilter.status" placeholder="按状态筛选" clearable style="width:140px" @change="loadHistory">
            <el-option label="成功" value="success" />
            <el-option label="失败" value="failed" />
            <el-option label="运行中" value="running" />
          </el-select>
        </div>
        <el-table :data="historyList" stripe size="small" v-loading="histLoading" style="margin-top:10px" @row-click="viewHistoryDetail" highlight-current-row>
          <el-table-column prop="report_name" label="报表名称" min-width="180" />
          <el-table-column prop="run_at" label="执行时间" width="170" />
          <el-table-column label="状态" width="100">
            <template #default="{row}">
              <el-tag :type="row.status==='success'?'success':row.status==='failed'?'danger':'warning'" size="small">{{ row.status }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="error_msg" label="错误信息" min-width="200" show-overflow-tooltip />
        </el-table>

        <el-dialog v-model="histDetailVisible" title="执行详情" width="700px">
          <div v-if="histDetail">
            <el-descriptions :column="2" border size="small">
              <el-descriptions-item label="报表">{{ histDetail.report_name }}</el-descriptions-item>
              <el-descriptions-item label="状态">
                <el-tag :type="histDetail.status==='success'?'success':'danger'" size="small">{{ histDetail.status }}</el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="执行时间">{{ histDetail.run_at }}</el-descriptions-item>
              <el-descriptions-item v-if="histDetail.error_msg" label="错误">{{ histDetail.error_msg }}</el-descriptions-item>
            </el-descriptions>
            <div v-if="histDetail.output_data" style="margin-top:12px">
              <strong>输出数据:</strong>
              <el-table v-if="histDetail.output_data.rows" :data="histDetail.output_data.rows" stripe size="small" max-height="350" style="margin-top:8px">
                <el-table-column v-for="col in (histDetail.output_data.columns||[])" :key="col" :prop="col" :label="col" min-width="120" show-overflow-tooltip />
              </el-table>
              <pre v-else style="max-height:300px;overflow:auto;background:#f5f7fa;padding:10px;border-radius:4px">{{ JSON.stringify(histDetail.output_data, null, 2) }}</pre>
            </div>
          </div>
        </el-dialog>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Api } from '../api'

const route = useRoute()
const router = useRouter()
const tabNames = new Set(['instant', 'scheduled', 'history'])
const routeTab = () => {
  const value = String(route.query.tab || '')
  return tabNames.has(value) ? value : 'instant'
}
const tab = ref(routeTab())
watch(tab, (value) => {
  if (route.query.tab !== value) router.replace({ query: { ...route.query, tab: value } })
})
watch(() => route.query.tab, () => {
  const next = routeTab()
  if (next !== tab.value) tab.value = next
})

const instances = ref<any[]>([])

const reportTypeLabel = (t: string) => ({
  daily_production: '生产日报', quality_monthly: '质量月报', oee_weekly: 'OEE周报',
  inventory_snapshot: '库存快照', cost_summary: '成本汇总'
}[t] || t)

// Tab 1: Instant Report
const instant = reactive({ type: 'daily_production', instance_id: null as any, dateRange: null as any })
const genLoading = ref(false)
const lastResult = ref<any>(null)

const generateReport = async () => {
  genLoading.value = true
  try {
    const params: any = { report_type: instant.type }
    if (instant.instance_id) params.equipment_instance_id = instant.instance_id
    if (instant.dateRange) {
      params.date_from = instant.dateRange[0]?.toISOString?.() || instant.dateRange[0]
      params.date_to = instant.dateRange[1]?.toISOString?.() || instant.dateRange[1]
    }
    lastResult.value = await Api.post('/reports/generate', params)
  } catch (e: any) {
    console.error('[Reports] generate failed:', e)
  } finally { genLoading.value = false }
}

const exportCSV = async () => {
  if (!lastResult.value) return
  try {
    const res = await Api.post('/reports/export', {
      report_type: instant.type,
      data: lastResult.value
    }, { responseType: 'blob' })
    const blob = res instanceof Blob ? res : new Blob([res])
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'report_' + instant.type + '_' + new Date().toISOString().slice(0,10) + '.csv'
    a.click()
    URL.revokeObjectURL(url)
  } catch (e: any) {
    console.error('[Reports] export failed:', e)
  }
}

// Tab 2: Scheduled Reports
const scheduledList = ref<any[]>([])
const schLoading = ref(false)
const schSaving = ref(false)
const schDlgVisible = ref(false)
const editingSch = ref<any>(null)
const schForm = reactive({ report_name: '', report_type: 'daily_production', schedule_cron: '0 8 * * *', recipients: '' })

const loadScheduled = async () => {
  schLoading.value = true
  try { scheduledList.value = await Api.get('/reports/scheduled') }
  catch { scheduledList.value = [] }
  finally { schLoading.value = false }
}

const openScheduledDialog = (row?: any) => {
  editingSch.value = row || null
  if (row) {
    schForm.report_name = row.report_name
    schForm.report_type = row.report_type
    schForm.schedule_cron = row.schedule_cron
    schForm.recipients = row.recipients || ''
  } else {
    schForm.report_name = ''
    schForm.report_type = 'daily_production'
    schForm.schedule_cron = '0 8 * * *'
    schForm.recipients = ''
  }
  schDlgVisible.value = true
}

const saveScheduled = async () => {
  schSaving.value = true
  try {
    const data = { ...schForm, is_active: editingSch.value?.is_active ?? true }
    if (editingSch.value?.id) {
      await Api.put('/reports/scheduled/' + editingSch.value.id, data)
    } else {
      await Api.post('/reports/scheduled', data)
    }
    schDlgVisible.value = false
    loadScheduled()
  } catch (e: any) { console.error('[Reports] save scheduled failed:', e) }
  finally { schSaving.value = false }
}

const toggleScheduled = async (row: any) => {
  try {
    await Api.patch('/reports/scheduled/' + row.id, { is_active: row.is_active })
  } catch { row.is_active = !row.is_active }
}

const deleteScheduled = async (row: any) => {
  try {
    await Api.del('/reports/scheduled/' + row.id)
    loadScheduled()
  } catch {}
}

const runScheduled = async (row: any) => {
  try { await Api.post('/reports/scheduled/' + row.id + '/run-now') }
  catch {}
}

// Tab 3: History
const historyList = ref<any[]>([])
const histLoading = ref(false)
const histFilter = reactive({ report_name: '', status: '' })
const histReportNames = ref<string[]>([])
const histDetailVisible = ref(false)
const histDetail = ref<any>(null)

const loadHistory = async () => {
  histLoading.value = true
  try {
    const params: any = {}
    if (histFilter.report_name) params.report_name = histFilter.report_name
    if (histFilter.status) params.status = histFilter.status
    historyList.value = await Api.get('/reports/history', { params })
    histReportNames.value = [...new Set(historyList.value.map((r: any) => r.report_name))]
  } catch { historyList.value = [] }
  finally { histLoading.value = false }
}

const viewHistoryDetail = async (row: any) => {
  histDetail.value = row
  histDetailVisible.value = true
}

onMounted(async () => {
  try { instances.value = await Api.instances() } catch {}
  loadScheduled()
  loadHistory()
})
</script>

<style scoped>
.page{padding:16px 24px}
.page-header{margin-bottom:16px}
.page-title{font-size:20px;font-weight:600}
.tb{display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap}
.mini-stat{background:#f5f7fa;border-radius:6px;padding:8px 14px;text-align:center;min-width:80px}
.mini-stat-label{display:block;font-size:12px;color:#909399}
.mini-stat-value{display:block;font-size:18px;font-weight:600;color:#303133;margin-top:2px}
</style>
