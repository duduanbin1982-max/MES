<template>
  <div class="page">
    <div class="page-header">
      <div>
        <div class="page-title">📦 装备实例</div>
        <div class="page-subtitle">项目号、合同号、序列号统一编码；从第一天就把 TBM 交付主线立住。</div>
      </div>
      <el-button type="primary" @click="openCreate">
        <el-icon><Plus /></el-icon>创建向导
      </el-button>
    </div>

    <el-card style="margin-bottom: 16px">
      <el-form :inline="true" :model="filters" size="default">
        <el-form-item label="生命周期">
          <el-select v-model="filters.status" clearable placeholder="全部" style="width: 150px">
            <el-option v-for="s in lifecycleOptions" :key="s.value" :label="s.label" :value="s.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="filters.equipment_type_id" clearable placeholder="全部" style="width: 160px">
            <el-option v-for="t in types" :key="t.id" :label="t.name_zh" :value="t.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="客户">
          <el-input v-model="filters.customer" clearable placeholder="搜索客户名" style="width: 200px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="load">查询</el-button>
          <el-button @click="resetFilters">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card>
      <el-table :data="rows" stripe v-loading="loading" @row-click="goDetail" style="cursor: pointer">
        <el-table-column prop="instance_code" label="实例编码" width="170" />
        <el-table-column prop="project_no" label="项目号" width="130">
          <template #default="{ row }">{{ row.project_no || '-' }}</template>
        </el-table-column>
        <el-table-column prop="instance_name" label="名称" min-width="190" />
        <el-table-column prop="customer_name" label="客户" width="140" />
        <el-table-column prop="contract_no" label="合同号" width="150">
          <template #default="{ row }">{{ row.contract_no || '-' }}</template>
        </el-table-column>
        <el-table-column prop="serial_no" label="序列号" width="150">
          <template #default="{ row }">{{ row.serial_no || '-' }}</template>
        </el-table-column>
        <el-table-column label="生命周期" width="110">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.lifecycle_stage || row.status)" size="small">{{ statusLabel(row.lifecycle_stage || row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="冻结" width="90">
          <template #default="{ row }">
            <el-tag v-if="row.archive_status === 'archived'" type="danger" size="small">归档</el-tag>
            <el-tag v-else-if="row.frozen_at" type="warning" size="small">冻结</el-tag>
            <el-tag v-else type="success" size="small">可编辑</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="工期" width="190">
          <template #default="{ row }">{{ row.planned_start || '-' }} → {{ row.planned_end || '-' }}</template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="showCreate" title="装备实例创建向导" width="860px" destroy-on-close>
      <el-alert
        title="向导会同时生成合同/里程碑/BOM 空壳/文档目录；也可以从历史 TBM 复制 BOM、工艺和里程碑。"
        type="info"
        show-icon
        :closable="false"
        style="margin-bottom: 14px"
      />
      <el-steps :active="wizardStep" finish-status="success" simple style="margin-bottom: 18px">
        <el-step title="编码合同" />
        <el-step title="结构模板" />
        <el-step title="初始化" />
      </el-steps>

      <el-form :model="newInst" label-width="120px">
        <div v-show="wizardStep === 0" class="wizard-grid">
          <el-form-item label="客户" required>
            <el-input v-model="newInst.customer_name" placeholder="如 郑州地铁集团" @blur="refreshCode" />
          </el-form-item>
          <el-form-item label="年份">
            <el-input-number v-model="codeYear" :min="2020" :max="2099" @change="refreshCode" />
          </el-form-item>
          <el-form-item label="实例编码" required>
            <el-input v-model="newInst.instance_code" placeholder="TBM-客户-YYYY-###">
              <template #append><el-button @click="refreshCode">生成</el-button></template>
            </el-input>
          </el-form-item>
          <el-form-item label="项目号">
            <el-input v-model="newInst.project_no" placeholder="PRJ-2026-001" />
          </el-form-item>
          <el-form-item label="合同号">
            <el-input v-model="newInst.contract_no" placeholder="合同编号" />
          </el-form-item>
          <el-form-item label="出厂序列号">
            <el-input v-model="newInst.serial_no" placeholder="SN-2026-001" />
          </el-form-item>
          <el-form-item label="实例名称" required>
            <el-input v-model="newInst.instance_name" placeholder="项目名 + 机型描述" />
          </el-form-item>
          <el-form-item label="合同金额(万)">
            <el-input-number v-model="newInst.contract_amount" :min="0" style="width: 100%" />
          </el-form-item>
          <el-form-item label="客户联系人">
            <el-input v-model="newInst.customer_contact" placeholder="姓名/电话" />
          </el-form-item>
          <el-form-item label="项目现场">
            <el-input v-model="newInst.site_location" placeholder="施工/交付地点" />
          </el-form-item>
        </div>

        <div v-show="wizardStep === 1" class="wizard-grid">
          <el-form-item label="产品类型" required>
            <el-select v-model="newInst.equipment_type_id" placeholder="选产品类别" @change="loadModels" style="width: 100%">
              <el-option v-for="t in types" :key="t.id" :label="t.name_zh" :value="t.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="型号" required>
            <el-select v-model="newInst.equipment_model_id" placeholder="先选类型" style="width: 100%">
              <el-option v-for="m in models" :key="m.id" :label="m.model_name" :value="m.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="计划工期" class="wide">
            <el-date-picker v-model="dateRange" type="daterange" value-format="YYYY-MM-DD" style="width: 100%" />
          </el-form-item>
          <el-form-item label="复制模板" class="wide">
            <el-select v-model="newInst.template_instance_id" clearable filterable placeholder="可选：从历史 TBM 复制结构" style="width: 100%">
              <el-option v-for="row in rows" :key="row.id" :label="`${row.instance_code} · ${row.instance_name || row.customer_name}`" :value="row.id" />
            </el-select>
          </el-form-item>
        </div>

        <div v-show="wizardStep === 2">
          <el-row :gutter="14">
            <el-col :span="12">
              <el-card shadow="never">
                <template #header>默认初始化</template>
                <el-checkbox v-model="newInst.generate_milestones">生成默认 8 阶段里程碑</el-checkbox>
                <el-checkbox v-model="newInst.create_bom_shell">生成 0 级总装 BOM 空壳</el-checkbox>
                <el-checkbox v-model="newInst.create_doc_dirs">生成合同/BOM/图纸/工艺/质检目录</el-checkbox>
              </el-card>
            </el-col>
            <el-col :span="12">
              <el-card shadow="never">
                <template #header>模板复制</template>
                <el-checkbox v-model="newInst.copy_template_bom" :disabled="!newInst.template_instance_id">复制 BOM 结构</el-checkbox>
                <el-checkbox v-model="newInst.copy_template_process" :disabled="!newInst.template_instance_id">复制工艺路线</el-checkbox>
                <el-checkbox v-model="newInst.copy_template_milestones" :disabled="!newInst.template_instance_id">复制里程碑结构</el-checkbox>
              </el-card>
            </el-col>
          </el-row>
          <el-form-item label="备注" style="margin-top: 14px">
            <el-input v-model="newInst.notes" type="textarea" :rows="3" placeholder="项目特殊要求、交付边界、客户约束等" />
          </el-form-item>
        </div>
      </el-form>

      <template #footer>
        <el-button @click="showCreate = false">取消</el-button>
        <el-button :disabled="wizardStep === 0" @click="wizardStep--">上一步</el-button>
        <el-button v-if="wizardStep < 2" type="primary" @click="nextStep">下一步</el-button>
        <el-button v-else type="primary" :loading="creating" @click="createInstance">创建并初始化</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Api } from '../api'

const router = useRouter()
const loading = ref(false)
const rows = ref<any[]>([])
const types = ref<any[]>([])
const models = ref<any[]>([])
const lifecycleOptions = ref<any[]>([])
const filters = reactive({ status: '', equipment_type_id: undefined as any, customer: '' })

const fallbackLifecycle = [
  { value: 'design', label: '设计中' },
  { value: 'procurement', label: '采购中' },
  { value: 'manufacturing', label: '制造中' },
  { value: 'assembly', label: '总装中' },
  { value: 'commissioning', label: '调试中' },
  { value: 'acceptance', label: '验收中' },
  { value: 'delivered', label: '交付' },
  { value: 'operation', label: '运维' },
  { value: 'archived', label: '归档' },
]
const statusLabel = (s: string) => lifecycleOptions.value.find(x => x.value === s)?.label || ({ S1: '设计中' } as any)[s] || s || '-'
const statusTagType = (s: string) => ({ design: 'info', procurement: 'warning', manufacturing: 'primary', assembly: 'primary', commissioning: 'success', acceptance: 'warning', delivered: 'success', operation: 'success', archived: 'danger', S1: 'info' } as any)[s] || 'info'

const resetFilters = () => { filters.status = ''; filters.equipment_type_id = undefined; filters.customer = ''; load() }
const goDetail = (row: any) => router.push(`/instances/${row.id}`)

const load = async () => {
  loading.value = true
  try {
    const params: any = {}
    if (filters.status) params.status = filters.status
    if (filters.equipment_type_id) params.equipment_type_id = filters.equipment_type_id
    if (filters.customer) params.customer = filters.customer
    rows.value = await Api.instances(params)
  } finally {
    loading.value = false
  }
}

const loadTypes = async () => { types.value = await Api.equipmentTypes() }
const loadLifecycle = async () => {
  try { lifecycleOptions.value = await Api.instanceLifecycleOptions() } catch { lifecycleOptions.value = fallbackLifecycle }
}
const loadModels = async () => {
  if (!newInst.equipment_type_id) { models.value = []; return }
  models.value = await Api.equipmentModels(newInst.equipment_type_id)
}

const showCreate = ref(false)
const creating = ref(false)
const wizardStep = ref(0)
const codeYear = ref(new Date().getFullYear())
const newInst = reactive<any>({
  instance_code: '',
  project_no: '',
  instance_name: '',
  equipment_type_id: undefined,
  equipment_model_id: undefined,
  customer_name: '',
  customer_contact: '',
  site_location: '',
  contract_no: '',
  serial_no: '',
  contract_amount: undefined,
  template_instance_id: undefined,
  generate_milestones: true,
  create_bom_shell: true,
  create_doc_dirs: true,
  copy_template_bom: false,
  copy_template_process: false,
  copy_template_milestones: false,
  notes: '',
})
const dateRange = ref<[string, string] | null>(null)

const openCreate = async () => {
  wizardStep.value = 0
  showCreate.value = true
  if (!newInst.instance_code) await refreshCode()
}

const refreshCode = async () => {
  const r: any = await Api.instanceCodePreview({ customer: newInst.customer_name, year: codeYear.value })
  newInst.instance_code = r.code
  if (!newInst.project_no) newInst.project_no = `PRJ-${codeYear.value}-${r.code.split('-').pop()}`
  if (!newInst.serial_no) newInst.serial_no = `SN-${codeYear.value}-${r.code.split('-').pop()}`
}

const nextStep = () => {
  if (wizardStep.value === 0 && (!newInst.instance_code || !newInst.customer_name || !newInst.instance_name)) {
    ElMessage.warning('请先填写客户、实例编码和实例名称'); return
  }
  if (wizardStep.value === 1 && !newInst.equipment_model_id) {
    ElMessage.warning('请选择产品类型和型号'); return
  }
  wizardStep.value++
}

const createInstance = async () => {
  creating.value = true
  try {
    const payload: any = { ...newInst, wizard: true }
    if (dateRange.value) { payload.planned_start = dateRange.value[0]; payload.planned_end = dateRange.value[1] }
    delete payload.equipment_type_id
    const r: any = await Api.post('/equipment_instances', payload)
    ElMessage.success('创建成功，已生成默认交付骨架')
    showCreate.value = false
    await load()
    router.push(`/instances/${r.id}`)
  } finally {
    creating.value = false
  }
}

onMounted(async () => { await Promise.all([loadTypes(), loadLifecycle()]); await load() })
</script>

<style scoped>
.page-subtitle { color: var(--el-text-color-secondary); margin-top: 6px; font-size: 13px; }
.wizard-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
.wizard-grid .wide { grid-column: 1 / span 2; }
</style>
