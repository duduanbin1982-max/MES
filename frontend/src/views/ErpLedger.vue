<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title"><el-icon><Money /></el-icon> ERP 成本台账</div>
      <div style="display:flex;gap:8px">
        <el-button type="success" @click="doRollup" :loading="rolling">成本归集</el-button>
        <el-button @click="exportLedger" :loading="exporting">导出台账</el-button>
        <el-button @click="refresh" :loading="loading">刷新</el-button>
      </div>
    </div>

    <el-tabs v-model="activeTab">
      <!-- Tab: 成本台账 -->
      <el-tab-pane name="ledger">
        <template #label><span class="tab-label"><el-icon><Notebook /></el-icon>成本台账</span></template>
        <el-form :inline="true" size="small" style="margin-bottom:8px">
          <el-form-item label="实例"><el-select v-model="filterInstance" clearable style="width:180px" @change="loadLedger"><el-option v-for="i in instances" :key="i.id" :label="i.instance_code" :value="i.id"/></el-select></el-form-item>
          <el-form-item label="状态"><el-select v-model="filterStatus" clearable style="width:120px" @change="loadLedger"><el-option label="待导出" value="pending"/><el-option label="已导出" value="exported"/></el-select></el-form-item>
        </el-form>
        <el-table :data="ledger" stripe size="small" empty-text="无台账记录" max-height="400">
          <el-table-column prop="entry_no" label="分录号" width="110" />
          <el-table-column prop="entry_date" label="日期" width="100" />
          <el-table-column prop="gl_account_code" label="科目" width="80" />
          <el-table-column prop="description" label="摘要" min-width="250" />
          <el-table-column label="借方" width="120"><template #default="{row}"><span style="color:var(--el-color-danger)">{{ row.debit_amount?.toFixed(2) }}</span></template></el-table-column>
          <el-table-column label="贷方" width="120"><template #default="{row}"><span style="color:var(--el-color-success)">{{ row.credit_amount?.toFixed(2) }}</span></template></el-table-column>
          <el-table-column prop="source_type" label="来源" width="110" />
          <el-table-column label="状态" width="80"><template #default="{row}"><el-tag :type="row.status==='pending'?'warning':'success'" size="small">{{row.status}}</el-tag></template></el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- Tab: 汇总 -->
      <el-tab-pane name="summary">
        <template #label><span class="tab-label"><el-icon><DataAnalysis /></el-icon>科目汇总</span></template>
        <el-form :inline="true" size="small" style="margin-bottom:8px">
          <el-form-item label="实例"><el-select v-model="sumInstance" clearable style="width:180px" @change="loadSummary"><el-option v-for="i in instances" :key="i.id" :label="i.instance_code" :value="i.id"/></el-select></el-form-item>
          <el-form-item><el-button type="primary" size="small" @click="loadSummary">查询</el-button></el-form-item>
        </el-form>
        <el-table :data="summaryRows" size="small" empty-text="无数据" show-summary>
          <el-table-column prop="gl_account_code" label="科目编码" width="100" />
          <el-table-column label="借方合计" width="140"><template #default="{row}">{{ row.total_debit?.toFixed(2) }}</template></el-table-column>
          <el-table-column label="贷方合计" width="140"><template #default="{row}">{{ row.total_credit?.toFixed(2) }}</template></el-table-column>
          <el-table-column prop="entry_count" label="笔数" width="80" />
        </el-table>
        <div v-if="summaryTotal" style="margin-top:8px;font-weight:600">
          借方合计: <span style="color:var(--el-color-danger)">{{ summaryTotal.total_debit?.toFixed(2) }}</span> &nbsp;
          贷方合计: <span style="color:var(--el-color-success)">{{ summaryTotal.total_credit?.toFixed(2) }}</span> &nbsp;
          净额: {{ summaryTotal.net?.toFixed(2) }}
        </div>
      </el-tab-pane>

      <!-- Tab: GL 科目 -->
      <el-tab-pane name="gl">
        <template #label><span class="tab-label"><el-icon><Document /></el-icon>GL 科目表</span></template>
        <el-button type="primary" size="small" style="margin-bottom:8px" @click="showAddGl=true">+ 添加科目</el-button>
        <el-table :data="glAccounts" size="small">
          <el-table-column prop="account_code" label="编码" width="100" />
          <el-table-column prop="account_name" label="名称" width="160" />
          <el-table-column label="类型" width="100"><template #default="{row}"><el-tag :type="row.account_type==='asset'?'success':''" size="small">{{row.account_type}}</el-tag></template></el-table-column>
          <el-table-column prop="description" label="说明" min-width="180" />
          <el-table-column prop="is_active" label="状态" width="70"><template #default="{row}"><el-tag :type="row.is_active?'success':'info'" size="small">{{row.is_active?'启用':'停用'}}</el-tag></template></el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- Tab: 导出日志 -->
      <el-tab-pane name="export">
        <template #label><span class="tab-label"><el-icon><Upload /></el-icon>导出日志</span></template>
        <el-table :data="exportLogs" size="small" empty-text="无导出记录">
          <el-table-column prop="export_type" label="类型" width="140" />
          <el-table-column prop="record_count" label="记录数" width="80" />
          <el-table-column prop="file_path" label="文件路径" min-width="300" />
          <el-table-column prop="created_at" label="时间" width="160" />
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <!-- Add GL Dialog -->
    <el-dialog v-model="showAddGl" title="添加 GL 科目" width="400px">
      <el-form :model="newGl" label-width="100px" size="small">
        <el-form-item label="科目编码" required><el-input v-model="newGl.account_code"/></el-form-item>
        <el-form-item label="科目名称" required><el-input v-model="newGl.account_name"/></el-form-item>
        <el-form-item label="类型"><el-select v-model="newGl.account_type" style="width:100%"><el-option label="费用" value="expense"/><el-option label="资产" value="asset"/><el-option label="负债" value="liability"/></el-select></el-form-item>
        <el-form-item label="说明"><el-input v-model="newGl.description"/></el-form-item>
      </el-form>
      <template #footer><el-button @click="showAddGl=false">取消</el-button><el-button type="primary" @click="addGl" :loading="saving">确定</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import Api from '../api'
import { ElMessage } from 'element-plus'

const loading = ref(false); const rolling = ref(false); const exporting = ref(false); const saving = ref(false)
const activeTab = ref('ledger')
const ledger = ref<any[]>([]); const glAccounts = ref<any[]>([]); const exportLogs = ref<any[]>([])
const summaryRows = ref<any[]>([]); const summaryTotal = ref<any>(null)
const filterInstance = ref(null); const filterStatus = ref(null)
const sumInstance = ref(null)
const instances = ref<any[]>([])
const showAddGl = ref(false)
const newGl = reactive({ account_code:'', account_name:'', account_type:'expense', description:'' })

async function refresh() {
  loading.value = true
  try {
    glAccounts.value = await Api.get('/erp/gl-accounts')
    exportLogs.value = await Api.get('/erp/export/log')
    await loadLedger()
  } catch(e:any) { ElMessage.error('加载台账失败: ' + (e.response?.data?.error || e.message)) }
  finally { loading.value = false }
}

async function loadLedger() {
  const params: any = {}
  if (filterInstance.value) params.instance_id = filterInstance.value
  if (filterStatus.value) params.status = filterStatus.value
  ledger.value = await Api.get('/erp/ledger', params)
}

async function loadSummary() {
  const params: any = {}
  if (sumInstance.value) params.instance_id = sumInstance.value
  const r = await Api.get('/erp/ledger/summary', params)
  summaryRows.value = r.accounts||[]
  summaryTotal.value = r
}

async function doRollup() {
  rolling.value = true
  try {
    const name = await (await import('element-plus')).ElMessageBox.prompt('装备实例 ID', '成本归集', {inputType:'number'})
    const r = await Api.post('/erp/cost-rollup', { instance_id: parseInt(name.value) })
    ElMessage.success(`归集完成: ${r.entries_created} 条, 借方合计 ${r.total_debit?.toFixed(2)}`)
    await refresh()
  } catch(e:any) { ElMessage.error('操作失败: ' + (e.response?.data?.error || e.message)) }
  finally { rolling.value = false }
}

async function exportLedger() {
  exporting.value = true
  try { const r = await Api.post('/erp/export/ledger', {}); ElMessage.success(`导出 ${r.exported} 条至 ${r.file}`); await refresh() }
  catch(e:any) { ElMessage.error(e.message) }
  finally { exporting.value = false }
}

async function addGl() {
  saving.value = true
  try { await Api.post('/erp/gl-accounts', newGl); showAddGl.value = false; await refresh(); ElMessage.success('添加成功') }
  catch(e:any) { ElMessage.error(e.message) }
  finally { saving.value = false }
}

onMounted(refresh)
</script>

<style scoped>
.page { padding: 16px }
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px }
.page-title { font-size: 20px; font-weight: 700 }
.tab-label { display: inline-flex; align-items: center; gap: 6px; }
</style>
