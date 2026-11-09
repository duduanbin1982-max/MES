<template>
  <div class="page">
    <PageToolbar class="page-header">
      <div>
        <div class="page-title"><el-icon><Money /></el-icon> 外协/折旧成本</div>
        <div class="page-subtitle">基于 project_cost_entries 标准成本台账，按外协、折旧、返工、质量损失归集到项目。</div>
      </div>
      <div>
        <el-select v-model="selectedInstance" placeholder="选择装备实例" style="width:280px;margin-right:8px" @change="load">
          <el-option v-for="item in instances" :key="item.id" :label="item.instance_code + ' | ' + (item.instance_name || '')" :value="item.id" />
        </el-select>
        <el-button :loading="loading" @click="load">刷新</el-button>
        <el-button v-if="canWrite" type="primary" :disabled="!selectedInstance" @click="openDialog()">新增成本</el-button>
      </div>
    </PageToolbar>

    <PageState state="empty" compact :show-action="false" v-if="!selectedInstance" description="选择装备实例查看外协/折旧成本" />

    <template v-else>
      <el-row :gutter="16" class="kpi-row">
        <el-col :span="6"><el-card><el-statistic title="外协成本（CNY）" :value="money(summary.by_type?.outsourcing?.amount)" /></el-card></el-col>
        <el-col :span="6"><el-card><el-statistic title="折旧成本（CNY）" :value="money(summary.by_type?.depreciation?.amount)" /></el-card></el-col>
        <el-col :span="6"><el-card><el-statistic title="返工成本（CNY）" :value="money(summary.by_type?.rework?.amount)" /></el-card></el-col>
        <el-col :span="6"><el-card><el-statistic title="质量损失（CNY）" :value="money(summary.by_type?.quality_loss?.amount)" /></el-card></el-col>
      </el-row>

      <el-card>
        <template #header>
          <div class="card-header">
            <span>专项成本台账</span>
            <div class="summary-line">
              <el-tag type="info" effect="plain">总额 {{ money(summary.total) }}</el-tag>
              <el-tag type="success" effect="plain">标准科目 {{ items.length }} 条</el-tag>
            </div>
          </div>
        </template>
        <el-alert
          v-if="!items.length"
          type="warning"
          :closable="false"
          show-icon
          title="当前项目尚未录入外协/折旧/返工/质量损失台账。点击右上角【新增成本】录入标准科目。"
          style="margin-bottom:12px"
        />
        <el-table :data="items" stripe size="small" v-loading="loading" height="560" empty-text="暂无专项成本台账">
          <el-table-column prop="cost_type_label" label="成本类别" width="120" />
          <el-table-column prop="description" label="事项" min-width="190" show-overflow-tooltip />
          <el-table-column prop="currency" label="币种" width="70" />
          <el-table-column label="金额(原币)" width="130">
            <template #default="{ row }">{{ money(row.amount) }}</template>
          </el-table-column>
          <el-table-column label="折合CNY" width="130">
            <template #default="{ row }">{{ money(row.amount_cny ?? row.amount) }}</template>
          </el-table-column>
          <el-table-column prop="vendor" label="供应商/对象" min-width="140" show-overflow-tooltip />
          <el-table-column prop="source_type" label="来源类型" width="120" />
          <el-table-column prop="source_ref" label="来源单号" min-width="140" show-overflow-tooltip />
          <el-table-column prop="occurred_on" label="发生日期" width="120" />
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag :type="row.status === 'posted' ? 'success' : row.status === 'draft' ? 'info' : 'warning'" size="small">{{ statusLabel(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="notes" label="备注" min-width="160" show-overflow-tooltip />
          <el-table-column v-if="canWrite" label="操作" width="140" fixed="right">
            <template #default="{ row }">
              <el-button link size="small" @click="openDialog(row)">编辑</el-button>
              <el-popconfirm title="确认作废这条成本台账？" @confirm="voidEntry(row)">
                <template #reference><el-button link size="small" type="danger">作废</el-button></template>
              </el-popconfirm>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </template>

    <el-dialog v-model="dialogVisible" :title="editing?.id ? '编辑专项成本' : '新增专项成本'" width="620px">
      <el-form :model="form" label-width="110px">
        <el-form-item label="成本类别" required>
          <el-select v-model="form.cost_type" style="width:100%">
            <el-option label="外协" value="outsourcing" />
            <el-option label="折旧" value="depreciation" />
            <el-option label="返工" value="rework" />
            <el-option label="质量损失" value="quality_loss" />
          </el-select>
        </el-form-item>
        <el-form-item label="事项说明" required>
          <el-input v-model="form.description" placeholder="如：刀盘焊接外协、龙门吊折旧、返工工时等" />
        </el-form-item>
        <el-form-item label="金额" required>
          <el-input-number v-model="form.amount" :min="0" :precision="2" style="width:100%" />
        </el-form-item>
        <el-form-item label="发生日期">
          <el-date-picker v-model="form.occurred_on" type="date" value-format="YYYY-MM-DD" style="width:100%" />
        </el-form-item>
        <el-form-item label="币种">
          <el-select v-model="form.currency" style="width:100%">
            <el-option label="人民币 CNY" value="CNY" /><el-option label="美元 USD" value="USD" /><el-option label="欧元 EUR" value="EUR" />
          </el-select>
        </el-form-item>
        <el-form-item label="供应商/对象">
          <el-input v-model="form.vendor" placeholder="外协供应商、设备名称或责任对象" />
        </el-form-item>
        <el-form-item label="来源类型">
          <el-input v-model="form.source_type" placeholder="PO / ERP / MANUAL / NCR" />
        </el-form-item>
        <el-form-item label="来源单号">
          <el-input v-model="form.source_ref" placeholder="采购单、ERP凭证、NCR编号等" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status" style="width:100%">
            <el-option label="草稿" value="draft" />
            <el-option label="已入账" value="posted" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.notes" type="textarea" :rows="3" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible=false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveEntry">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { Api } from '../api'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '../stores/auth'
import { computed } from 'vue'

const auth = useAuthStore()
const canWrite = computed(() => auth.role === 'admin' || auth.role === 'foreman')
const instances = ref<any[]>([])
const selectedInstance = ref<any>(null)
const loading = ref(false)
const saving = ref(false)
const items = ref<any[]>([])
const summary = ref<any>({ by_type: {}, total: 0 })
const dialogVisible = ref(false)
const editing = ref<any>(null)
const today = () => new Date().toISOString().slice(0, 10)
const form = reactive<any>({
  cost_type: 'outsourcing',
  description: '',
  amount: 0,
  occurred_on: today(),
  vendor: '',
  source_type: 'MANUAL',
  source_ref: '',
  currency: 'CNY',
  status: 'posted',
  notes: '',
})

const SPECIAL_COST_TYPES = 'outsourcing,depreciation,rework,quality_loss'
const errText = (e: any) => e?.response?.data?.error || e?.response?.data?.message || e?.message || String(e)
const money = (value: any) => Number(value || 0).toLocaleString('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 0 })
const statusLabel = (status: string) => ({ draft: '草稿', posted: '已入账', void: '作废' } as any)[status] || status || '-'

const resetForm = (row?: any) => {
  editing.value = row || null
  Object.assign(form, {
    cost_type: row?.cost_type || 'outsourcing',
    description: row?.description || '',
    amount: Number(row?.amount || 0),
    occurred_on: row?.occurred_on || today(),
    vendor: row?.vendor || '',
    source_type: row?.source_type || 'MANUAL',
    source_ref: row?.source_ref || '',
    currency: row?.currency || 'CNY',
    status: row?.status === 'draft' ? 'draft' : 'posted',
    notes: row?.notes || '',
  })
}

const loadInstances = async () => {
  try {
    const data = await Api.get('/equipment_instances')
    instances.value = data.items || data || []
    if (!selectedInstance.value && instances.value.length) {
      const preferred = instances.value.find((item: any) => !/演示|演练|demo|培训/i.test(String(item.instance_name || '')) && item.status !== 'archived')
      selectedInstance.value = (preferred || instances.value[0]).id
    }
  } catch (e: any) {
    ElMessage.error('加载装备实例失败: ' + errText(e))
  }
}

const load = async () => {
  if (!selectedInstance.value) return
  loading.value = true
  try {
    const [list, sum] = await Promise.all([
      Api.get('/project_cost_entries', { params: { equipment_instance_id: selectedInstance.value, cost_types: SPECIAL_COST_TYPES, limit: 500 } }),
      Api.get('/project_cost_entries/summary', { params: { equipment_instance_id: selectedInstance.value, cost_types: SPECIAL_COST_TYPES } }),
    ])
    items.value = list.items || []
    summary.value = sum || { by_type: {}, total: 0 }
  } catch (e: any) {
    ElMessage.error('加载专项成本台账失败: ' + errText(e))
    items.value = []
    summary.value = { by_type: {}, total: 0 }
  } finally {
    loading.value = false
  }
}

const openDialog = (row?: any) => {
  resetForm(row)
  dialogVisible.value = true
}

const saveEntry = async () => {
  if (!selectedInstance.value) return
  saving.value = true
  try {
    const payload = {
      equipment_instance_id: selectedInstance.value,
      cost_type: form.cost_type,
      description: form.description,
      amount: form.amount,
      occurred_on: form.occurred_on,
      vendor: form.vendor,
      source_type: form.source_type,
      source_ref: form.source_ref,
      status: form.status,
      notes: form.notes,
      currency: form.currency,
    }
    if (editing.value?.id) await Api.put(`/project_cost_entries/${editing.value.id}`, payload)
    else await Api.post('/project_cost_entries', payload)
    dialogVisible.value = false
    await load()
  } catch (e: any) {
    ElMessage.error('保存专项成本失败: ' + errText(e))
  } finally {
    saving.value = false
  }
}

const voidEntry = async (row: any) => {
  try {
    await Api.del(`/project_cost_entries/${row.id}`)
    await load()
  } catch (e: any) {
    ElMessage.error('作废失败: ' + errText(e))
  }
}

onMounted(async () => {
  await loadInstances()
  await load()
})
</script>

<style scoped>
.page{padding:16px 24px}
.page-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.page-title{font-size:20px;font-weight:600}
.page-subtitle{color:var(--el-text-color-secondary);font-size:13px;margin-top:4px}
.kpi-row{margin-bottom:16px}
.card-header{display:flex;justify-content:space-between;align-items:center;gap:12px}
.summary-line{display:flex;gap:8px;flex-wrap:wrap}
</style>
