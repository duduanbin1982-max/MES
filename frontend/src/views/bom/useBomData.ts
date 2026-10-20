import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { asArray } from '../../domain/apiPayload'
import api from '../../api'
import { emptyBusinessViews, templateDesc } from './bomShared'

export function useBomData() {
  const route = useRoute()
  const instances = ref<any[]>([])
  const instanceId = ref<number | null>(null)
  const summary = ref<any>({ 0: 0, 1: 0, 2: 0, 3: 0, total: 0 })
  const tree = ref<any[]>([])
  const flat = ref<any[]>([])
  const costs = ref<any[]>([])
  const materials = ref<any[]>([])
  const health = ref<any>({ score: 0, checks: {}, highlights: [] })
  const businessViews = ref<any>(emptyBusinessViews())
  const templateMeta = ref<any>({ columns: [], sample_csv: '', notes: [] })

  const totalCost = computed(() => costs.value.reduce((sum, item) => sum + (item.cost || 0), 0))
  const allNodes = computed(() => flat.value)
  const minimumStructureMissing = computed(() => !summary.value[0] || !summary.value[1] || !summary.value[2])
  const templateColumns = computed(() => (templateMeta.value.columns || []).map((name: string) => ({
    name,
    required: ['node_ref', 'parent_ref', 'tier', 'quantity', 'unit', 'category'].includes(name),
    desc: templateDesc(name),
  })))

  async function loadAll() {
    if (!instanceId.value) return
    try {
      const [treeR, levelsR, costR, matsR, healthR, businessR] = await Promise.all([
        api.get(`/equipment_instances/${instanceId.value}/bom?view=tree`),
        api.get(`/equipment_instances/${instanceId.value}/bom/levels`),
        api.get(`/equipment_instances/${instanceId.value}/bom/cost`),
        api.get('/materials?limit=500').catch(() => ({ items: [] })),
        api.get(`/equipment_instances/${instanceId.value}/bom/health`).catch(() => ({ score: 0, checks: {}, highlights: [] })),
        api.get(`/equipment_instances/${instanceId.value}/bom/business-views`).catch(() => emptyBusinessViews()),
      ])
      tree.value = treeR.tree || []
      summary.value = { ...(treeR.tier_summary || levelsR.summary || {}), ...(treeR.structure_summary || levelsR.structure_summary || {}) }
      flat.value = []
      const levels = levelsR.levels || {}
      Object.keys(levels)
        .map((key) => Number(key))
        .filter((tier) => Number.isFinite(tier))
        .sort((a, b) => a - b)
        .forEach((tier) => flat.value.push(...(levels[tier] || [])))
      costs.value = costR.items || []
      // 2026-10-21 修复：/api/materials 返回的是数组，原写法 matsR.items 恒为 undefined → 物料下拉无数据
      materials.value = asArray<any>(matsR)
      health.value = healthR || { score: 0, checks: {}, highlights: [] }
      businessViews.value = businessR || emptyBusinessViews()
    } catch (error: any) {
      ElMessage.error('加载失败: ' + (error.message || error))
    }
  }

  async function loadInstances() {
    const result: any = await api.get('/equipment_instances?limit=100')
    instances.value = result.items || result || []
    if (instances.value.length && !instanceId.value) {
      const routeInstanceId = Number(route.query.instance_id || route.query.equipment_instance_id || 0)
      const routed = instances.value.find((item: any) => Number(item.id) === routeInstanceId)
      instanceId.value = routed?.id || instances.value[0].id
      await loadAll()
    }
  }

  return {
    instances,
    instanceId,
    summary,
    tree,
    flat,
    costs,
    materials,
    health,
    businessViews,
    templateMeta,
    totalCost,
    allNodes,
    minimumStructureMissing,
    templateColumns,
    loadAll,
    loadInstances,
  }
}
