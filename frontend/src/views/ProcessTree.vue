<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title"><el-icon><Connection(orShare) /></el-icon> 工艺树</div>
      <div>
        <el-select v-model="selectedInstance" placeholder="选实例" style="width: 240px; margin-right: 8px" @change="reloadAll">
          <el-option v-for="i in instances" :key="i.id" :label="i.instance_code + ' | ' + (i.instance_name || '')" :value="i.id" />
        </el-select>
        <el-button type="warning" @click="regenerate" :loading="regenerating">从 BOM 重新生成</el-button>
        <el-button type="primary" @click="onAddRoot">+ 新增节点</el-button>
      </div>
    </div>

    <div v-if="!selectedInstance" style="text-align: center; padding: 40px">
      <el-empty description="选实例查看工艺树" />
    </div>

    <div v-else v-loading="loading">
      <!-- 总览统计 -->
      <ProcessTreeStats :progress="progress" :cpm="cpm" />

      <!-- 部件工艺路线完整性 -->
      <el-card class="overview-card" style="margin-bottom: 16px">
        <template #header>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <strong>部件工艺路线完整性</strong>
            <el-button size="small" @click="loadComponentRoutes">刷新</el-button>
          </div>
        </template>
        <el-row :gutter="12">
          <el-col :span="4"><el-statistic title="部件数" :value="componentRouteSummary.component_count || 0" /></el-col>
          <el-col :span="4"><el-statistic title="完整部件" :value="componentRouteSummary.complete_count || 0" /></el-col>
          <el-col :span="4"><el-statistic title="缺工序" :value="componentRouteSummary.missing_route_count || 0" /></el-col>
          <el-col :span="4"><el-statistic title="缺工时" :value="componentRouteSummary.missing_hours_count || 0" /></el-col>
          <el-col :span="4"><el-statistic title="缺工位" :value="componentRouteSummary.missing_workstation_count || 0" /></el-col>
          <el-col :span="4"><el-statistic title="标准人时" :value="componentRouteSummary.total_standard_man_hours || 0" suffix="h" /></el-col>
        </el-row>
        <el-table :data="componentRoutes" size="small" max-height="260" style="margin-top:12px" row-key="component.id">
          <el-table-column label="部件" min-width="180">
            <template #default="{ row }">
              <strong>{{ row.component.name }}</strong>
              <div style="color:var(--el-color-info);font-size:12px">{{ row.component.part_number || row.component.material_code || '-' }}</div>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="row.ok ? 'success' : 'danger'" size="small">{{ row.ok ? '完整' : '待完善' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="operation_count" label="工序数" width="80" />
          <el-table-column prop="estimated_hours" label="标准工时" width="90" />
          <el-table-column prop="standard_man_hours" label="标准人时" width="90" />
          <el-table-column prop="workstation_count" label="工位数" width="80" />
          <el-table-column label="缺口" min-width="220">
            <template #default="{ row }">
              <el-tag v-for="m in row.missing" :key="m" size="small" type="warning" style="margin:1px">{{ m }}</el-tag>
              <span v-if="!row.missing.length" style="color:var(--el-color-success)">已配置工序/工时/工位</span>
            </template>
          </el-table-column>
          <el-table-column label="工序路线" min-width="260">
            <template #default="{ row }">
              <span v-if="!row.operations.length" style="color:var(--el-color-info)">-</span>
              <template v-else>
                <el-tag v-for="op in row.operations" :key="op.id" size="small" style="margin:1px">
                  {{ op.sequence }}.{{ op.operation_name }} / {{ op.estimated_hours || 0 }}h / {{ op.workstation_name || '未设工位' }}
                </el-tag>
              </template>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <!-- 子系统分布 -->
      <el-card v-if="subsystems.length > 0" class="overview-card" style="margin-bottom: 16px">
        <div style="font-weight: 600; margin-bottom: 8px">子系统分布</div>
        <div class="subsystem-bars">
          <div v-for="s in subsystems" :key="s.id" class="sub-bar" @click="scrollToCard(s.id)">
            <div class="sub-bar-color" :style="{ background: s.color }"></div>
            <span class="sub-bar-name">{{ s.name_zh }}</span>
            <span class="sub-bar-count">{{ s.completed }}/{{ s.total }}</span>
            <el-progress :percentage="s.progress_pct" :show-text="false" :stroke-width="4" :color="s.color" style="flex: 1; margin: 0 8px" />
            <span class="sub-bar-pct">{{ s.progress_pct }}%</span>
          </div>
        </div>
      </el-card>

      <!-- 跨子系统依赖矩阵 (可折叠) -->
      <ProcessTreeCrossSubsystemMatrix
        v-if="selectedInstance"
        :instance-id="selectedInstance"
      />

      <!-- 工艺树思维导图 (可折叠，默认展开) -->
      <ProcessTreeMindmap
        v-if="selectedInstance"
        :instance-id="selectedInstance"
        @navigate="onMindmapNavigate"
      />

      <!-- 筛选 / 搜索 -->
      <ProcessTreeLegend
        v-model:search-key="filters.searchKey"
        v-model:workstation-id="filters.workstationId"
        v-model:only-critical="filters.onlyCritical"
        v-model:only-mine="filters.onlyMine"
        :workstations="workstations"
        :current-user-id="currentUserId"
        :all-expanded="true"
        @change="reloadAll"
      />

      <!-- 总装根节点（uncategorized） -->
      <ProcessTreeSubsystemCard
        v-for="u in uncategorized"
        :key="'uncategorized'"
        :ref="'card_uncategorized'"
        :subsystem="{ id: null, name_zh: u.name_zh, name_en: '', sequence: 0, color: 'var(--el-color-info)', nodes: u.nodes, ...u }"
        :critical-set="criticalSet"
        :search-key="filters.searchKey"
        :only-critical="filters.onlyCritical"
        :only-mine="filters.onlyMine"
        :workstation-id="filters.workstationId"
        :current-user-id="currentUserId"
        @start="onStart" @complete="onComplete" @cmd="onCmd"
        @node-dropped="onNodeDropped"
      />

      <!-- 按 subsystem 分组的卡片 -->
      <ProcessTreeSubsystemCard
        v-for="s in subsystems"
        :key="s.id"
        :ref="'card_' + s.id"
        :subsystem="s"
        :critical-set="criticalSet"
        :search-key="filters.searchKey"
        :only-critical="filters.onlyCritical"
        :only-mine="filters.onlyMine"
        :workstation-id="filters.workstationId"
        :current-user-id="currentUserId"
        @start="onStart" @complete="onComplete" @cmd="onCmd"
        @node-dropped="onNodeDropped"
      />

      <div v-if="!loading && subsystems.length === 0 && uncategorized.length === 0" class="empty-tip">
        无节点数据 — 试试「从 BOM 重新生成」
      </div>
    </div>

    <ProcessTreeDialogs
      v-model:show-edit="showEdit"
      v-model:show-assign="showAssign"
      v-model:show-dep="showDep"
      :edit-form="editForm"
      :assign-form="assignForm"
      :dep-form="depForm"
      :workstations="workstations"
      :users="users"
      :flat="flat"
      :subsystems-list="subsystemsList"
      :operation-templates="operationTemplates"
      :saving="saving"
      :show-hours="showHours"
      :hours-form="hoursForm"
      :hours-saving="hoursSaving"
      @save-node="saveNode"
      @save-assign="saveAssign"
      @save-dep="saveDep"
      @save-hours="saveHours"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Api } from '../api'
import { useProcessTree } from '../composables/useProcessTree.js'
import ProcessTreeStats from '../components/ProcessTreeStats.vue'
import ProcessTreeLegend from '../components/ProcessTreeLegend.vue'
import ProcessTreeNode from '../components/ProcessTreeNode.vue'
import ProcessTreeSubsystemCard from '../components/ProcessTreeSubsystemCard.vue'
import ProcessTreeDialogs from '../components/ProcessTreeDialogs.vue'
import ProcessTreeCrossSubsystemMatrix from '../components/ProcessTreeCrossSubsystemMatrix.vue'
import ProcessTreeMindmap from '../components/ProcessTreeMindmap.vue'

const authHeader = () => ({ Authorization: 'Bearer ' + localStorage.getItem('tbm_access_token') || localStorage.getItem('tbm_token') })

const instances = ref([])
const workstations = ref([])
const users = ref([])
const operationTemplates = ref([])
const selectedInstance = ref(undefined)
const regenerating = ref(false)
const saving = ref(false)
const showEdit = ref(false)
const showAssign = ref(false)
const showDep = ref(false)
const showHours = ref(false)
const hoursSaving = ref(false)
const currentUserId = ref(null)

// 子系统状态
const subsystems = ref([])
const uncategorized = ref([])
const subsystemsList = ref([])  // 给 dialog 下拉用的全部 subsystem 元数据
const componentRoutes = ref([])
const componentRouteSummary = reactive({ component_count: 0, complete_count: 0, missing_route_count: 0, missing_hours_count: 0, missing_workstation_count: 0, total_operations: 0, total_estimated_hours: 0, total_standard_man_hours: 0 })

// 复用 useProcessTree 拿进度 / 关键路径 / flat / tree
const { tree, flat, cpm, progress, loading, criticalSet, load } = useProcessTree(selectedInstance)

const editForm = reactive({ id: null, operation_name: '', operation_type: 'make', estimated_hours: 0, required_workstation_id: null, required_skill: '', operation_template_id: null, required_position_code: '', worker_count: 1, qc_required: false, sop_required: false, notes: '', parent_id: null, equipment_instance_id: null, subsystem_id: null })
const assignForm = reactive({ id: null, assigned_to: null, required_workstation_id: null })
const depForm = reactive({ successor_id: null, predecessor_id: null, dep_type: 'FS' })
const hoursForm = reactive({ id: null, operation_name: '', work_type: 'assembly', standard_hours: 8, worker_count: 2, description: '' })

const filters = reactive({ searchKey: '', workstationId: null, onlyCritical: false, onlyMine: false })

const reloadAll = async () => {
  await load()
  await loadSubsystems()
  await loadComponentRoutes()
}

const loadComponentRoutes = async () => {
  if (!selectedInstance.value) return
  try {
    const r = await fetch('/api/process-route/instances/' + selectedInstance.value + '/components', { headers: authHeader() })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const j = await r.json()
    componentRoutes.value = j.components || []
    Object.assign(componentRouteSummary, j.summary || {})
  } catch (e) {
    console.error('[loadComponentRoutes]', e)
    ElMessage.warning('部件工艺路线加载失败: ' + e.message)
  }
}

const onMindmapNavigate = (nav) => {
  // 思维导图导航回调：滚动到对应卡片（如果 kind=s subsystem/scroll）
  console.log('[mindmap navigate]', nav)
}

const loadSubsystems = async () => {
  if (!selectedInstance.value) return
  try {
    const r = await fetch('/api/equipment_instances/' + selectedInstance.value + '/subsystems', { headers: authHeader() })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const j = await r.json()
    subsystems.value = j.subsystems || []
    uncategorized.value = j.uncategorized || []
  } catch (e) {
    console.error('[loadSubsystems]', e)
    ElMessage.error('子系统数据加载失败: ' + e.message)
  }
}

const loadProcessMasterOptions = async () => {
  try {
    const r = await Api.get('/process-master/operations')
    operationTemplates.value = r.items || []
  } catch (e) { console.error('[loadProcessMasterOptions]', e) }
}

const loadSubsystemsList = async () => {
  // 全部 9 个 subsystem（不依赖 instance）
  try {
    const r = await fetch('/api/equipment_subsystems', { headers: authHeader() })
    if (!r.ok) return
    const j = await r.json()
    subsystemsList.value = (j.rows || j || []).map(s => ({ id: s.id, code: s.code, name_zh: s.name_zh, name_en: s.name_en, sequence: s.sequence }))
  } catch (e) { console.error('[loadSubsystemsList]', e) }
}

const scrollToCard = (subId) => {
  // 简易 scroll：找对应的 ref
  const refName = subId == null ? 'card_uncategorized' : 'card_' + subId
  const refVal = (typeof refName === 'string') ? null : null
  // 用 DOM 查询更稳
  const cards = document.querySelectorAll('.subsystem-card')
  for (const c of cards) {
    const seqEl = c.querySelector('.seq')
    if (seqEl && seqEl.textContent.includes('#' + (subId == null ? '0' : subId))) {
      c.scrollIntoView({ behavior: 'smooth', block: 'start' })
      c.style.outline = '2px solid var(--el-color-primary)'
      setTimeout(() => c.style.outline = '', 1200)
      break
    }
  }
}

const regenerate = async () => {
  try { await ElMessageBox.confirm('重新生成会清空现有工艺树, 确认?', '警告', {type: 'warning'}) } catch { return }
  regenerating.value = true
  try {
    const r = await fetch('/api/equipment_instances/' + selectedInstance.value + '/process_tree/generate', {method: 'POST', headers: authHeader()})
    if (!r.ok) throw new Error('HTTP ' + r.status)
    ElMessage.success('已重新生成')
    await reloadAll()
  } catch (e) {
    ElMessage.error('重新生成失败: ' + e.message)
  } finally {
    regenerating.value = false
  }
}

const onAddRoot = () => {
  Object.assign(editForm, { id: null, operation_name: '', operation_type: 'make', estimated_hours: 4, required_workstation_id: null, required_skill: '', operation_template_id: null, required_position_code: '', worker_count: 1, qc_required: false, sop_required: false, notes: '', parent_id: null, equipment_instance_id: selectedInstance.value, subsystem_id: null })
  showEdit.value = true
}

const onStart = async (n) => {
  const r = await fetch('/api/process_nodes/' + n.id + '/execute', {method: 'POST', headers: {'Content-Type': 'application/json', ...authHeader()}, body: JSON.stringify({action: 'start', operator_id: currentUserId.value || 4})})
  if (!r.ok) { ElMessage.error('开始失败: HTTP ' + r.status); return }
  ElMessage.success('已开始 #' + n.id)
  await reloadAll()
}

const onComplete = async (n) => {
  const r = await fetch('/api/process_nodes/' + n.id + '/execute', {method: 'POST', headers: {'Content-Type': 'application/json', ...authHeader()}, body: JSON.stringify({action: 'complete', operator_id: currentUserId.value || 4, hours_worked: n.estimated_hours || 0})})
  if (!r.ok) { ElMessage.error('完成失败: HTTP ' + r.status); return }
  ElMessage.success('已完成 #' + n.id)
  await reloadAll()
}

const onCmd = async (cmd, n) => {
  if (cmd === 'edit') {
    Object.assign(editForm, { id: n.id, operation_name: n.operation_name, operation_type: n.operation_type, estimated_hours: n.estimated_hours, required_workstation_id: n.required_workstation_id, required_skill: n.required_skill, operation_template_id: n.operation_template_id ?? null, required_position_code: n.required_position_code || '', worker_count: n.worker_count || 1, qc_required: !!n.qc_required, sop_required: !!n.sop_required, notes: n.notes, parent_id: n.parent_id, equipment_instance_id: n.equipment_instance_id, subsystem_id: n.subsystem_id ?? null })
    showEdit.value = true
  } else if (cmd === 'assign') {
    Object.assign(assignForm, { id: n.id, assigned_to: n.assigned_to, required_workstation_id: n.required_workstation_id })
    showAssign.value = true
  } else if (cmd === 'hours') {
    Object.assign(hoursForm, { id: n.id, operation_name: n.operation_name || n.material_name, work_type: 'assembly', standard_hours: n.estimated_hours || 8, worker_count: 2, description: '' })
    showHours.value = true
  } else if (cmd === 'addchild') {
    Object.assign(editForm, { id: null, operation_name: '', operation_type: 'make', estimated_hours: 4, required_workstation_id: null, required_skill: '', operation_template_id: null, required_position_code: '', worker_count: 1, qc_required: false, sop_required: false, notes: '', parent_id: n.id, equipment_instance_id: selectedInstance.value })
    showEdit.value = true
  } else if (cmd === 'adddep') {
    Object.assign(depForm, { successor_id: n.id, predecessor_id: null, dep_type: 'FS' })
    showDep.value = true
  } else if (cmd === 'delete') {
    try { await ElMessageBox.confirm('确认删除 #' + n.id + '?', '确认', {type: 'warning'}) } catch { return }
    const r = await fetch('/api/process_nodes/' + n.id, {method: 'DELETE', headers: authHeader()})
    if (!r.ok) { ElMessage.error('删除失败: HTTP ' + r.status); return }
    ElMessage.success('已删除 #' + n.id)
    await reloadAll()
  }
}

const saveNode = async () => {
  if (!editForm.operation_name) { ElMessage.warning('请填写操作名'); return }
  saving.value = true
  try {
    if (editForm.id) {
      // PUT 原有字段
      const putBody = { ...editForm }
      delete putBody.subsystem_id  // subsystem_id 走单独的 PATCH
      const r = await fetch('/api/process_nodes/' + editForm.id, {method: 'PUT', headers: {'Content-Type': 'application/json', ...authHeader()}, body: JSON.stringify(putBody)})
      if (!r.ok) throw new Error('HTTP ' + r.status)
      // PATCH subsystem（如果后端 schema 不支持 PUT 改 subsystem_id）
      const r2 = await fetch('/api/process_nodes/' + editForm.id + '/subsystem', {method: 'PATCH', headers: {'Content-Type': 'application/json', ...authHeader()}, body: JSON.stringify({subsystem_id: editForm.subsystem_id ?? null})})
      if (!r2.ok) throw new Error('subsystem PATCH HTTP ' + r2.status)
    } else {
      const r = await fetch('/api/process_nodes', {method: 'POST', headers: {'Content-Type': 'application/json', ...authHeader()}, body: JSON.stringify(editForm)})
      if (!r.ok) throw new Error('HTTP ' + r.status)
    }
    ElMessage.success('已保存')
    showEdit.value = false
    await reloadAll()
  } catch (e) {
    ElMessage.error('保存失败: ' + e.message)
  } finally {
    saving.value = false
  }
}

const saveAssign = async () => {
  const r = await fetch('/api/process_nodes/' + assignForm.id + '/assign', {method: 'PUT', headers: {'Content-Type': 'application/json', ...authHeader()}, body: JSON.stringify(assignForm)})
  if (!r.ok) { ElMessage.error('分配失败: HTTP ' + r.status); return }
  ElMessage.success('已分配')
  showAssign.value = false
  await reloadAll()
}

const saveDep = async () => {
  if (!depForm.predecessor_id) { ElMessage.warning('请选前置节点'); return }
  const r = await fetch('/api/process_dependencies', {method: 'POST', headers: {'Content-Type': 'application/json', ...authHeader()}, body: JSON.stringify({equipment_instance_id: selectedInstance.value, predecessor_id: depForm.predecessor_id, successor_id: depForm.successor_id, dep_type: depForm.dep_type})})
  if (!r.ok) { ElMessage.error('加依赖失败: HTTP ' + r.status); return }
  ElMessage.success('依赖已加')
  showDep.value = false
  await reloadAll()
}

const saveHours = async () => {
  hoursSaving.value = true
  try {
    await fetch('/api/process/nodes/' + hoursForm.id + '/hours', {method: 'POST', headers: {'Content-Type': 'application/json', ...authHeader()}, body: JSON.stringify({work_type: hoursForm.work_type, standard_hours: hoursForm.standard_hours, worker_count: hoursForm.worker_count, description: hoursForm.description})}).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
    ElMessage.success('工时定额已保存')
    showHours.value = false
  } catch (e) {
    ElMessage.error('保存失败: ' + e.message)
  } finally {
    hoursSaving.value = false
  }
}

// 拖放节点改 subsystem (HTML5 drag/drop)
const onNodeDropped = async ({ node_id, node_name, to_subsystem_id, to_subsystem_name }) => {
  try {
    await ElMessageBox.confirm(
      `确认将「${node_name} (#${node_id})」移到「${to_subsystem_name || '未分类'}」？`,
      '拖放改归属',
      { type: 'warning', confirmButtonText: '确认移动', cancelButtonText: '取消' }
    )
  } catch { return }  // 用户取消
  try {
    const r = await fetch('/api/process_nodes/' + node_id + '/subsystem', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ subsystem_id: to_subsystem_id })
    })
    if (!r.ok) {
      const err = await r.text().catch(() => '')
      throw new Error('HTTP ' + r.status + (err ? ' — ' + err : ''))
    }
    ElMessage.success(`#${node_id} 已移到「${to_subsystem_name || '未分类'}」`)
    await reloadAll()
  } catch (e) {
    console.error('[onNodeDropped]', e)
    ElMessage.error('移动失败: ' + e.message)
  }
}

onMounted(async () => {
  instances.value = await Api.instances()
  if (instances.value.length > 0) {
    selectedInstance.value = instances.value[0].id
  }
  try {
    const me = await Api.me?.()
    if (me && me.id) currentUserId.value = me.id
  } catch { /* Api.me fallback */ }
  const [ws, us] = await Promise.all([Api.workstations().catch(() => []), Api.users().catch(() => [])])
  workstations.value = ws || []
  users.value = us || []
  await Promise.all([loadSubsystemsList(), loadProcessMasterOptions()])
  if (selectedInstance.value) await reloadAll()
})
</script>

<style scoped>
.page { padding: 16px; }
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.page-title { font-size: 18px; font-weight: 600; }
.empty-tip { text-align: center; color: var(--el-text-color-placeholder); padding: 40px; }
.subsystem-bars { display: flex; flex-direction: column; gap: 6px; }
.sub-bar { display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 4px 6px; border-radius: 4px; }
.sub-bar:hover { background: var(--el-fill-color-light); }
.sub-bar-color { width: 4px; height: 18px; border-radius: 2px; }
.sub-bar-name { font-size: 13px; min-width: 70px; }
.sub-bar-count { color: var(--el-color-info); font-size: 12px; min-width: 50px; text-align: right; }
.sub-bar-pct { color: var(--el-color-info); font-size: 12px; min-width: 35px; }
</style>
