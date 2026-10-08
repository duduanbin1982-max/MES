import { computed, reactive, ref, type Ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Api } from '../../api'
import { supplierCategoryTag, supplierName } from './purchaseShared'

export function usePurchaseSuppliers(saving: Ref<boolean>) {
  const suppliers = ref<any[]>([])
  const supplierCategories = ref<any[]>([])
  const supplierFilter = reactive({ category: '' })
  const supplierSetup = ref<any>({ by_category: {}, missing_required: [], bootstrap_templates: [] })
  const missingTemplates = computed(() => (supplierSetup.value.bootstrap_templates || []).filter((item: any) => !item.exists))
  const sLoading = ref(false)
  const supplierDlg = reactive({ visible: false, isEdit: false })
  const supplierForm = reactive({
    id: null as number | null,
    supplier_code: '', supplier_name: '', contact_person: '', phone: '', email: '', address: '',
    supplier_category: 'general', business_categories: [] as string[], category_notes: '',
    payment_terms: '', rating: 'B', is_active: true
  })

  const loadSuppliers = async () => {
    sLoading.value = true
    try {
      const params: any = {}
      if (supplierFilter.category) params.category = supplierFilter.category
      suppliers.value = await Api.get('/suppliers', { params })
    } catch (_) { suppliers.value = [] }
    finally { sLoading.value = false }
  }

  const loadSupplierCategories = async () => {
    try { supplierCategories.value = await Api.get('/suppliers/categories') }
    catch (_) { supplierCategories.value = [] }
  }

  const loadSupplierSetup = async () => {
    try { supplierSetup.value = await Api.get('/suppliers/setup-summary') }
    catch (_) { supplierSetup.value = { by_category: {}, missing_required: [], bootstrap_templates: [] } }
  }

  const resetSupplierForm = () => {
    Object.assign(supplierForm, {
      id: null, supplier_code: '', supplier_name: '', contact_person: '', phone: '', email: '', address: '',
      supplier_category: 'general', business_categories: ['general'], category_notes: '',
      payment_terms: '', rating: 'B', is_active: true
    })
  }

  const openSupplierDialog = (row?: any) => {
    supplierDlg.isEdit = !!row
    if (row) {
      Object.assign(supplierForm, {
        id: row.id, supplier_code: row.supplier_code || '', supplier_name: row.supplier_name || row.name || '',
        contact_person: row.contact_person || row.contact || '', phone: row.phone || '', email: row.email || '', address: row.address || '',
        supplier_category: row.supplier_category || 'general',
        business_categories: Array.isArray(row.business_categories) ? [...row.business_categories] : (row.supplier_category ? [row.supplier_category] : ['general']),
        category_notes: row.category_notes || '',
        payment_terms: row.payment_terms || '', rating: row.rating || 'B', is_active: row.is_active !== 0 && row.status !== 'inactive'
      })
    } else {
      resetSupplierForm()
    }
    supplierDlg.visible = true
  }

  const saveSupplier = async () => {
    if (!supplierForm.supplier_code || !supplierForm.supplier_name) { ElMessage.warning('请填写供应商编码和名称'); return }
    saving.value = true
    try {
      const body = {
        supplier_code: supplierForm.supplier_code,
        supplier_name: supplierForm.supplier_name,
        contact_person: supplierForm.contact_person,
        phone: supplierForm.phone,
        email: supplierForm.email,
        address: supplierForm.address,
        supplier_category: supplierForm.supplier_category,
        business_categories: supplierForm.business_categories?.length ? supplierForm.business_categories : [supplierForm.supplier_category],
        category_notes: supplierForm.category_notes,
        payment_terms: supplierForm.payment_terms,
        rating: supplierForm.rating,
        is_active: supplierForm.is_active
      }
      if (supplierDlg.isEdit && supplierForm.id) await Api.patch(`/suppliers/${supplierForm.id}`, body)
      else await Api.post('/suppliers', body)
      ElMessage.success('已保存')
      supplierDlg.visible = false
      await Promise.all([loadSuppliers(), loadSupplierSetup()])
    } catch (error: any) { ElMessage.error(error?.message || '保存失败') }
    finally { saving.value = false }
  }

  const deleteSupplier = async (row: any) => {
    try {
      await ElMessageBox.confirm(`确认删除供应商 "${supplierName(row)}" ?`, '确认', { type: 'warning' })
      await Api.del(`/suppliers/${row.id}`)
      ElMessage.success('已删除')
      await Promise.all([loadSuppliers(), loadSupplierSetup()])
    } catch (error: any) {
      if (error === 'cancel' || error === 'close') return
      ElMessage.error(error?.message || '供应商删除失败')
    }
  }

  const syncSupplierCategory = () => {
    supplierForm.business_categories = Array.from(new Set([supplierForm.supplier_category, ...(supplierForm.business_categories || [])]))
  }

  const openSupplierTemplate = (template: any) => {
    resetSupplierForm()
    supplierForm.supplier_category = template.category
    supplierForm.business_categories = [template.category]
    supplierForm.supplier_code = template.code_prefix ? `${template.code_prefix}-001` : ''
    supplierForm.supplier_name = template.supplier_name || ''
    supplierForm.contact_person = template.contact_person || ''
    supplierForm.category_notes = template.category_notes || ''
    supplierDlg.visible = true
  }

  const bootstrapSupplierDefaults = async () => {
    saving.value = true
    try {
      const result = await Api.post('/suppliers/bootstrap-defaults', { categories: missingTemplates.value.map((item: any) => item.category) })
      ElMessage.success(result.created?.length ? `已补 ${result.created.length} 个首日模板供应商` : '当前必备分类已覆盖')
      await Promise.all([loadSuppliers(), loadSupplierSetup()])
    } catch (error: any) {
      ElMessage.error(error?.message || '补模板失败')
    } finally {
      saving.value = false
    }
  }

  const supplierCategoryLabel = (value: string) => supplierCategories.value.find((category: any) => category.value === value)?.label || value || '普通供应商'
  const supplierSetupCount = (category: string) => Number(supplierSetup.value.by_category?.[category] || 0)

  return {
    suppliers, supplierCategories, supplierFilter, supplierSetup, missingTemplates, sLoading,
    supplierDlg, supplierForm, loadSuppliers, loadSupplierCategories, loadSupplierSetup,
    bootstrapSupplierDefaults, openSupplierTemplate, openSupplierDialog, deleteSupplier,
    resetSupplierForm, syncSupplierCategory, saveSupplier, supplierName, supplierCategoryLabel,
    supplierCategoryTag, supplierSetupCount,
  }
}
