import { ref, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useInspectionRecords } from './useInspectionRecords'
import { useQualityDashboard } from './useQualityDashboard'
import { useCapaActions } from './useCapaActions'
import { useNcrWorkflow } from './useNcrWorkflow'
import { useQualityTemplates } from './useQualityTemplates'

const tabNames = new Set(['inspections', 'ncr', 'capa', 'templates', 'dashboard'])

export function useQualityManagement() {
  const route = useRoute()
  const router = useRouter()
  const routeTab = () => {
    const value = String(route.query.tab || '')
    return tabNames.has(value) ? value : 'inspections'
  }
  const activeTab = ref(routeTab())

  const inspections = useInspectionRecords()
  const dashboard = useQualityDashboard()
  const capa = useCapaActions()
  const ncr = useNcrWorkflow(capa.loadCapa)
  const templates = useQualityTemplates()

  watch(activeTab, async (value) => {
    if (route.query.tab !== value) router.replace({ query: { ...route.query, tab: value } })
    if (value === 'dashboard') await dashboard.loadDashboard()
  })
  watch(() => route.query.tab, () => {
    const next = routeTab()
    if (next !== activeTab.value) activeTab.value = next
  })
  watch(() => route.query.type, async () => {
    if (inspections.applyInspectionTypeFromRoute(route.query.type)) await inspections.load()
  })

  const clearInspectionRouteScope = async () => {
    const nextQuery = { ...route.query }
    delete nextQuery.type
    await router.replace({ query: nextQuery })
    if (inspections.applyInspectionTypeFromRoute(undefined)) await inspections.load()
  }

  onMounted(() => {
    inspections.applyInspectionTypeFromRoute(route.query.type)
    inspections.load()
    ncr.loadNcr()
    capa.loadCapa()
    templates.loadTemplates()
    if (activeTab.value === 'dashboard') dashboard.loadDashboard()
  })

  return {
    activeTab,
    clearInspectionRouteScope,
    ...inspections,
    ...dashboard,
    ...ncr,
    ...capa,
    ...templates,
  }
}
