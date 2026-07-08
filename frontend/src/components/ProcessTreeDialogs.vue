<template>
  <!-- 编辑/新增节点 -->
  <el-dialog :model-value="showEdit" @update:model-value="(v) => $emit('update:showEdit', v)" :title="editForm.id ? '编辑节点 #' + editForm.id : '新增节点'" width="500px">
    <el-form :model="editForm" label-width="100px">
      <el-form-item label="工序模板">
        <el-select v-model="editForm.operation_template_id" clearable filterable style="width: 100%" placeholder="从标准工序库套用" @change="applyTemplate">
          <el-option
            v-for="op in operationTemplates"
            :key="op.id"
            :label="op.sequence_hint + '. ' + op.operation_name + ' / ' + (op.position_name || op.required_position_code || '未设岗位') + ' / ' + (op.standard_hours || 0) + 'h'"
            :value="op.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="操作名" required><el-input v-model="editForm.operation_name" /></el-form-item>
      <el-form-item label="工序类型">
        <el-select v-model="editForm.operation_type" style="width: 100%">
          <el-option label="制造" value="make" />
          <el-option label="采购" value="buy" />
          <el-option label="装配" value="assemble" />
          <el-option label="质检" value="qc" />
          <el-option label="测试" value="test" />
        </el-select>
      </el-form-item>
      <el-form-item label="估时(小时)"><el-input-number v-model="editForm.estimated_hours" :min="0" /></el-form-item>
      <el-form-item label="工位">
        <el-select v-model="editForm.required_workstation_id" filterable clearable style="width: 100%">
          <el-option v-for="w in workstations" :key="w.id" :label="w.name" :value="w.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="所需技能"><el-input v-model="editForm.required_skill" placeholder="welding / machining / qc" /></el-form-item>
      <el-form-item label="所需岗位"><el-input v-model="editForm.required_position_code" placeholder="welder / machinist / qc_inspector" /></el-form-item>
      <el-form-item label="定员/控制点">
        <el-input-number v-model="editForm.worker_count" :min="1" :max="50" style="width: 120px; margin-right: 12px" />
        <el-checkbox v-model="editForm.qc_required">质检点</el-checkbox>
        <el-checkbox v-model="editForm.sop_required">SOP</el-checkbox>
      </el-form-item>
      <el-form-item label="子系统">
        <el-select v-model="editForm.subsystem_id" filterable clearable style="width: 100%" placeholder="未分类">
          <el-option label="未分类" :value="null" />
          <el-option v-for="s in subsystemsList" :key="s.id" :label="'#' + s.sequence + ' ' + s.name_zh + ' (' + (s.name_en || '') + ')'" :value="s.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="备注"><el-input v-model="editForm.notes" type="textarea" :rows="2" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="$emit('update:showEdit', false)">取消</el-button>
      <el-button type="primary" @click="$emit('save-node')" :loading="saving">保存</el-button>
    </template>
  </el-dialog>

  <!-- 分配 -->
  <el-dialog :model-value="showAssign" @update:model-value="(v) => $emit('update:showAssign', v)" :title="'分配节点 #' + assignForm.id" width="400px">
    <el-form :model="assignForm" label-width="100px">
      <el-form-item label="工人">
        <el-select v-model="assignForm.assigned_to" filterable clearable style="width: 100%">
          <el-option v-for="u in users" :key="u.id" :label="u.full_name" :value="u.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="工位">
        <el-select v-model="assignForm.required_workstation_id" filterable clearable style="width: 100%">
          <el-option v-for="w in workstations" :key="w.id" :label="w.name" :value="w.id" />
        </el-select>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="$emit('update:showAssign', false)">取消</el-button>
      <el-button type="primary" @click="$emit('save-assign')">保存</el-button>
    </template>
  </el-dialog>

  <!-- 加依赖 -->
  <el-dialog :model-value="showDep" @update:model-value="(v) => $emit('update:showDep', v)" :title="'为 #' + depForm.successor_id + ' 加前置'" width="400px">
    <el-form :model="depForm" label-width="100px">
      <el-form-item label="前置节点">
        <el-select v-model="depForm.predecessor_id" filterable style="width: 100%">
          <el-option v-for="n in flat" :key="n.id" :label="'#' + n.id + ' ' + (n.material_name || n.operation_name)" :value="n.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="类型">
        <el-radio-group v-model="depForm.dep_type">
          <el-radio-button label="FS">完成→开始</el-radio-button>
          <el-radio-button label="SS">开始→开始</el-radio-button>
        </el-radio-group>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="$emit('update:showDep', false)">取消</el-button>
      <el-button type="primary" @click="$emit('save-dep')">保存</el-button>
    </template>
  </el-dialog>
  <!-- 工时定额 -->
  <el-dialog :model-value="showHours" @update:model-value="(v) => $emit('update:showHours', v)" :title="'工时定额 #' + hoursForm.id" width="420px">
    <el-form :model="hoursForm" label-width="100px">
      <el-form-item label="节点">{{ hoursForm.operation_name }}</el-form-item>
      <el-form-item label="工种">
        <el-select v-model="hoursForm.work_type" style="width: 100%">
          <el-option label="装配" value="assembly" />
          <el-option label="焊接" value="welding" />
          <el-option label="机加" value="machining" />
          <el-option label="测试" value="testing" />
          <el-option label="质检" value="qc" />
        </el-select>
      </el-form-item>
      <el-form-item label="标准工时(h)">
        <el-input-number v-model="hoursForm.standard_hours" :min="0" :step="0.5" :precision="1" style="width: 100%" />
      </el-form-item>
      <el-form-item label="定员(人)">
        <el-input-number v-model="hoursForm.worker_count" :min="1" :max="50" style="width: 100%" />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="hoursForm.description" placeholder="工艺要求等" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="$emit('update:showHours', false)">取消</el-button>
      <el-button type="primary" @click="$emit('save-hours')" :loading="hoursSaving">保存</el-button>
    </template>
  </el-dialog>

</template>

<script setup>
const props = defineProps({
  showEdit: Boolean,
  showAssign: Boolean,
  showDep: Boolean,
  editForm: { type: Object, required: true },
  assignForm: { type: Object, required: true },
  depForm: { type: Object, required: true },
  workstations: { type: Array, default: () => [] },
  users: { type: Array, default: () => [] },
  flat: { type: Array, default: () => [] },
  subsystemsList: { type: Array, default: () => [] },
  operationTemplates: { type: Array, default: () => [] },
  saving: Boolean,
  showHours: Boolean,
  hoursForm: { type: Object, default: () => ({}) },
  hoursSaving: Boolean
})
defineEmits([
  'update:showEdit', 'update:showAssign', 'update:showDep',
  'save-node', 'save-assign', 'save-dep', 'save-hours', 'update:showHours'
])

function applyTemplate(id) {
  const template = props.operationTemplates.find((item) => item.id === id)
  if (!template) return
  Object.assign(props.editForm, {
    operation_name: template.operation_name,
    operation_type: template.operation_type,
    estimated_hours: template.standard_hours || 0,
    required_skill: template.required_skill || '',
    required_position_code: template.required_position_code || '',
    worker_count: template.worker_count || 1,
    qc_required: !!template.qc_required,
    sop_required: !!template.sop_required,
  })
}
</script>
