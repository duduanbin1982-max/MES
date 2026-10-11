// frontend/src/domain/equipmentInstanceCreate.ts
//
// "新建项目装备"向导的纯逻辑：初始表单、复制范围推导、创建 payload 裁剪、
// 分步校验、编码派生。2026-10-11 从
// frontend/src/views/equipment/EquipmentInstanceCreateDialog.vue 抽出。
//
// 抽出的理由：这些规则决定了"发给后端的字段到底有哪些"，
// 之前只能靠点 UI 验证；现在可以逐个断言（见 frontend/tests/domain/equipmentInstanceCreate.test.ts）。
// 按 frontend/src/domain 层约束，这里不 import vue / element-plus / api。

export type SourceMode = "template" | "history" | "none"

export interface InstanceDraft {
  instance_code: string
  project_no: string
  instance_name: string
  equipment_type_id?: number
  equipment_model_id?: number
  customer_name: string
  customer_contact: string
  site_location: string
  contract_no: string
  serial_no: string
  contract_amount?: number
  template_id?: number
  template_instance_id?: number
  generate_milestones: boolean
  create_bom_shell: boolean
  create_doc_dirs: boolean
  copy_template_bom: boolean
  copy_template_process: boolean
  copy_template_milestones: boolean
  notes: string
  [key: string]: unknown
}

/** 向导表单初值（原 defaultNewInst） */
export function defaultNewInstanceForm(): InstanceDraft {
  return {
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
    template_id: undefined,
    template_instance_id: undefined,
    generate_milestones: true,
    create_bom_shell: true,
    create_doc_dirs: true,
    copy_template_bom: false,
    copy_template_process: false,
    copy_template_milestones: false,
    notes: '',
  }
}

/** 模板表单初值（原 defaultTemplateForm） */
export function defaultTemplateForm() {
  return {
    template_code: '',
    template_name: '',
    category: 'TBM',
    version: 'A0',
    source_instance_id: undefined as number | undefined,
    status: 'published',
    copy_scope: ['milestones', 'bom_shell', 'doc_dirs'] as string[],
    description: '',
  }
}

/** 由 instance_code 派生项目号：PRJ-<year>-<code 最后一段> */
export function deriveProjectNo(instanceCode: string, year: number): string {
  return `PRJ-${year}-${String(instanceCode).split('-').pop()}`
}

/** 由 instance_code 派生序列号：SN-<year>-<code 最后一段> */
export function deriveSerialNo(instanceCode: string, year: number): string {
  return `SN-${year}-${String(instanceCode).split('-').pop()}`
}

/** 向导分步校验；返回提示文案，null 表示可以进入下一步 */
export function validateWizardStep(step: number, form: InstanceDraft): string | null {
  if (step === 0 && (!form.instance_code || !form.customer_name || !form.instance_name)) {
    return '请先填写客户、项目装备编码和项目装备名称'
  }
  if (step === 1 && !form.equipment_model_id) {
    return '请选择产品类型和型号'
  }
  return null
}

/** 选定模板后，把模板的 copy_scope 展开成表单上的各个开关（原 applySelectedTemplate） */
export function applyTemplateScope(form: InstanceDraft, template: any): void {
  const scope = (template?.copy_scope || {}) as Record<string, unknown>
  form.template_instance_id = template?.source_instance_id || undefined
  form.generate_milestones = scope.milestones !== false
  form.create_bom_shell = !!scope.bom_shell
  form.create_doc_dirs = scope.doc_dirs !== false
  form.copy_template_bom = !!template?.source_instance_id && !!scope.bom
  form.copy_template_process = !!template?.source_instance_id && !!scope.process
  form.copy_template_milestones = !!template?.source_instance_id && !!scope.milestones
}

/** 选"历史项目"时，复制开关一律跟随 template_instance_id（原 handleHistoryTemplateChange） */
export function applyHistoryTemplate(form: InstanceDraft): void {
  form.generate_milestones = true
  form.create_bom_shell = false
  form.create_doc_dirs = true
  form.copy_template_bom = !!form.template_instance_id
  form.copy_template_process = !!form.template_instance_id
  form.copy_template_milestones = !!form.template_instance_id
}

/** 选"不使用模板"时把复制相关字段全部复位（原 handleTemplateModeChange 的 none 分支） */
export function resetForSourceMode(form: InstanceDraft): void {
  form.template_id = undefined
  form.template_instance_id = undefined
  form.generate_milestones = true
  form.create_bom_shell = true
  form.create_doc_dirs = true
  form.copy_template_bom = false
  form.copy_template_process = false
  form.copy_template_milestones = false
}

/**
 * 创建项目装备时真正发给后端的 payload（原 createInstance 里的裁剪逻辑）：
 *   - 恒带 wizard: true
 *   - none   : 去掉 template_id / template_instance_id，且三个 copy_* 置 false
 *   - history: 去掉 template_id（只按 template_instance_id 复制）
 *   - 有 dateRange 时补 planned_start / planned_end
 *   - 恒去掉 equipment_type_id（后端按 model 反查）
 */
export function buildCreatePayload(
  form: InstanceDraft,
  options: { sourceMode: SourceMode; dateRange?: [string, string] | null },
): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...form, wizard: true }
  if (options.sourceMode === 'none') {
    delete payload.template_id
    delete payload.template_instance_id
    payload.copy_template_bom = false
    payload.copy_template_process = false
    payload.copy_template_milestones = false
  }
  if (options.sourceMode === 'history') delete payload.template_id
  if (options.dateRange) {
    payload.planned_start = options.dateRange[0]
    payload.planned_end = options.dateRange[1]
  }
  delete payload.equipment_type_id
  return payload
}

/** 新建模板时发给后端的 payload（原 saveTemplate 里的裁剪逻辑） */
export function buildTemplatePayload(form: Record<string, any>, sourceMode: "empty" | "instance"): Record<string, unknown> {
  return {
    ...form,
    source_instance_id: sourceMode === 'instance' ? form.source_instance_id : undefined,
  }
}

/** 模板来源切换时默认勾选的复制范围 */
export function scopeCopyListFor(sourceMode: "empty" | "instance"): string[] {
  return sourceMode === 'instance'
    ? ['milestones', 'bom', 'process', 'doc_dirs']
    : ['milestones', 'bom_shell', 'doc_dirs']
}
