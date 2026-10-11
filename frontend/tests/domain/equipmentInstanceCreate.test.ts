// frontend/tests/domain/equipmentInstanceCreate.test.ts
//
// "新建项目装备"向导抽出的 domain 逻辑的无浏览器回归。
// 重点守住的是"发给后端的 payload 到底长什么样" —— 以前只能点 UI 看。

import test from "node:test"
import assert from "node:assert/strict"

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
} from "../../src/domain/equipmentInstanceCreate.ts"

test("EIC.1 向导表单初值与原来逐字段一致", () => {
  const form = defaultNewInstanceForm()
  assert.deepEqual(form, {
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
  })
  // 每次调用都应是新对象（原来就是工厂函数）
  assert.notEqual(defaultNewInstanceForm(), form)
  assert.deepEqual(defaultTemplateForm().copy_scope, ['milestones', 'bom_shell', 'doc_dirs'])
  assert.equal(defaultTemplateForm().version, 'A0')
})

test("EIC.2 编码派生 PRJ-/SN- 取 instance_code 最后一段", () => {
  assert.equal(deriveProjectNo('TBM-2026-001', 2026), 'PRJ-2026-001')
  assert.equal(deriveSerialNo('TBM-2026-001', 2026), 'SN-2026-001')
  // 多段时只取最后一段
  assert.equal(deriveProjectNo('A-B-C-7', 2027), 'PRJ-2027-7')
  // 没有 '-' 时整串当末段
  assert.equal(deriveSerialNo('X9', 2026), 'SN-2026-X9')
})

test("EIC.3 分步校验的提示文案与原来一字不差", () => {
  const form = defaultNewInstanceForm()
  assert.equal(validateWizardStep(0, form), '请先填写客户、项目装备编码和项目装备名称')
  form.instance_code = 'TBM-2026-001'
  assert.equal(validateWizardStep(0, form), '请先填写客户、项目装备编码和项目装备名称')
  form.customer_name = '甲客户'
  assert.equal(validateWizardStep(0, form), '请先填写客户、项目装备编码和项目装备名称')
  form.instance_name = '一号机'
  assert.equal(validateWizardStep(0, form), null)
  assert.equal(validateWizardStep(1, form), '请选择产品类型和型号')
  form.equipment_model_id = 3
  assert.equal(validateWizardStep(1, form), null)
  // 其它步骤不校验
  assert.equal(validateWizardStep(2, form), null)
})

test("EIC.4 套用模板：copy_scope 展开成各开关", () => {
  const form = defaultNewInstanceForm()
  applyTemplateScope(form, {
    id: 1,
    source_instance_id: 42,
    copy_scope: { milestones: true, bom: true, process: false, bom_shell: true, doc_dirs: false },
  })
  assert.equal(form.template_instance_id, 42)
  assert.equal(form.generate_milestones, true)
  assert.equal(form.create_bom_shell, true)
  assert.equal(form.create_doc_dirs, false)
  assert.equal(form.copy_template_bom, true)
  assert.equal(form.copy_template_process, false)
  assert.equal(form.copy_template_milestones, true)

  // 没有来源项目时，三个 copy_template_* 必须全 false（即使 scope 说有）
  const noSource = defaultNewInstanceForm()
  applyTemplateScope(noSource, { id: 2, copy_scope: { milestones: true, bom: true, process: true } })
  assert.equal(noSource.template_instance_id, undefined)
  assert.equal(noSource.copy_template_bom, false)
  assert.equal(noSource.copy_template_process, false)
  assert.equal(noSource.copy_template_milestones, false)

  // copy_scope 缺省时的默认口径：milestones/doc_dirs 视为 true，bom_shell 视为 false
  const empty = defaultNewInstanceForm()
  applyTemplateScope(empty, { id: 3 })
  assert.equal(empty.generate_milestones, true)
  assert.equal(empty.create_doc_dirs, true)
  assert.equal(empty.create_bom_shell, false)
})

test("EIC.5 历史项目 / 不用模板 两种模式的开关复位", () => {
  const form = defaultNewInstanceForm()
  form.template_instance_id = 7
  applyHistoryTemplate(form)
  assert.equal(form.generate_milestones, true)
  assert.equal(form.create_bom_shell, false)
  assert.equal(form.create_doc_dirs, true)
  assert.equal(form.copy_template_bom, true)
  assert.equal(form.copy_template_process, true)
  assert.equal(form.copy_template_milestones, true)
  // 没有 template_instance_id 时三个 copy_template_* 应为 false
  const none = defaultNewInstanceForm()
  applyHistoryTemplate(none)
  assert.equal(none.copy_template_bom, false)

  const reset = defaultNewInstanceForm()
  reset.template_id = 9
  reset.template_instance_id = 9
  reset.copy_template_bom = true
  reset.copy_template_process = true
  reset.copy_template_milestones = true
  reset.create_bom_shell = false
  resetForSourceMode(reset)
  assert.equal(reset.template_id, undefined)
  assert.equal(reset.template_instance_id, undefined)
  assert.equal(reset.generate_milestones, true)
  assert.equal(reset.create_bom_shell, true)
  assert.equal(reset.create_doc_dirs, true)
  assert.equal(reset.copy_template_bom, false)
  assert.equal(reset.copy_template_process, false)
  assert.equal(reset.copy_template_milestones, false)
})

test("EIC.6 buildCreatePayload：三种来源模式的字段裁剪", () => {
  const base = () => {
    const form = defaultNewInstanceForm()
    form.instance_code = 'TBM-2026-001'
    form.instance_name = '一号机'
    form.customer_name = '甲客户'
    form.equipment_type_id = 5
    form.equipment_model_id = 6
    form.template_id = 11
    form.template_instance_id = 22
    return form
  }

  // template 模式：两个模板字段都保留，equipment_type_id 去掉，恒带 wizard
  const tpl = buildCreatePayload(base(), { sourceMode: 'template' })
  assert.equal(tpl.wizard, true)
  assert.equal(tpl.template_id, 11)
  assert.equal(tpl.template_instance_id, 22)
  assert.ok(!('equipment_type_id' in tpl))
  assert.ok(!('planned_start' in tpl))

  // history 模式：只去掉 template_id
  const hist = buildCreatePayload(base(), { sourceMode: 'history' })
  assert.ok(!('template_id' in hist))
  assert.equal(hist.template_instance_id, 22)

  // none 模式：两个模板字段都去掉，且三个 copy_* 强制 false
  const form = base()
  form.copy_template_bom = true
  form.copy_template_process = true
  form.copy_template_milestones = true
  const none = buildCreatePayload(form, { sourceMode: 'none' })
  assert.ok(!('template_id' in none))
  assert.ok(!('template_instance_id' in none))
  assert.equal(none.copy_template_bom, false)
  assert.equal(none.copy_template_process, false)
  assert.equal(none.copy_template_milestones, false)

  // dateRange 映射成 planned_start/planned_end
  const withDates = buildCreatePayload(base(), { sourceMode: 'template', dateRange: ['2026-10-01', '2026-12-31'] })
  assert.equal(withDates.planned_start, '2026-10-01')
  assert.equal(withDates.planned_end, '2026-12-31')
  // dateRange 为 null 时不写入
  const noDates = buildCreatePayload(base(), { sourceMode: 'template', dateRange: null })
  assert.ok(!('planned_start' in noDates))

  // 原对象不能被改动（原来就是 {...newInst} 展开的副本）
  const original = base()
  const snapshot = JSON.parse(JSON.stringify(original))
  buildCreatePayload(original, { sourceMode: 'none' })
  assert.deepEqual(JSON.parse(JSON.stringify(original)), snapshot)
})

test("EIC.7 buildTemplatePayload 与模板来源切换的默认勾选", () => {
  const form = defaultTemplateForm()
  form.template_name = 'TBM 标准交付模板'
  form.source_instance_id = 42
  const fromInstance = buildTemplatePayload(form, 'instance')
  assert.equal(fromInstance.source_instance_id, 42)
  const fromEmpty = buildTemplatePayload(form, 'empty')
  assert.equal(fromEmpty.source_instance_id, undefined)
  assert.equal(fromEmpty.template_name, 'TBM 标准交付模板')

  assert.deepEqual(scopeCopyListFor('instance'), ['milestones', 'bom', 'process', 'doc_dirs'])
  assert.deepEqual(scopeCopyListFor('empty'), ['milestones', 'bom_shell', 'doc_dirs'])
})
