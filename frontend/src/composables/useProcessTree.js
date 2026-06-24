/**
 * 工艺树数据 composable
 *
 * 集中：
 * - 3 个并发 fetch（process_tree / critical_path / process_progress）
 * - decorate（critical 标记 + derived_status）
 * - 暴露 reload / mutate helpers（让子组件的「开始/完成/编辑/删除」共用）
 */

import { ref, computed } from 'vue'
import { decorateWithDerivedStatus } from '../utils/nodeStatus.js'

const authHeader = () => ({ Authorization: 'Bearer ' + localStorage.getItem('tbm_token') })

export function useProcessTree(instanceIdRef) {
  const tree = ref([])
  const flat = ref([])
  const deps = ref([])
  const cpm = ref({})
  const progress = ref({})
  const loading = ref(false)
  const error = ref(null)

  const criticalSet = computed(() => new Set(cpm.value.critical_path || []))

  const decorateTree = (rawTree) => {
    const decorate = (nodes) => nodes.map(n => {
      // 装饰自身
      const flatNode = { id: n.id, status: n.status, operation_name: n.operation_name, material_name: n.material_name, notes: n.notes, assigned_to: n.assigned_to, required_workstation_id: n.required_workstation_id }
      const derivedFlat = decorateWithDerivedStatus([flatNode], deps.value, flat.value)[0]
      const decorated = {
        ...n,
        label: n.material_name || n.notes || n.operation_name,
        is_critical: criticalSet.value.has(n.id),
        derived_status: derivedFlat.derived_status,
        children: decorate(n.children || [])
      }
      return decorated
    })
    return decorate(rawTree)
  }

  const load = async () => {
    if (!instanceIdRef.value) return
    loading.value = true
    error.value = null
    try {
      const [treeRes, cpmRes, progRes] = await Promise.all([
        fetch('/api/equipment_instances/' + instanceIdRef.value + '/process_tree', { headers: authHeader() }).then(r => r.json()),
        fetch('/api/equipment_instances/' + instanceIdRef.value + '/critical_path', { headers: authHeader() }).then(r => r.json()),
        fetch('/api/equipment_instances/' + instanceIdRef.value + '/process_progress', { headers: authHeader() }).then(r => r.json())
      ])
      flat.value = treeRes.flat || []
      deps.value = treeRes.deps || []
      tree.value = decorateTree(treeRes.tree || [])
      cpm.value = cpmRes
      progress.value = progRes
    } catch (e) {
      error.value = e.message || String(e)
      console.error('[useProcessTree] load failed:', e)
    } finally {
      loading.value = false
    }
  }

  // 给单个节点打 derived（用于 reload 期间乐观更新）
  const applyDerivedToFlat = () => {
    flat.value = flat.value.map(n => {
      const out = decorateWithDerivedStatus([n], deps.value, flat.value)
      return { ...n, derived_status: out[0].derived_status }
    })
  }

  return {
    tree, flat, deps, cpm, progress,
    loading, error,
    criticalSet,
    load,
    applyDerivedToFlat
  }
}
