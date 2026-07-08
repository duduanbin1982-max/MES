import { api, ACCESS_KEY } from './client'

export function createDocumentsApi() {
  return {
    documents: (params?: any) => api.get('/documents', { params }),
    document: (id: number) => api.get(`/documents/${id}`),
    documentVersions: (id: number) => api.get(`/documents/${id}/versions`),
    documentStats: () => api.get('/documents/stats'),
    uploadDocument,
    issueDocument: (id: number, issued_to: string) => api.put(`/documents/${id}/issue`, { issued_to }),
    revokeDocument: (id: number, reason: string) => api.put(`/documents/${id}/revoke`, { reason }),
    archiveDocument: (id: number) => api.delete(`/documents/${id}`),
    acknowledgeDocument: (id: number) => api.post(`/documents/${id}/acknowledge`),
    documentAcknowledgements: (id: number) => api.get(`/documents/${id}/acknowledgements`),
    pendingAckDocuments: (params?: any) => api.get('/documents/pending-ack', { params }),
    documentDownloadUrl: (id: number) => `/api/documents/${id}/download`,
    documentPreviewUrl: (id: number) => `/uploads/${id}`,
  }
}

async function uploadDocument(file: File, meta: any) {
  const buffer = await file.arrayBuffer()
  const token = localStorage.getItem(ACCESS_KEY) || localStorage.getItem('tbm_token')
  const response = await fetch('/api/documents', {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'X-Doc-Meta': JSON.stringify(meta),
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
