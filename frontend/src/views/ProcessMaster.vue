<template>
  <div class="page">
    <PageToolbar class="page-header">
      <div>
        <div class="page-title"><el-icon><Setting /></el-icon> 工序 / 岗位配置</div>
        <div class="page-subtitle">工序库管“怎么做”，岗位库管“谁能做”，工艺路线引用这里的标准模板。</div>
      </div>
      <el-button @click="loadAll" :loading="loading">刷新</el-button>
    </PageToolbar>

    <el-row :gutter="12" style="margin-bottom: 12px">
      <el-col :span="6"><el-card shadow="never"><el-statistic title="岗位数" :value="overview.positions?.active || 0" /></el-card></el-col>
      <el-col :span="6"><el-card shadow="never"><el-statistic title="工序模板" :value="overview.operations?.active || 0" /></el-card></el-col>
      <el-col :span="6"><el-card shadow="never"><el-statistic title="已套模板节点" :value="overview.process_nodes?.templated || 0" /></el-card></el-col>
      <el-col :span="6"><el-card shadow="never"><el-statistic title="已绑岗位节点" :value="overview.process_nodes?.positioned || 0" /></el-card></el-col>
    </el-row>

    <el-alert
      title="建议先维护岗位，再维护工序模板，最后在工艺树节点中套用模板。派工时系统会校验人员技能等级和证书。"
      type="info"
      show-icon
      :closable="false"
      style="margin-bottom: 12px"
    />

    <el-tabs v-model="tab" type="border-card">
      <el-tab-pane label="工序库" name="operations">
        <template #label><el-icon><Tools /></el-icon> 工序库</template>
        <div class="toolbar">
          <el-input aria-label="搜索工序编码/名称/分类" v-model="opKeyword" placeholder="搜索工序编码/名称/分类" clearable style="width: 260px" />
          <el-button type="primary" @click="openOperation()">+ 新建工序</el-button>
        </div>
        <el-table :data="filteredOperations" size="small" stripe>
          <el-table-column prop="sequence_hint" label="顺序" width="70" />
          <el-table-column prop="operation_code" label="编码" width="130" />
          <el-table-column prop="operation_name" label="工序名称" width="140" />
          <el-table-column prop="category" label="分类" width="110" />
          <el-table-column prop="operation_type" label="类型" width="90" />
          <el-table-column label="默认工位" width="110">
            <template #default="{ row }"><el-tag size="small">{{ row.default_station_type || '-' }}</el-tag></template>
          </el-table-column>
          <el-table-column label="岗位/技能" min-width="180">
            <template #default="{ row }">
              <el-tag size="small" type="success" style="margin-right:4px">{{ row.position_name || row.required_position_code || '-' }}</el-tag>
              <el-tag size="small" type="info">{{ row.required_skill || '-' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="工时/定员" width="110">
            <template #default="{ row }">{{ row.standard_hours || 0 }}h / {{ row.worker_count || 1 }}人</template>
          </el-table-column>
          <el-table-column label="控制点" width="120">
            <template #default="{ row }">
              <el-tag v-if="row.qc_required" size="small" type="warning">质检</el-tag>
              <el-tag v-if="row.sop_required" size="small" type="info" style="margin-left:4px">SOP</el-tag>
              <el-tag v-if="row.drawing_required" size="small" type="primary" style="margin-left:4px">图纸</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="node_count" label="引用节点" width="90" />
          <el-table-column label="状态" width="80">
            <template #default="{ row }"><el-tag :type="row.is_active ? 'success' : 'info'" size="small">{{ row.is_active ? '启用' : '停用' }}</el-tag></template>
          </el-table-column>
          <el-table-column label="操作" width="130" fixed="right">
            <template #default="{ row }">
              <el-button size="small" link type="primary" @click="openOperation(row)">编辑</el-button>
              <el-button size="small" link type="danger" @click="deleteOperation(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="岗位库" name="positions">
        <template #label><el-icon><UserFilled /></el-icon> 岗位库</template>
        <div class="toolbar">
          <el-input v-model="posKeyword" placeholder="搜索岗位编码/名称/部门" clearable style="width: 260px" />
          <el-button type="primary" @click="openPosition()">+ 新建岗位</el-button>
        </div>
        <el-table :data="filteredPositions" size="small" stripe>
          <el-table-column prop="position_code" label="编码" width="150" />
          <el-table-column prop="position_name" label="岗位名称" width="130" />
          <el-table-column prop="department" label="部门" width="110" />
          <el-table-column prop="skill_category" label="技能分类" width="110" />
          <el-table-column prop="min_level" label="最低等级" width="90" />
          <el-table-column prop="required_cert_type" label="所需证书" width="120">
            <template #default="{ row }"><el-tag v-if="row.required_cert_type" size="small" type="warning">{{ row.required_cert_type }}</el-tag><span v-else>-</span></template>
          </el-table-column>
          <el-table-column prop="template_count" label="模板数" width="80" />
          <el-table-column prop="node_count" label="节点数" width="80" />
          <el-table-column prop="description" label="说明" min-width="180" show-overflow-tooltip />
          <el-table-column label="状态" width="80">
            <template #default="{ row }"><el-tag :type="row.is_active ? 'success' : 'info'" size="small">{{ row.is_active ? '启用' : '停用' }}</el-tag></template>
          </el-table-column>
          <el-table-column label="操作" width="130" fixed="right">
            <template #default="{ row }">
              <el-button size="small" link type="primary" @click="openPosition(row)">编辑</el-button>
              <el-button size="small" link type="danger" @click="deletePosition(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="派工校验" name="validate">
        <template #label><el-icon><CircleCheck /></el-icon> 派工校验</template>
        <el-form :model="validationForm" label-width="100px" style="max-width:680px">
          <el-form-item label="工艺节点ID"><el-input-number v-model="validationForm.process_node_id" :min="1" /></el-form-item>
          <el-form-item label="人员ID"><el-input-number v-model="validationForm.user_id" :min="1" /></el-form-item>
          <el-form-item>
            <el-button type="primary" @click="validateAssignment">校验资质</el-button>
          </el-form-item>
        </el-form>
        <el-result
          v-if="validationResult"
          :icon="validationResult.ok ? 'success' : 'warning'"
          :title="validationResult.ok ? '可以派工' : '不建议派工'"
          :sub-title="validationResult.ok ? '人员技能和证书满足该工序岗位要求。' : (validationResult.missing || []).join('；')"
        >
          <template #extra>
            <el-descriptions :column="2" border size="small">
              <el-descriptions-item label="人员">{{ validationResult.user_name }}</el-descriptions-item>
              <el-descriptions-item label="岗位">{{ validationResult.position_name || validationResult.required_position_code || '-' }}</el-descriptions-item>
              <el-descriptions-item label="技能">{{ validationResult.required_skill || '-' }}</el-descriptions-item>
              <el-descriptions-item label="证书">{{ validationResult.required_cert_type || '-' }}</el-descriptions-item>
            </el-descriptions>
          </template>
        </el-result>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="opDlg.visible" :title="opDlg.form.id ? '编辑工序模板' : '新建工序模板'" width="680px">
      <el-form :model="opDlg.form" label-width="110px">
        <el-row :gutter="12">
          <el-col :span="12"><el-form-item label="工序编码" required><el-input v-model="opDlg.form.operation_code" placeholder="welding" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="工序名称" required><el-input v-model="opDlg.form.operation_name" placeholder="焊接" /></el-form-item></el-col>
          <el-col :span="12">
            <el-form-item label="工序类型">
              <el-select v-model="opDlg.form.operation_type" style="width:100%">
                <el-option label="制造" value="make" />
                <el-option label="采购" value="buy" />
                <el-option label="装配" value="assemble" />
                <el-option label="质检" value="qc" />
                <el-option label="测试" value="test" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12"><el-form-item label="分类"><el-input v-model="opDlg.form.category" placeholder="welding / assembly" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="默认工位类型"><el-input v-model="opDlg.form.default_station_type" placeholder="welding / assembly" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="所需技能"><el-input v-model="opDlg.form.required_skill" placeholder="welding" /></el-form-item></el-col>
          <el-col :span="12">
            <el-form-item label="所需岗位">
              <el-select v-model="opDlg.form.required_position_code" clearable filterable style="width:100%">
                <el-option v-for="p in positions" :key="p.position_code" :label="p.position_name + ' / ' + p.position_code" :value="p.position_code" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12"><el-form-item label="顺序建议"><el-input-number v-model="opDlg.form.sequence_hint" :min="1" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="标准工时(h)"><el-input-number v-model="opDlg.form.standard_hours" :min="0" :step="0.5" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="定员(人)"><el-input-number v-model="opDlg.form.worker_count" :min="1" :max="50" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="控制点"><el-checkbox v-model="opDlg.form.qc_required">质检</el-checkbox><el-checkbox v-model="opDlg.form.sop_required">SOP</el-checkbox><el-checkbox v-model="opDlg.form.drawing_required">图纸</el-checkbox></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="状态"><el-switch v-model="opDlg.form.is_active" active-text="启用" inactive-text="停用" /></el-form-item></el-col>
          <el-col :span="24"><el-form-item label="说明"><el-input v-model="opDlg.form.description" type="textarea" :rows="2" /></el-form-item></el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="opDlg.visible = false">取消</el-button>
        <el-button type="primary" @click="saveOperation" :loading="opDlg.saving">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="posDlg.visible" :title="posDlg.form.id ? '编辑岗位' : '新建岗位'" width="620px">
      <el-form :model="posDlg.form" label-width="100px">
        <el-row :gutter="12">
          <el-col :span="12"><el-form-item label="岗位编码" required><el-input v-model="posDlg.form.position_code" :disabled="!!posDlg.form.id" placeholder="welder" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="岗位名称" required><el-input v-model="posDlg.form.position_name" placeholder="焊工" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="部门"><el-input v-model="posDlg.form.department" placeholder="焊接车间" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="技能分类"><el-input v-model="posDlg.form.skill_category" placeholder="welding" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="最低等级"><el-input-number v-model="posDlg.form.min_level" :min="1" :max="5" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="所需证书"><el-input v-model="posDlg.form.required_cert_type" placeholder="welding / ndt / qc，可空" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="状态"><el-switch v-model="posDlg.form.is_active" active-text="启用" inactive-text="停用" /></el-form-item></el-col>
          <el-col :span="24"><el-form-item label="说明"><el-input v-model="posDlg.form.description" type="textarea" :rows="2" /></el-form-item></el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="posDlg.visible = false">取消</el-button>
        <el-button type="primary" @click="savePosition" :loading="posDlg.saving">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Api } from '../api'

const loading = ref(false)
const tab = ref('operations')
const overview = ref<any>({})
const operations = ref<any[]>([])
const positions = ref<any[]>([])
const opKeyword = ref('')
const posKeyword = ref('')
const validationResult = ref<any>(null)
const validationForm = reactive<any>({ process_node_id: null, user_id: null })
const opDlg = reactive<any>({ visible: false, saving: false, form: {} })
const posDlg = reactive<any>({ visible: false, saving: false, form: {} })

const filteredOperations = computed(() => {
  const kw = opKeyword.value.trim().toLowerCase()
  if (!kw) return operations.value
  return operations.value.filter((row) => [row.operation_code, row.operation_name, row.category, row.required_skill].some((v) => String(v || '').toLowerCase().includes(kw)))
})
const filteredPositions = computed(() => {
  const kw = posKeyword.value.trim().toLowerCase()
  if (!kw) return positions.value
  return positions.value.filter((row) => [row.position_code, row.position_name, row.department, row.skill_category].some((v) => String(v || '').toLowerCase().includes(kw)))
})

async function loadAll() {
  loading.value = true
  try {
    const [ov, ops, pos] = await Promise.all([
      Api.get('/process-master/overview'),
      Api.get('/process-master/operations', { params: { include_inactive: 1 } }),
      Api.get('/process-master/positions', { params: { include_inactive: 1 } }),
    ])
    overview.value = ov || {}
    operations.value = ops.items || []
    positions.value = pos.items || []
  } finally {
    loading.value = false
  }
}

function openOperation(row?: any) {
  opDlg.form = row ? { ...row, qc_required: !!row.qc_required, sop_required: !!row.sop_required, drawing_required: !!row.drawing_required, is_active: !!row.is_active } : {
    operation_code: '',
    operation_name: '',
    operation_type: 'make',
    category: 'general',
    default_station_type: '',
    required_skill: '',
    required_position_code: '',
    standard_hours: 0,
    worker_count: 1,
    qc_required: false,
    sop_required: true,
    drawing_required: true,
    sequence_hint: 1,
    description: '',
    is_active: true,
  }
  opDlg.visible = true
}

async function saveOperation() {
  if (!opDlg.form.operation_code || !opDlg.form.operation_name) return ElMessage.warning('请填写工序编码和名称')
  opDlg.saving = true
  try {
    if (opDlg.form.id) await Api.put('/process-master/operations/' + opDlg.form.id, opDlg.form)
    else await Api.post('/process-master/operations', opDlg.form)
    ElMessage.success('工序模板已保存')
    opDlg.visible = false
    await loadAll()
  } finally {
    opDlg.saving = false
  }
}

async function deleteOperation(row: any) {
  try {
    await ElMessageBox.confirm(`确定删除/停用工序模板 ${row.operation_name}？`, '确认', { type: 'warning' })
    await Api.del('/process-master/operations/' + row.id)
    ElMessage.success('已处理')
    await loadAll()
  } catch (e: any) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(e?.response?.data?.message || e.message || '操作失败')
  }
}

function openPosition(row?: any) {
  posDlg.form = row ? { ...row, is_active: !!row.is_active } : {
    position_code: '',
    position_name: '',
    department: '',
    skill_category: 'general',
    min_level: 1,
    required_cert_type: '',
    description: '',
    is_active: true,
  }
  posDlg.visible = true
}

async function savePosition() {
  if (!posDlg.form.position_code || !posDlg.form.position_name) return ElMessage.warning('请填写岗位编码和名称')
  posDlg.saving = true
  try {
    if (posDlg.form.id) await Api.put('/process-master/positions/' + posDlg.form.position_code, posDlg.form)
    else await Api.post('/process-master/positions', posDlg.form)
    ElMessage.success('岗位已保存')
    posDlg.visible = false
    await loadAll()
  } finally {
    posDlg.saving = false
  }
}

async function deletePosition(row: any) {
  try {
    await ElMessageBox.confirm(`确定删除岗位 ${row.position_name}？已被引用的岗位会被后端拦截。`, '确认', { type: 'warning' })
    await Api.del('/process-master/positions/' + row.position_code)
    ElMessage.success('已删除')
    await loadAll()
  } catch (e: any) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(e?.response?.data?.message || e.message || '操作失败')
  }
}

async function validateAssignment() {
  if (!validationForm.process_node_id || !validationForm.user_id) return ElMessage.warning('请填写节点ID和人员ID')
  validationResult.value = await Api.post('/process-master/validate-assignment', validationForm)
}

onMounted(loadAll)
</script>

<style scoped>
.page { padding: 16px; }
.page-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 12px; }
.page-title { font-size: 20px; font-weight: 700; }
.page-subtitle { color: var(--color-text-muted); margin-top: 4px; }
.toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; }
</style>
