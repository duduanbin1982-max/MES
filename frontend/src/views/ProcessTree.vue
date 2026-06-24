<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title">🌳 工艺树</div>
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
        :subsystem="{ id: null, name_zh: u.name_zh, name_en: '', sequence: 0, color: '#909399', nodes: u.nodes, ...u }"
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
      :saving="saving"
      @save-node="saveNode"
      @save-assign="saveAssign"
      @save-dep="saveDep"
    />
  </div>
</template>

<script setup>
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

const authHeader = () => ({ Authorization: 'Bearer ' + localStorage.getItem('tbm_token') })

const instances = ref([])
const workstations = ref([])
const users = ref([])
const selectedInstance = ref(undefined)
const regenerating = ref(false)
const saving = ref(false)
const showEdit = ref(false)
const showAssign = ref(false)
const showDep = ref(false)
const currentUserId = ref(null)

// 子系统状态
const subsystems = ref([])
const uncategorized = ref([])
const subsystemsList = ref([])  // 给 dialog 下拉用的全部 subsystem 元数据

// 复用 useProcessTree 拿进度 / 关键路径 / flat / tree
const { tree, flat, cpm, progress, loading, criticalSet, load } = useProcessTree(selectedInstance)

const editForm = reactive({ id: null, operation_name: '', operation_type: 'make', estimated_hours: 0, required_workstation_id: null, required_skill: '', notes: '', parent_id: null, equipment_instance_id: null, subsystem_id: null })
const assignForm = reactive({ id: null, assigned_to: null, required_workstation_id: null })
const depForm = reactive({ successor_id: null, predecessor_id: null, dep_type: 'FS' })

const filters = reactive({ searchKey: '', workstationId: null, onlyCritical: false, onlyMine: false })

const reloadAll = async () => {
  await load()
  await loadSubsystems()
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
      c.style.outline = '2px solid #409eff'
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
  Object.assign(editForm, { id: null, operation_name: '', operation_type: 'make', estimated_hours: 4, required_workstation_id: null, required_skill: '', notes: '', parent_id: null, equipment_instance_id: selectedInstance.value, subsystem_id: null })
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
    Object.assign(editForm, { id: n.id, operation_name: n.operation_name, operation_type: n.operation_type, estimated_hours: n.estimated_hours, required_workstation_id: n.required_workstation_id, required_skill: n.required_skill, notes: n.notes, parent_id: n.parent_id, equipment_instance_id: n.equipment_instance_id, subsystem_id: n.subsystem_id ?? null })
    showEdit.value = true
  } else if (cmd === 'assign') {
    Object.assign(assignForm, { id: n.id, assigned_to: n.assigned_to, required_workstation_id: n.required_workstation_id })
    showAssign.value = true
  } else if (cmd === 'addchild') {
    Object.assign(editForm, { id: null, operation_name: '', operation_type: 'make', estimated_hours: 4, required_workstation_id: null, required_skill: '', notes: '', parent_id: n.id, equipment_instance_id: selectedInstance.value })
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
  await loadSubsystemsList()
  if (selectedInstance.value) await reloadAll()
})
</script>

<style scoped>
.page { padding: 16px; }
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.page-title { font-size: 18px; font-weight: 600; }
.empty-tip { text-align: center; color: #c0c4cc; padding: 40px; }
.subsystem-bars { display: flex; flex-direction: column; gap: 6px; }
.sub-bar { display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 4px 6px; border-radius: 4px; }
.sub-bar:hover { background: #f5f7fa; }
.sub-bar-color { width: 4px; height: 18px; border-radius: 2px; }
.sub-bar-name { font-size: 13px; min-width: 70px; }
.sub-bar-count { color: #909399; font-size: 12px; min-width: 50px; text-align: right; }
.sub-bar-pct { color: #909399; font-size: 12px; min-width: 35px; }
</style>
