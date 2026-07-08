import { ref, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Api } from '../../api'
import { usePurchaseSuppliers } from './usePurchaseSuppliers'
import { usePurchaseOrders } from './usePurchaseOrders'
import { usePurchaseFollowup } from './usePurchaseFollowup'
import { usePurchaseQuotes } from './usePurchaseQuotes'
import { useSupplierCollaboration } from './useSupplierCollaboration'

export function usePurchaseManagement() {
  const route = useRoute()
  const router = useRouter()
  const tab = ref(String(route.query.tab || 'suppliers'))
  const saving = ref(false)
  const materials = ref<any[]>([])

  const suppliers = usePurchaseSuppliers(saving)
  const orders = usePurchaseOrders(saving)
  const followup = usePurchaseFollowup({ tab, saving })
  const quotes = usePurchaseQuotes(suppliers.suppliers)
  const collab = useSupplierCollaboration()

  const loadMaterials = async () => {
    try { materials.value = await Api.get('/materials') }
    catch (_) { materials.value = [] }
  }

  onMounted(async () => {
    followup.applyRouteToFollowUp(route.query)
    await Promise.all([
      suppliers.loadSupplierCategories(),
      suppliers.loadSuppliers(),
      suppliers.loadSupplierSetup(),
      loadMaterials(),
      orders.loadOrders(),
      followup.loadPurchaseFollowUp(),
    ])
    await collab.loadSupplierCollab()
  })

  watch(() => route.query, () => {
    followup.applyRouteToFollowUp(route.query)
  }, { deep: true })

  watch(tab, (value) => {
    const nextQuery: any = { ...route.query, tab: value }
    if (value !== 'followup') {
      delete nextQuery.purchase_request_no
      delete nextQuery.source_type
    }
    router.replace({ query: nextQuery }).catch(() => {})
  })

  return {
    tab,
    saving,
    materials,
    ...suppliers,
    ...orders,
    ...followup,
    ...quotes,
    ...collab,
  }
}
