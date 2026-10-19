import { api, ACCESS_KEY } from './client'
import { parseContentDispositionFilename } from '../domain/download'

export function createDocumentsApi() {
  return {
    documents: (params?: any) => api.get('/documents', { params }),
    document: (id: number) => api.get(`/documents/${id}`),
    documentVersions: (id: number) => api.get(`/documents/${id}/versions`),
    documentHistory: (id: number) => api.get(`/documents/${id}/history`),
    documentStats: () => api.get('/documents/stats'),
    uploadDocument,
    issueDocument: (id: number, issued_to: string) => api.put(`/documents/${id}/issue`, { issued_to }),
    revokeDocument: (id: number, reason: string) => api.put(`/documents/${id}/revoke`, { reason }),
    archiveDocument: (id: number) => api.delete(`/documents/${id}`),
    acknowledgeDocument: (id: number) => api.post(`/documents/${id}/acknowledge`),
    documentAcknowledgements: (id: number) => api.get(`/documents/${id}/acknowledgements`),
    pendingAckDocuments: (params?: any) => api.get('/documents/pending-ack', { params }),
    documentDownloadUrl: (id: number) => `/api/documents/${id}/download`,
    downloadDocument: downloadDocumentFile,
    documentPreviewUrl: (id: number) => `/uploads/${id}`,
  }
}

/**
 * 2026-10-19：文档下载改为「带 Authorization 的 fetch + blob」。
 * 原因：原来的 window.open(url?t=token) 无法带请求头，而后端 authMiddleware 只认
 * Authorization: Bearer，于是新标签页直接 401「未登录或 token 无效」。
 */
async function downloadDocumentFile(id: number, fallbackName?: string): Promise<void> {
  const token = localStorage.getItem(ACCESS_KEY) || localStorage.getItem('tbm_token')
  const response = await fetch(`/api/documents/${id}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!response.ok) {
    let message = `下载失败 (HTTP ${response.status})`
    try {
      const body = await response.json()
      message = body.message || body.error || message
    } catch (_error) { /* 非 JSON 响应 */ }
    throw new Error(message)
  }
  const blob = await response.blob()
  const fileName = parseContentDispositionFilename(
    response.headers.get('Content-Disposition'),
    fallbackName || `document-${id}`,
  )
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = fileName
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(objectUrl), 2000)
}

async function uploadDocument(file: File, meta: any) {
  const buffer = await file.arrayBuffer()
  const token = localStorage.getItem(ACCESS_KEY) || localStorage.getItem('tbm_token')
  const response = await fetch('/api/documents', {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      // 2026-10-19：HTTP header 只允许 ISO-8859-1，中文标题直接放进去会抛
      // "Failed to read the 'headers' property ... non ISO-8859-1 code point"
      'X-Doc-Meta': encodeURIComponent(JSON.stringify(meta)),
      'X-File-Name': encodeURIComponent(file.name),
      'X-File-Mime': file.type || 'application/octet-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: buffer
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }))
    throw new Error(error.error || error.message || `HTTP ${response.status}`)
  }
  return response.json()
}
