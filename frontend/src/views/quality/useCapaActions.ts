import { ref, reactive } from 'vue'
import Api from '../../api'
import { ElMessage } from 'element-plus'

export function useCapaActions() {
  const capaFilters = reactive({ status: '', assignee: '' })
  const capaRows = ref<any[]>([])
  const capaLoading = ref(false)
  const capaRowClass = ({ row }: any) => row.overdue && row.status !== 'closed' ? 'capa-overdue-row' : ''

  const loadCapa = async () => {
    capaLoading.value = true
    try {
      const params: any = {}
      if (capaFilters.status) params.status = capaFilters.status
      if (capaFilters.assignee) params.assigned_to = capaFilters.assignee
      capaRows.value = await Api.get('/qc/capa', { params })
    } catch {
      capaRows.value = []
    } finally {
      capaLoading.value = false
    }
  }

  const completeCapa = async (row: any) => {
    try {
      await Api.put(`/qc/capa/${row.id}/complete`, {})
      ElMessage.success('CAPA已完成')
      await loadCapa()
    } catch {
      ElMessage.error('操作失败')
    }
  }

  return {
    capaFilters,
    capaRows,
    capaLoading,
    capaRowClass,
    loadCapa,
    completeCapa,
  }
}
