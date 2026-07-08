import { ref, reactive, computed } from 'vue'
import Api from '../../api'
import { ElMessage } from 'element-plus'

export function useNcrWorkflow(loadCapa: () => Promise<void>) {
  const ncrFilters = reactive({ severity: '', status: '' })
  const ncrRows = ref<any[]>([])
  const ncrLoading = ref(false)
  const showNcrCreate = ref(false)
  const ncrSubmitting = ref(false)
  const ncrForm = reactive({ source_type: 'incoming', part_name: '', defect_desc: '', defect_qty: 1, severity: 'minor' })

  const severityLabel = (value: string) => ({ minor: '轻微', major: '严重', critical: '致命' }[value] || value)
  const severityColor = (value: string) => ({ minor: 'warning', major: 'danger', critical: '' }[value] || 'info')
  const dispositionLabel = (value: string) => ({ accept: '让步接收', rework: '返工', reject: '拒收' }[value] || value)
  const dispositionColor = (value: string) => ({ accept: 'warning', rework: 'primary', reject: 'danger' }[value] || 'info')
  const ncrStatusLabel = (value: string) => ({ open: '待处置', disposed: '已处置', closed: '已关闭' }[value] || value)
  const ncrStatusColor = (value: string) => ({ open: 'danger', disposed: 'warning', closed: 'success' }[value] || 'info')

  const loadNcr = async () => {
    ncrLoading.value = true
    try {
      const params: any = {}
      if (ncrFilters.severity) params.severity = ncrFilters.severity
      if (ncrFilters.status) params.status = ncrFilters.status
      ncrRows.value = await Api.get('/qc/ncr', { params })
    } catch {
      ncrRows.value = []
    } finally {
      ncrLoading.value = false
    }
  }

  const submitNcr = async () => {
    if (!ncrForm.part_name) { ElMessage.warning('请输入零件名称'); return }
    ncrSubmitting.value = true
    try {
      await Api.post('/qc/ncr', ncrForm)
      ElMessage.success('NCR已创建')
      showNcrCreate.value = false
      Object.assign(ncrForm, { source_type: 'incoming', part_name: '', defect_desc: '', defect_qty: 1, severity: 'minor' })
      await loadNcr()
    } catch {
      ElMessage.error('创建失败')
    } finally {
      ncrSubmitting.value = false
    }
  }

  const showDisposition = ref(false)
  const dispositionNcr = ref<any>(null)
  const dispSubmitting = ref(false)
  const dispositionForm = reactive({ disposition: 'accept', reason: '' })

  const openDisposition = (row: any) => {
    dispositionNcr.value = row
    dispositionForm.disposition = 'accept'
    dispositionForm.reason = ''
    showDisposition.value = true
  }

  const submitDisposition = async () => {
    if (!dispositionNcr.value) return
    dispSubmitting.value = true
    try {
      await Api.put(`/qc/ncr/${dispositionNcr.value.id}/disposition`, dispositionForm)
      ElMessage.success('处置已记录')
      showDisposition.value = false
      await loadNcr()
    } catch {
      ElMessage.error('处置失败')
    } finally {
      dispSubmitting.value = false
    }
  }

  const showCapaDialog = ref(false)
  const capaNcr = ref<any>(null)
  const capaItems = ref<any[]>([])
  const capaAdding = ref(false)
  const capaAddForm = reactive({ action_type: 'correction', action_desc: '', assigned_to: undefined as any, due_date: '' })

  const openCapa = async (row: any) => {
    capaNcr.value = row
    capaItems.value = []
    Object.assign(capaAddForm, { action_type: 'correction', action_desc: '', assigned_to: undefined, due_date: '' })
    showCapaDialog.value = true
    try { capaItems.value = await Api.get(`/qc/ncr/${row.id}/capa`) } catch { capaItems.value = [] }
  }

  const addCapaItem = async () => {
    if (!capaAddForm.action_desc) { ElMessage.warning('请输入措施描述'); return }
    capaAdding.value = true
    try {
      await Api.post(`/qc/ncr/${capaNcr.value.id}/capa`, capaAddForm)
      ElMessage.success('CAPA已添加')
      Object.assign(capaAddForm, { action_desc: '', assigned_to: undefined, due_date: '' })
      capaItems.value = await Api.get(`/qc/ncr/${capaNcr.value.id}/capa`)
    } catch {
      ElMessage.error('添加失败')
    } finally {
      capaAdding.value = false
    }
  }

  const showClosureDialog = ref(false)
  const closureLoading = ref(false)
  const closureNcrId = ref<any>(null)
  const closure = ref<any>({})
  const closeNote = ref('')
  const recheckForm = reactive({ result: 'pass', inspector_id: undefined as any, notes: '' })
  const closureStep = computed(() => {
    const checklist = closure.value?.checklist || {}
    if (closure.value?.ncr?.closed_at) return 4
    if (checklist.recheck_passed) return 3
    if (checklist.capa_all_closed && checklist.disposition_done) return 2
    if (checklist.disposition_done) return 1
    return 0
  })

  const loadClosure = async () => {
    if (!closureNcrId.value) return
    closure.value = await Api.get(`/qc/ncr/${closureNcrId.value}/closure`)
  }

  const openClosure = async (row: any) => {
    closureNcrId.value = row.id
    closeNote.value = ''
    Object.assign(recheckForm, { result: 'pass', inspector_id: undefined, notes: '' })
    showClosureDialog.value = true
    await loadClosure()
  }

  const submitRecheck = async () => {
    if (!closureNcrId.value) return
    closureLoading.value = true
    try {
      await Api.post(`/qc/ncr/${closureNcrId.value}/recheck`, recheckForm)
      ElMessage.success('复检已登记')
      recheckForm.notes = ''
      await loadClosure()
    } catch {
      ElMessage.error('复检登记失败')
    } finally {
      closureLoading.value = false
    }
  }

  const closeNcr = async () => {
    if (!closureNcrId.value) return
    closureLoading.value = true
    try {
      await Api.post(`/qc/ncr/${closureNcrId.value}/close`, { note: closeNote.value })
      ElMessage.success('NCR已关闭')
      showClosureDialog.value = false
      await Promise.all([loadNcr(), loadCapa()])
    } catch {
      ElMessage.error('关闭失败，请检查闭环条件')
    } finally {
      closureLoading.value = false
    }
  }

  return {
    ncrFilters,
    ncrRows,
    ncrLoading,
    showNcrCreate,
    ncrSubmitting,
    ncrForm,
    severityLabel,
    severityColor,
    dispositionLabel,
    dispositionColor,
    ncrStatusLabel,
    ncrStatusColor,
    loadNcr,
    submitNcr,
    showDisposition,
    dispositionNcr,
    dispSubmitting,
    dispositionForm,
    openDisposition,
    submitDisposition,
    showCapaDialog,
    capaNcr,
    capaItems,
    capaAdding,
    capaAddForm,
    openCapa,
    addCapaItem,
    showClosureDialog,
    closureLoading,
    closure,
    closeNote,
    recheckForm,
    closureStep,
    openClosure,
    submitRecheck,
    closeNcr,
  }
}
