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
      <ProcessTreeStats :progress="progress" :cpm="cpm" />

      <el-card>
        <ProcessTreeLegend
          v-model:search-key="filters.searchKey"
          v-model:workstation-id="filters.workstationId"
          v-model:only-critical="filters.onlyCritical"
          v-model:only-mine="filters.onlyMine"
          :all-expanded="allExpanded"
          :workstations="workstations"
          :current-user-id="currentUserId"
          @expand-toggle="toggleExpandAll"
          @change="applyFilter"
        />

        <div v-if="!loading && filteredTree.length === 0" style="padding: 20px; text-align: center; color: #909399">
          无匹配节点 — 调整筛选条件
        </div>

        <el-tree
          v-else
          ref="treeRef"
          :data="filteredTree"
          :props="{ label: 'label', children: 'children' }"
          node-key="id"
          :default-expand-all="allExpanded"
          :expand-on-click-node="false"
        >
          <template #default="{ node, data }">
            <ProcessTreeNode :data="data" :node="node" @start="onStart" @complete="onComplete" @cmd="onCmd" />
          </template>
        </el-tree>
      </el-card>
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
      :saving="saving"
      @save-node="saveNode"
      @save-assign="saveAssign"
      @save-dep="saveDep"
    />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Api } from '../api'
import { useProcessTree } from '../composables/useProcessTree.js'
import { filterTree } from '../utils/nodeStatus.js'
import ProcessTreeStats from '../components/ProcessTreeStats.vue'
import ProcessTreeLegend from '../components/ProcessTreeLegend.vue'
import ProcessTreeNode from '../components/ProcessTreeNode.vue'
import ProcessTreeDialogs from '../components/ProcessTreeDialogs.vue'

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
const allExpanded = ref(true)
const treeRef = ref(null)
const currentUserId = ref(null)

const editForm = reactive({ id: null, operation_name: '', operation_type: 'make', estimated_hours: 0, required_workstation_id: null, required_skill: '', notes: '', parent_id: null, equipment_instance_id: null })
const assignForm = reactive({ id: null, assigned_to: null, required_workstation_id: null })
const depForm = reactive({ successor_id: null, predecessor_id: null, dep_type: 'FS' })

const filters = reactive({ searchKey: '', workstationId: null, onlyCritical: false, onlyMine: false })

const { tree, flat, cpm, progress, loading, criticalSet, load } = useProcessTree(selectedInstance)

const filteredTree = computed(() => {
  return filterTree(tree.value, {
    searchKey: filters.searchKey,
    workstationId: filters.workstationId,
    onlyCritical: filters.onlyCritical,
    onlyMine: filters.onlyMine ? currentUserId.value : null,
    criticalSet: criticalSet.value
  })
})

watch(filteredTree, (v) => {
  // 筛选变更后，让 el-tree 重新渲染时不要因为缺少父节点丢数据
  // （filterTree 已自动保留祖先节点）
  if (v.length === 0 && !loading.value) {
    // 无匹配时 el-tree 不渲染（外层用 v-if 控制）
  }
})

const reloadAll = async () => {
  await load()
}

const applyFilter = () => {
  // 触发 computed filteredTree 重新计算，watch filteredTree 不必做事
}

// 展开/折叠全部：直接操作 el-tree ref
const toggleExpandAll = () => {
  if (!treeRef.value) return
  // 先把所有节点 collapse，再 expand（因为 default-expand-all 只在初次 mount 生效）
  // el-tree 没有 expandAll API，需要遍历节点手动调用
  const allNodes = []
  const walk = (nodes) => {
    for (const n of nodes) {
      allNodes.push(n)
      if (n.children) walk(n.children)
    }
  }
  walk(filteredTree.value)
  if (allExpanded.value) {
    // 即将折叠
    for (const n of allNodes) treeRef.value.collapseNode(n)
  } else {
    for (const n of allNodes) treeRef.value.expandNode(n)
  }
  allExpanded.value = !allExpanded.value
}

const regenerate = async () => {
  try { await ElMessageBox.confirm('重新生成会清空现有工艺树, 确认?', '警告', {type: 'warning'}) } catch { return }
  regenerating.value = true
  try {
    const r = await fetch('/api/equipment_instances/' + selectedInstance.value + '/process_tree/generate', {method: 'POST', headers: authHeader()})
    if (!r.ok) throw new Error('HTTP ' + r.status)
    ElMessage.success('已重新生成')
    await load()
  } catch (e) {
    ElMessage.error('重新生成失败: ' + e.message)
  } finally {
    regenerating.value = false
  }
}

const onAddRoot = () => {
  Object.assign(editForm, { id: null, operation_name: '', operation_type: 'make', estimated_hours: 4, required_workstation_id: null, required_skill: '', notes: '', parent_id: null, equipment_instance_id: selectedInstance.value })
  showEdit.value = true
}

const onStart = async (n) => {
  const r = await fetch('/api/process_nodes/' + n.id + '/execute', {method: 'POST', headers: {'Content-Type': 'application/json', ...authHeader()}, body: JSON.stringify({action: 'start', operator_id: currentUserId.value || 4})})
  if (!r.ok) { ElMessage.error('开始失败: HTTP ' + r.status); return }
  ElMessage.success('已开始 #' + n.id)
  await load()
}

const onComplete = async (n) => {
  const r = await fetch('/api/process_nodes/' + n.id + '/execute', {method: 'POST', headers: {'Content-Type': 'application/json', ...authHeader()}, body: JSON.stringify({action: 'complete', operator_id: currentUserId.value || 4, hours_worked: n.estimated_hours || 0})})
  if (!r.ok) { ElMessage.error('完成失败: HTTP ' + r.status); return }
  ElMessage.success('已完成 #' + n.id)
  await load()
}

const onCmd = async (cmd, n) => {
  if (cmd === 'edit') {
    Object.assign(editForm, { id: n.id, operation_name: n.operation_name, operation_type: n.operation_type, estimated_hours: n.estimated_hours, required_workstation_id: n.required_workstation_id, required_skill: n.required_skill, notes: n.notes, parent_id: n.parent_id, equipment_instance_id: n.equipment_instance_id })
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
    await load()
  }
}

const saveNode = async () => {
  if (!editForm.operation_name) { ElMessage.warning('请填写操作名'); return }
  saving.value = true
  try {
    const url = editForm.id ? '/api/process_nodes/' + editForm.id : '/api/process_nodes'
    const method = editForm.id ? 'PUT' : 'POST'
    const r = await fetch(url, {method, headers: {'Content-Type': 'application/json', ...authHeader()}, body: JSON.stringify(editForm)})
    if (!r.ok) throw new Error('HTTP ' + r.status)
    ElMessage.success('已保存')
    showEdit.value = false
    await load()
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
  await load()
}

const saveDep = async () => {
  if (!depForm.predecessor_id) { ElMessage.warning('请选前置节点'); return }
  const r = await fetch('/api/process_dependencies', {method: 'POST', headers: {'Content-Type': 'application/json', ...authHeader()}, body: JSON.stringify({equipment_instance_id: selectedInstance.value, predecessor_id: depForm.predecessor_id, successor_id: depForm.successor_id, dep_type: depForm.dep_type})})
  if (!r.ok) { ElMessage.error('加依赖失败: HTTP ' + r.status); return }
  ElMessage.success('依赖已加')
  showDep.value = false
  await load()
}

onMounted(async () => {
  instances.value = await Api.instances()
  if (instances.value.length > 0) {
    selectedInstance.value = instances.value[0].id
  }
  try {
    const me = await Api.me?.()
    if (me && me.id) currentUserId.value = me.id
  } catch { /* Api.me 不存在时 fallback 到 operator_id=4 */ }
  // 并行加载
  const [ws, us] = await Promise.all([Api.workstations().catch(() => []), Api.users().catch(() => [])])
  workstations.value = ws || []
  users.value = us || []
  if (selectedInstance.value) await load()
})
</script>

<style scoped>
.page { padding: 16px; }
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.page-title { font-size: 18px; font-weight: 600; }
.stat-card { padding: 12px 8px; background: #fafafa; border-radius: 4px; }
.stat-label { color: #909399; font-size: 12px; margin-bottom: 4px; }
.stat-value { font-size: 20px; font-weight: 600; }
</style>
