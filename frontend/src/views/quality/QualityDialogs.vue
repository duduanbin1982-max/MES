<template>
  <div>
    <el-dialog v-model="createModel" title="新建质检记录" width="500px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="实例" required><el-select v-model="form.equipment_instance_id" placeholder="选实例" class="full"><el-option v-for="item in instances" :key="item.id" :label="item.instance_code + ' | ' + (item.instance_name || '')" :value="item.id" /></el-select></el-form-item>
        <el-form-item label="工单"><el-select v-model="form.work_order_id" clearable class="full"><el-option v-for="workOrder in workOrders" :key="workOrder.id" :label="workOrder.wo_code" :value="workOrder.id" /></el-select></el-form-item>
        <el-form-item label="检验类型" required><el-select v-model="form.inspection_type" class="full"><el-option v-for="type in types" :key="type.value" :label="type.label" :value="type.value" /></el-select></el-form-item>
        <el-form-item label="结果" required><el-radio-group v-model="form.result"><el-radio-button label="pass">通过</el-radio-button><el-radio-button label="fail">不通过</el-radio-button></el-radio-group></el-form-item>
        <el-form-item label="检验员"><el-select v-model="form.inspector_id" class="full"><el-option v-for="user in users" :key="user.id" :label="user.full_name" :value="user.id" /></el-select></el-form-item>
        <el-form-item label="备注"><el-input v-model="form.notes" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="createModel = false">取消</el-button><el-button type="primary" @click="$emit('submit')" :loading="submitting">提交</el-button></template>
    </el-dialog>

    <el-dialog v-model="ncrCreateModel" title="新建不合格品报告" width="500px">
      <el-form :model="ncrForm" label-width="100px">
        <el-form-item label="来源类型" required><el-select v-model="ncrForm.source_type" class="full"><el-option label="来料检验" value="incoming" /><el-option label="工序检验" value="in_process" /><el-option label="终检" value="final" /><el-option label="客户投诉" value="customer" /><el-option label="其他" value="other" /></el-select></el-form-item>
        <el-form-item label="零件名称" required><el-input v-model="ncrForm.part_name" placeholder="输入零件名称" /></el-form-item>
        <el-form-item label="缺陷描述" required><el-input v-model="ncrForm.defect_desc" type="textarea" :rows="3" placeholder="描述缺陷情况" /></el-form-item>
        <el-form-item label="缺陷数量"><el-input-number v-model="ncrForm.defect_qty" :min="1" class="full" /></el-form-item>
        <el-form-item label="严重程度" required><el-select v-model="ncrForm.severity" class="full"><el-option label="轻微 (Minor)" value="minor" /><el-option label="严重 (Major)" value="major" /><el-option label="致命 (Critical)" value="critical" /></el-select></el-form-item>
      </el-form>
      <template #footer><el-button @click="ncrCreateModel = false">取消</el-button><el-button type="primary" @click="$emit('submit-ncr')" :loading="ncrSubmitting">提交</el-button></template>
    </el-dialog>

    <el-dialog v-model="dispositionModel" title="处置不合格品" width="500px">
      <el-form :model="dispositionForm" label-width="100px">
        <el-form-item label="NCR编号"><span>{{ dispositionNcr?.ncr_code }}</span></el-form-item>
        <el-form-item label="处置方式" required><el-select v-model="dispositionForm.disposition" class="full"><el-option label="让步接收 (Accept)" value="accept" /><el-option label="返工 (Rework)" value="rework" /><el-option label="拒收 (Reject)" value="reject" /></el-select></el-form-item>
        <el-form-item label="处置原因"><el-input v-model="dispositionForm.reason" type="textarea" :rows="3" placeholder="处置理由" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dispositionModel = false">取消</el-button><el-button type="primary" @click="$emit('submit-disposition')" :loading="dispSubmitting">确认处置</el-button></template>
    </el-dialog>

    <el-dialog v-model="capaModel" title="CAPA 纠正预防措施" width="700px">
      <div class="dialog-intro"><strong>NCR: {{ capaNcr?.ncr_code }}</strong> — {{ capaNcr?.defect_desc }}</div>
      <el-table :data="capaItems" stripe size="small" max-height="250">
        <el-table-column prop="action_type" label="类型" width="100" />
        <el-table-column prop="action_desc" label="描述" min-width="200" show-overflow-tooltip />
        <el-table-column prop="assignee_name" label="负责人" width="100" />
        <el-table-column prop="due_date" label="截止" width="110" />
        <el-table-column label="状态" width="80"><template #default="{ row }"><el-tag :type="row.status === 'closed' ? 'success' : 'warning'" size="small">{{ row.status === 'closed' ? '完成' : '进行' }}</el-tag></template></el-table-column>
      </el-table>
      <el-divider />
      <el-form :model="capaAddForm" inline>
        <el-form-item label="类型"><el-select v-model="capaAddForm.action_type" class="capa-type"><el-option label="纠正" value="correction" /><el-option label="预防" value="prevention" /></el-select></el-form-item>
        <el-form-item label="描述"><el-input v-model="capaAddForm.action_desc" placeholder="措施描述" class="capa-desc" /></el-form-item>
        <el-form-item label="负责人"><el-select v-model="capaAddForm.assigned_to" placeholder="负责人" class="capa-user"><el-option v-for="user in users" :key="user.id" :label="user.full_name" :value="user.id" /></el-select></el-form-item>
        <el-form-item label="截止"><el-date-picker v-model="capaAddForm.due_date" type="date" placeholder="选择日期" class="capa-date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item><el-button type="primary" @click="$emit('add-capa-item')" :loading="capaAdding">添加</el-button></el-form-item>
      </el-form>
    </el-dialog>

    <el-dialog v-model="closureModel" title="NCR 质量闭环" width="780px">
      <div v-if="closure.ncr">
        <el-alert :type="closure.can_close ? 'success' : 'warning'" :closable="false" class="section-gap">
          <template #title>{{ closure.ncr.ncr_code }}：{{ closure.can_close ? '已满足关闭条件' : '请完成处置、CAPA 和复检' }}</template>
        </el-alert>
        <el-steps :active="closureStep" finish-status="success" process-status="process" simple class="section-gap">
          <el-step title="处置" />
          <el-step title="CAPA" />
          <el-step title="复检" />
          <el-step title="关闭" />
        </el-steps>
        <el-descriptions :column="2" border size="small" class="section-gap">
          <el-descriptions-item label="缺陷">{{ closure.ncr.defect_desc }}</el-descriptions-item>
          <el-descriptions-item label="处置">{{ dispositionLabel(closure.ncr.disposition) }}</el-descriptions-item>
          <el-descriptions-item label="CAPA关闭">{{ closure.checklist?.capa_all_closed ? '是' : '否' }}</el-descriptions-item>
          <el-descriptions-item label="复检通过">{{ closure.checklist?.recheck_passed ? '是' : '否' }}</el-descriptions-item>
        </el-descriptions>
        <el-table :data="closure.capa_actions || []" size="small" max-height="180" class="section-gap">
          <el-table-column prop="action_desc" label="CAPA措施" min-width="220" />
          <el-table-column prop="assignee_name" label="负责人" width="100" />
          <el-table-column prop="due_date" label="截止" width="110" />
          <el-table-column label="状态" width="90"><template #default="{ row }"><el-tag :type="row.status === 'closed' ? 'success' : 'warning'" size="small">{{ row.status === 'closed' ? '已完成' : '进行中' }}</el-tag></template></el-table-column>
        </el-table>
        <el-table :data="closure.rechecks || []" size="small" max-height="160" empty-text="暂无复检记录">
          <el-table-column prop="result" label="复检结果" width="100"><template #default="{ row }"><el-tag :type="row.result === 'pass' ? 'success' : 'danger'" size="small">{{ row.result === 'pass' ? '通过' : '不通过' }}</el-tag></template></el-table-column>
          <el-table-column prop="inspector_name" label="检验员" width="100" />
          <el-table-column prop="notes" label="说明" min-width="180" />
          <el-table-column prop="created_at" label="时间" width="160" />
        </el-table>
        <el-divider />
        <el-form :model="recheckForm" inline>
          <el-form-item label="复检结果"><el-select v-model="recheckForm.result" class="recheck-result"><el-option label="通过" value="pass" /><el-option label="不通过" value="fail" /></el-select></el-form-item>
          <el-form-item label="检验员"><el-select v-model="recheckForm.inspector_id" clearable class="recheck-user"><el-option v-for="user in users" :key="user.id" :label="user.full_name" :value="user.id" /></el-select></el-form-item>
          <el-form-item label="说明"><el-input v-model="recheckForm.notes" class="recheck-notes" /></el-form-item>
          <el-form-item><el-button type="primary" @click="$emit('submit-recheck')" :loading="closureLoading">登记复检</el-button></el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-input v-model="closeNoteModel" placeholder="关闭说明/质量损失/影响说明" class="close-note" />
        <el-button @click="closureModel = false">取消</el-button>
        <el-button type="success" :disabled="!closure.can_close" @click="$emit('close-ncr')" :loading="closureLoading">关闭NCR</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="templateCreateModel" title="新建检验模板" width="500px">
      <el-form :model="templateForm" label-width="100px">
        <el-form-item label="模板名称" required><el-input v-model="templateForm.template_name" placeholder="输入模板名称" /></el-form-item>
        <el-form-item label="设备类型"><el-select v-model="templateForm.equipment_type" class="full" placeholder="选择设备类型"><el-option v-for="type in equipmentTypes" :key="type" :label="type" :value="type" /></el-select></el-form-item>
        <el-form-item label="分类"><el-input v-model="templateForm.category" placeholder="如: 尺寸检验、外观检验" /></el-form-item>
        <el-form-item label="检验项目"><el-input v-model="templateForm.check_items" type="textarea" :rows="6" placeholder="每行一个检验项目" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="templateCreateModel = false">取消</el-button><el-button type="primary" @click="$emit('submit-template')" :loading="templateSubmitting">提交</el-button></template>
    </el-dialog>

    <el-dialog v-model="templateItemsModel" title="检验项目明细" width="500px">
      <div class="dialog-intro"><strong>模板: </strong>{{ templateItemsTemplate?.template_name }}</div>
      <el-table :data="templateItemsList" size="small" max-height="350">
        <el-table-column type="index" label="#" width="50" />
        <el-table-column prop="name" label="检验项目" />
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  showCreate: boolean
  showNcrCreate: boolean
  showDisposition: boolean
  showCapaDialog: boolean
  showClosureDialog: boolean
  showTemplateCreate: boolean
  showTemplateItems: boolean
  closeNote: string
  instances: any[]
  workOrders: any[]
  users: any[]
  types: Array<{ value: string, label: string }>
  equipmentTypes: string[]
  submitting: boolean
  ncrSubmitting: boolean
  dispSubmitting: boolean
  dispositionNcr: any
  capaNcr: any
  capaItems: any[]
  capaAdding: boolean
  closure: any
  closureStep: number
  closureLoading: boolean
  templateSubmitting: boolean
  templateItemsTemplate: any
  templateItemsList: Array<{ name: string }>
  dispositionLabel: (value: string) => string
}>()

// 2026-10-17（前端 eslint 棘轮）：表单对象改为 defineModel ——
// 父组件用 v-model:form / v-model:ncr-form … 绑定；子组件只在模板里改写字段，
// 改的仍是父组件那个对象（行为与改造前完全一致），但不再触发 vue/no-mutating-props。
const form = defineModel<Record<string, any>>('form', { required: true })
const ncrForm = defineModel<Record<string, any>>('ncrForm', { required: true })
const dispositionForm = defineModel<Record<string, any>>('dispositionForm', { required: true })
const capaAddForm = defineModel<Record<string, any>>('capaAddForm', { required: true })
const recheckForm = defineModel<Record<string, any>>('recheckForm', { required: true })
const templateForm = defineModel<Record<string, any>>('templateForm', { required: true })

const emit = defineEmits<{
  (event: 'update:showCreate', value: boolean): void
  (event: 'update:showNcrCreate', value: boolean): void
  (event: 'update:showDisposition', value: boolean): void
  (event: 'update:showCapaDialog', value: boolean): void
  (event: 'update:showClosureDialog', value: boolean): void
  (event: 'update:showTemplateCreate', value: boolean): void
  (event: 'update:showTemplateItems', value: boolean): void
  (event: 'update:closeNote', value: string): void
  (event: 'submit'): void
  (event: 'submit-ncr'): void
  (event: 'submit-disposition'): void
  (event: 'add-capa-item'): void
  (event: 'submit-recheck'): void
  (event: 'close-ncr'): void
  (event: 'submit-template'): void
}>()

const model = (key: keyof typeof props, event: string) => computed({
  get: () => props[key] as any,
  set: (value) => emit(event as any, value)
})

const createModel = model('showCreate', 'update:showCreate')
const ncrCreateModel = model('showNcrCreate', 'update:showNcrCreate')
const dispositionModel = model('showDisposition', 'update:showDisposition')
const capaModel = model('showCapaDialog', 'update:showCapaDialog')
const closureModel = model('showClosureDialog', 'update:showClosureDialog')
const templateCreateModel = model('showTemplateCreate', 'update:showTemplateCreate')
const templateItemsModel = model('showTemplateItems', 'update:showTemplateItems')
const closeNoteModel = model('closeNote', 'update:closeNote')
</script>

<style scoped>
.full{width:100%}
.dialog-intro{margin-bottom:12px}
.section-gap{margin-bottom:12px}
.capa-type{width:110px}
.capa-desc{width:180px}
.capa-user{width:130px}
.capa-date{width:140px}
.recheck-result{width:110px}
.recheck-user{width:130px}
.recheck-notes{width:220px}
.close-note{width:360px;margin-right:8px}
</style>
