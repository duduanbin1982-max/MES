import { reactive, ref, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Api } from '../../api'

export function usePurchaseQuotes(suppliers: Ref<any[]>) {
  const quoteForm = reactive({
    supplier_ids: [] as number[],
    material_ids: [] as number[]
  })
  const quoteResults = ref<any[]>([])
  const quoteSuppliers = ref<any[]>([])
  const quoteLoading = ref(false)
  const quoteLoaded = ref(false)

  const compareQuotes = async () => {
    quoteLoading.value = true
    quoteLoaded.value = true
    try {
      const result = await Api.post('/purchase/quote-compare', {
        supplier_ids: quoteForm.supplier_ids,
        material_ids: quoteForm.material_ids
      })
      quoteResults.value = result.results || result || []
      quoteSuppliers.value = suppliers.value.filter((supplier: any) => quoteForm.supplier_ids.includes(supplier.id))
    } catch (error: any) {
      ElMessage.error(error?.message || '询价对比失败')
      quoteResults.value = []
    }
    finally { quoteLoading.value = false }
  }

  return { quoteForm, quoteResults, quoteSuppliers, quoteLoading, quoteLoaded, compareQuotes }
}
