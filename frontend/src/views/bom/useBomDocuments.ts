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

  // 2026-10-19：URL 带 token 会被 authMiddleware 拒绝（只认 Authorization header）→ 改 blob 下载
  async function downloadBomDoc(row: any) {
    try {
      await api.downloadDocument(row.id)
    } catch (error: any) {
      ElMessage.error(error?.message || '下载失败')
    }
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
