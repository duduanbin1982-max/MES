<template>
  <div>
    <el-dialog v-model="visible" title="项目装备创建向导" width="900px" destroy-on-close>
      <el-alert
        title="向导会生成合同、里程碑、BOM 空壳和文档目录；也可以从正式项目模板或历史 TBM 复制结构。"
        type="info"
        show-icon
        :closable="false"
        style="margin-bottom: 14px"
      />
      <el-steps :active="wizardStep" finish-status="success" simple style="margin-bottom: 18px">
        <el-step title="编码合同" />
        <el-step title="模板来源" />
        <el-step title="初始化范围" />
      </el-steps>

      <el-form :model="newInst" label-width="120px">
        <div v-show="wizardStep === 0" class="wizard-grid">
          <el-form-item label="客户" required>
            <el-input v-model="newInst.customer_name" placeholder="如 郑州地铁集团" @blur="refreshCode" />
          </el-form-item>
          <el-form-item label="年份">
            <el-input-number v-model="codeYear" :min="2020" :max="2099" @change="refreshCode" />
          </el-form-item>
          <el-form-item label="项目装备编码" required>
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
          <el-form-item label="项目装备名称" required>
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
          <el-form-item label="模板来源" class="wide">
            <el-radio-group v-model="templateSourceMode" @change="handleTemplateModeChange">
              <el-radio-button label="template">项目模板</el-radio-button>
              <el-radio-button label="history">历史项目装备</el-radio-button>
              <el-radio-button label="none">空白初始化</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="templateSourceMode === 'template'" label="项目模板" class="wide">
            <div class="template-select-row">
              <el-select
                v-model="newInst.template_id"
                clearable
                filterable
                placeholder="选择已发布模板"
                style="width: 100%"
                @change="applySelectedTemplate"
              >
                <el-option
                  v-for="tpl in templates"
                  :key="tpl.id"
                  :label="`${tpl.template_code} · ${tpl.template_name} · ${tpl.version}`"
                  :value="tpl.id"
                />
              </el-select>
              <el-button @click="openTemplateDialog">新建模板</el-button>
            </div>
          </el-form-item>
          <el-form-item v-if="templateSourceMode === 'history'" label="历史项目装备" class="wide">
            <el-select
              v-model="newInst.template_instance_id"
              clearable
              filterable
              placeholder="从历史 TBM 复制 BOM、工艺、里程碑结构"
              style="width: 100%"
              @change="handleHistoryTemplateChange"
            >
              <el-option v-for="row in rows" :key="row.id" :label="`${row.instance_code} · ${row.instance_name || row.customer_name}`" :value="row.id" />
            </el-select>
          </el-form-item>
          <el-card v-if="templateSourceMode === 'template' && selectedTemplate" shadow="never" class="template-preview wide">
            <div class="template-preview-title">
              {{ selectedTemplate.template_name }}
              <el-tag size="small" type="success">{{ selectedTemplate.version }}</el-tag>
              <el-tag v-if="selectedTemplate.source_instance_code" size="small" type="info">来源 {{ selectedTemplate.source_instance_code }}</el-tag>
              <el-tag v-else size="small" type="warning">空白标准模板</el-tag>
            </div>
            <div class="template-preview-desc">{{ selectedTemplate.description || '按模板范围初始化项目装备结构。' }}</div>
            <div class="template-scope">
              <el-tag v-for="key in selectedTemplate.copy_scope_keys || []" :key="key" size="small">
                {{ scopeLabel(key) }}
              </el-tag>
            </div>
          </el-card>
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
                <el-checkbox v-model="newInst.copy_template_bom" :disabled="!hasTemplateCopySource">复制完整 BOM</el-checkbox>
                <el-checkbox v-model="newInst.copy_template_process" :disabled="!hasTemplateCopySource">复制工艺路线</el-checkbox>
                <el-checkbox v-model="newInst.copy_template_milestones" :disabled="!hasTemplateCopySource">复制里程碑结构</el-checkbox>
                <div class="copy-hint" v-if="!hasTemplateCopySource">当前模板没有历史来源，将只执行默认初始化。</div>
              </el-card>
            </el-col>
          </el-row>
          <el-form-item label="备注" style="margin-top: 14px">
            <el-input v-model="newInst.notes" type="textarea" :rows="3" placeholder="项目特殊要求、交付边界、客户约束等" />
          </el-form-item>
        </div>
      </el-form>

      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button :disabled="wizardStep === 0" @click="wizardStep--">上一步</el-button>
        <el-button v-if="wizardStep < 2" type="primary" @click="nextStep">下一步</el-button>
        <el-button v-else type="primary" :loading="creating" @click="createInstance">创建并初始化</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showTemplateForm" title="新建项目装备模板" width="760px" destroy-on-close>
      <el-alert
        title="模板只复制结构、标准和目录；不会复制采购单、工单、质检记录、实际成本和异常记录。"
        type="warning"
        show-icon
        :closable="false"
        style="margin-bottom: 14px"
      />
      <el-form :model="templateForm" label-width="110px">
        <div class="wizard-grid">
          <el-form-item label="模板名称" required>
            <el-input v-model="templateForm.template_name" placeholder="如 TBM 标准交付模板" />
          </el-form-item>
          <el-form-item label="模板编码">
            <el-input v-model="templateForm.template_code" placeholder="留空自动生成" />
          </el-form-item>
          <el-form-item label="分类">
            <el-input v-model="templateForm.category" placeholder="TBM / 盾构机 / 主驱动" />
          </el-form-item>
          <el-form-item label="版本">
            <el-input v-model="templateForm.version" placeholder="A0" />
          </el-form-item>
          <el-form-item label="模板来源" class="wide">
            <el-radio-group v-model="templateFormSourceMode" @change="handleTemplateFormSourceChange">
              <el-radio-button label="empty">空白标准模板</el-radio-button>
              <el-radio-button label="instance">从历史项目生成</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="templateFormSourceMode === 'instance'" label="来源项目" class="wide">
            <el-select v-model="templateForm.source_instance_id" clearable filterable placeholder="选择已交付或成熟项目装备" style="width: 100%">
              <el-option v-for="row in rows" :key="row.id" :label="`${row.instance_code} · ${row.instance_name || row.customer_name}`" :value="row.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="模板状态">
            <el-select v-model="templateForm.status" style="width: 100%">
              <el-option label="已发布，可用于创建" value="published" />
              <el-option label="草稿" value="draft" />
            </el-select>
          </el-form-item>
          <el-form-item label="复制范围" class="wide">
            <el-checkbox-group v-model="templateForm.copy_scope">
              <el-checkbox v-for="option in templateScopeOptions" :key="option.key" :label="option.key">
                {{ option.label }}
              </el-checkbox>
            </el-checkbox-group>
          </el-form-item>
          <el-form-item label="说明" class="wide">
            <el-input v-model="templateForm.description" type="textarea" :rows="3" placeholder="适用机型、复制边界、注意事项" />
          </el-form-item>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="showTemplateForm = false">取消</el-button>
        <el-button type="primary" :loading="templateSaving" @click="saveTemplate">保存模板</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Api } from '../../api'
import {
  applyHistoryTemplate,
  applyTemplateScope,
  buildCreatePayload,
  buildTemplatePayload,
  defaultNewInstanceForm,
  defaultTemplateForm,
  deriveProjectNo,
  deriveSerialNo,
  resetForSourceMode,
  scopeCopyListFor,
  validateWizardStep,
} from '../../domain/equipmentInstanceCreate'

const props = withDefaults(defineProps<{
  modelValue: boolean
  types: any[]
  rows: any[]
}>(), {
  types: () => [],
  rows: () => [],
})

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'created', id: number): void
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const types = computed(() => props.types || [])
const rows = computed(() => props.rows || [])
const models = ref<any[]>([])
const templates = ref<any[]>([])
const templateScopeOptions = ref<any[]>([
  { key: 'milestones', label: '里程碑' },
  { key: 'bom_shell', label: 'BOM 空壳' },
  { key: 'bom', label: '完整 BOM' },
  { key: 'process', label: '工艺路线' },
  { key: 'doc_dirs', label: '文档目录' },
])

const creating = ref(false)
const wizardStep = ref(0)
const codeYear = ref(new Date().getFullYear())
const defaultNewInst = defaultNewInstanceForm
const newInst = reactive<any>(defaultNewInst())
const dateRange = ref<[string, string] | null>(null)
const templateSourceMode = ref<'template' | 'history' | 'none'>('template')
const selectedTemplate = computed(() => templates.value.find((tpl: any) => tpl.id === newInst.template_id) || null)
const hasTemplateCopySource = computed(() => {
  if (templateSourceMode.value === 'history') return !!newInst.template_instance_id
  if (templateSourceMode.value === 'template') return !!selectedTemplate.value?.source_instance_id
  return false
})

const showTemplateForm = ref(false)
const templateSaving = ref(false)
const templateFormSourceMode = ref<'empty' | 'instance'>('empty')
const defaultTemplateFormDefault = defaultTemplateForm
const templateForm = reactive<any>(defaultTemplateFormDefault())

const loadTemplates = async () => {
  try { templates.value = await Api.equipmentInstanceTemplates({ status: 'published' }) } catch (error: any) { ElMessage.error('加载项目模板失败: ' + (error?.message || error)) }
}
const loadTemplateScopeOptions = async () => {
  try { templateScopeOptions.value = await Api.equipmentInstanceTemplateScopeOptions() } catch { /* fallback above */ }
}
const loadModels = async () => {
  try {
    if (!newInst.equipment_type_id) { models.value = []; return }
    models.value = await Api.equipmentModels(newInst.equipment_type_id)
  } catch (error: any) {
    ElMessage.error('加载型号失败: ' + (error?.message || error))
  }
}

const prepareOpen = async () => {
  Object.assign(newInst, defaultNewInst())
  dateRange.value = null
  models.value = []
  templateSourceMode.value = 'template'
  wizardStep.value = 0
  await Promise.all([loadTemplates(), loadTemplateScopeOptions()])
  if (templates.value.length) {
    newInst.template_id = templates.value[0].id
    applySelectedTemplate()
  }
  await refreshCode()
}

watch(() => props.modelValue, async (next) => {
  if (next) await prepareOpen()
})

const refreshCode = async () => {
  try {
    const result: any = await Api.instanceCodePreview({ customer: newInst.customer_name, year: codeYear.value })
    newInst.instance_code = result.code
    if (!newInst.project_no) newInst.project_no = deriveProjectNo(result.code, codeYear.value)
    if (!newInst.serial_no) newInst.serial_no = deriveSerialNo(result.code, codeYear.value)
  } catch (error: any) {
    ElMessage.error('生成编码失败: ' + (error?.message || error))
  }
}

const nextStep = () => {
  const problem = validateWizardStep(wizardStep.value, newInst)
  if (problem) {
    ElMessage.warning(problem)
    return
  }
  wizardStep.value++
}

const createInstance = async () => {
  creating.value = true
  try {
    const payload: any = buildCreatePayload(newInst, {
      sourceMode: templateSourceMode.value,
      dateRange: dateRange.value,
    })
    // 2026-11-08：预览码只是展示；提交前预约，避免并发预览→创建撞唯一约束
    try {
      const reservation: any = await Api.post('/equipment_instances/code-reserve', {
        customer: newInst.customer_name,
        year: codeYear.value,
      })
      if (reservation?.code && reservation?.reservation_token) {
        payload.instance_code = reservation.code
        payload.code_reservation_id = reservation.reservation_token
      }
    } catch (_error) { /* 规则关闭时回退到当前编码 */ }
    const result: any = await Api.post('/equipment_instances', payload)
    ElMessage.success('创建成功，已生成默认交付骨架')
    visible.value = false
    emit('created', result.id)
  } finally {
    creating.value = false
  }
}

const handleTemplateModeChange = () => {
  if (templateSourceMode.value === 'none') {
    resetForSourceMode(newInst)
    return
  }
  if (templateSourceMode.value === 'history') {
    newInst.template_id = undefined
    handleHistoryTemplateChange()
    return
  }
  newInst.template_instance_id = undefined
  if (!newInst.template_id && templates.value.length) newInst.template_id = templates.value[0].id
  applySelectedTemplate()
}

const applySelectedTemplate = () => {
  const tpl = selectedTemplate.value
  if (!tpl) return
  applyTemplateScope(newInst, tpl)
}

const handleHistoryTemplateChange = () => {
  applyHistoryTemplate(newInst)
}

const scopeLabel = (key: string) => templateScopeOptions.value.find((option: any) => option.key === key)?.label || key

const openTemplateDialog = () => {
  Object.assign(templateForm, defaultTemplateFormDefault())
  templateFormSourceMode.value = 'empty'
  showTemplateForm.value = true
}

const handleTemplateFormSourceChange = () => {
  templateForm.source_instance_id = undefined
  templateForm.copy_scope = scopeCopyListFor(templateFormSourceMode.value)
}

const saveTemplate = async () => {
  if (!templateForm.template_name) {
    ElMessage.warning('请填写模板名称')
    return
  }
  if (templateFormSourceMode.value === 'instance' && !templateForm.source_instance_id) {
    ElMessage.warning('请选择来源项目装备')
    return
  }
  templateSaving.value = true
  try {
    const payload = buildTemplatePayload(templateForm, templateFormSourceMode.value)
    const result: any = await Api.createEquipmentInstanceTemplate(payload)
    ElMessage.success('项目装备模板已创建')
    showTemplateForm.value = false
    await loadTemplates()
    templateSourceMode.value = 'template'
    newInst.template_id = result.id
    applySelectedTemplate()
  } finally {
    templateSaving.value = false
  }
}
</script>

<style scoped>
.wizard-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
.wizard-grid .wide { grid-column: 1 / span 2; }
.template-select-row { display: flex; gap: 8px; width: 100%; }
.template-preview { margin-bottom: 12px; }
.template-preview-title { display: flex; align-items: center; gap: 8px; font-weight: 700; margin-bottom: 6px; }
.template-preview-desc, .copy-hint { color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.5; }
.template-scope { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
</style>
