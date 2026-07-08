import { reactive, ref, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../../api'
import { DOC_TYPE_LABEL } from './bomShared'

export function useBomDocuments(instanceId: Ref<number | null>) {
  const docFilter = reactive({ bom_node_id: null as number | null, doc_type: '' })
  const bomDocs = ref<any[]>([])
  const docLoading = ref(false)

  async function loadBomDocs() {
    docLoading.value = true
    try {
      const params: any = { equipment_instance_id: instanceId.value }
      if (docFilter.bom_node_id) params.bom_node_id = docFilter.bom_node_id
      if (docFilter.doc_type) params.doc_type = docFilter.doc_type
      const result: any = await api.get('/documents', { params })
      bomDocs.value = result.items || result.data?.items || []
    } catch (error: any) {
      ElMessage.warning('文档加载失败: ' + (error?.response?.data?.message || error.message))
    } finally {
      docLoading.value = false
    }
  }

  function downloadBomDoc(row: any) {
    const token = localStorage.getItem('tbm_access_token') || localStorage.getItem('tbm_token') || localStorage.getItem('token') || ''
    const link = document.createElement('a')
    link.href = '/api/documents/' + row.id + '/download?token=' + encodeURIComponent(token)
    link.target = '_blank'
    link.click()
  }

  return {
    docFilter,
    DOC_TYPE_LABEL,
    bomDocs,
    docLoading,
    loadBomDocs,
    downloadBomDoc,
  }
}
