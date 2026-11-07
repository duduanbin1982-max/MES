import { computed, onMounted, ref, watch } from 'vue'
import { useBomData } from './useBomData'
import { useBomDocuments } from './useBomDocuments'
import { useBomEditor } from './useBomEditor'
import { useBomRiskActions } from './useBomRiskActions'

export function useBomManagement() {
  const data = useBomData()
  const treeFilter = ref('')
  const selected = ref<any | null>(null)
  const activeLevel = ref<number | null>(null)
  const mainTab = ref('tree')
  const drillNode = ref<any | null>(null)
  const drillChildren = ref<any[]>([])

  const docs = useBomDocuments(data.instanceId)
  const risks = useBomRiskActions({
    instanceId: data.instanceId,
    businessViews: data.businessViews,
    loadAll: data.loadAll,
  })
  const editor = useBomEditor({
    instanceId: data.instanceId,
    bomType: data.bomType,
    selected,
    drillNode,
    health: data.health,
    templateMeta: data.templateMeta,
    allNodes: data.allNodes,
    loadAll: data.loadAll,
  })

  const filteredTree = computed(() => {
    if (!treeFilter.value) return data.tree.value
    const query = treeFilter.value.toLowerCase()
    const match = (node: any): boolean => {
      if ((node.material_name || '').toLowerCase().includes(query)) return true
      if ((node.material_code || '').toLowerCase().includes(query)) return true
      if ((node.part_number || '').toLowerCase().includes(query)) return true
      if ((node.level_code || '').toLowerCase().includes(query)) return true
      return node.children?.some(match) || false
    }
    return data.tree.value.filter((row: any) => match(row))
  })

  function rowsOfLevel(tier: number) {
    return data.flat.value.filter((row) => row.tier === tier)
  }

  function setLevel(tier: number) {
    activeLevel.value = tier
    mainTab.value = ['tree', 'l0', 'l1', 'l2', 'l3'][tier] || 'tree'
  }

  function onNodeClick(node: any) {
    selected.value = node
  }

  function onRowSelect(row: any) {
    selected.value = row
  }

  function drillPart(node: any) {
    drillNode.value = node
    drillChildren.value = data.flat.value.filter((row) => row.parent_id === node.id)
  }

  watch(data.instanceId, (value) => {
    if (value) {
      docs.loadBomDocs()
      risks.loadRiskOwners()
    }
  })

  onMounted(data.loadInstances)

  return {
    ...data,
    ...docs,
    ...editor,
    ...risks,
    treeFilter,
    selected,
    activeLevel,
    mainTab,
    filteredTree,
    drillNode,
    drillChildren,
    rowsOfLevel,
    setLevel,
    onNodeClick,
    onRowSelect,
    drillPart,
  }
}
