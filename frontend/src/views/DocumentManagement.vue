<template>
  <div class="page">
    <PageToolbar
      title="文档/图纸管理"
      subtitle="图纸、SOP、工艺文件、检验标准统一上传、签发、收回与签收。"
      aria-label="文档图纸管理工具栏"
    >
      <template #icon>
        <el-icon><Files /></el-icon>
      </template>
      <template #actions>
        <el-button :icon="Refresh" :loading="loading" @click="refresh">刷新</el-button>
        <el-button type="primary" :icon="UploadFilled" @click="dlgUpload = true">上传新文档</el-button>
        <el-button @click="openEnterprise(null)">现场扫码</el-button>
      </template>
      <template #filters>
        <el-form inline size="small" class="toolbar-form">
          <el-form-item label="文档类型">
            <el-select v-model="filter.type" clearable placeholder="全部" style="width:140px">
              <el-option v-for="t in DOC_TYPES" :key="t.value" :label="t.label" :value="t.value" />
            </el-select>
          </el-form-item>
          <el-form-item label="状态">
            <el-select v-model="filter.status" clearable placeholder="全部" style="width:120px">
              <el-option v-for="s in STATUSES" :key="s" :label="STATUS_LABEL[s]" :value="s" />
            </el-select>
          </el-form-item>
          <el-form-item label="签发目标">
            <el-select v-model="filter.issued_to" clearable placeholder="全部" style="width:140px">
              <el-option v-for="t in ISSUE_TARGETS" :key="t" :label="ISSUE_TARGET_LABEL[t]" :value="t" />
            </el-select>
          </el-form-item>
          <el-form-item label="设备实例">
            <el-input v-model.number="filter.equipment_instance_id" placeholder="ID" clearable style="width:120px" />
          </el-form-item>
          <el-form-item label="BOM 节点">
            <el-input v-model.number="filter.bom_node_id" placeholder="ID" clearable style="width:120px" />
          </el-form-item>
          <el-form-item label="标签"><el-input v-model="filter.tag" placeholder="标签" clearable style="width:120px" /></el-form-item>
          <el-form-item label="版本"><el-input v-model="filter.version" placeholder="如 A0" clearable style="width:100px" /></el-form-item>
          <el-form-item label="密级">
            <el-select v-model="filter.classification" clearable placeholder="全部" style="width:120px">
              <el-option label="公开" value="public" /><el-option label="内部" value="internal" />
              <el-option label="机密" value="confidential" /><el-option label="绝密" value="secret" />
            </el-select>
          </el-form-item>
          <el-form-item label="搜索">
            <el-input v-model="filter.q" placeholder="名称/编码" clearable style="width:180px" @keyup.enter="refresh" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="refresh" size="small">查询</el-button>
            <el-button @click="resetFilter" size="small">重置</el-button>
          </el-form-item>
        </el-form>
      </template>
    </PageToolbar>

    <DocumentStats
      :stats="stats"
      :total-count="totalCount"
      :pending-count="pendingCount"
      @pending-click="loadPendingAck"
    />

    <DocumentListCard
      v-model:page="page"
      v-model:page-size="pageSize"
      :items="items"
      :loading="loading"
      :load-error="loadError"
      :total="total"
      :doc-type-label="DOC_TYPE_LABEL"
      :status-label="STATUS_LABEL"
      :status-tag="STATUS_TAG"
      :issue-target-label="ISSUE_TARGET_LABEL"
      @refresh="refresh"
      @upload="dlgUpload = true"
      @row-click="onRowClick"
      @preview="openPreview"
      @download="downloadDoc"
      @acknowledge="acknowledge"
      @load-acks="loadAcks"
      @versions="openVersions"
      @new-version="openNewVersion"
      @control="openControl"
      @governance="openEnterprise"
      @issue="openIssue"
      @revoke="openRevoke"
      @archive="archiveDoc"
    />

    <el-dialog v-model="previewVisible" :title="'预览：' + previewTitle" width="80%" top="5vh" @closed="closePreview">
      <div style="position: relative; min-height: 60vh; background: #f5f5f5; overflow: hidden" @contextmenu.prevent>
        <div style="position: absolute; inset: 0; pointer-events: none; z-index: 9; color: rgba(0,0,0,.10); font-size: 28px; display: flex; align-items: center; justify-content: center; transform: rotate(-25deg); user-select: none">{{ previewWatermark }}</div>
        <iframe v-if="previewType.includes('pdf')" :src="previewUrl" style="width: 100%; height: 70vh; border: 0" />
        <img v-else :src="previewUrl" draggable="false" style="max-width: 100%; display: block; margin: 0 auto" />
      </div>
      <template #footer><span style="color: var(--el-color-info); font-size: 12px">水印已绑定当前用户与时间；预览禁止右键/下载，请勿截屏外传</span></template>
    </el-dialog>

    <DocumentUploadDialog
      ref="uploadDialogRef"
      v-model="dlgUpload"
      v-model:upload-form="uploadForm"
      :doc-types="DOC_TYPES"
      :instances="instances"
      :bom-nodes="bomNodes"
      :bom-loading="bomLoading"
      :uploading="uploading"
      @file-change="onFileChange"
      @submit="submitUpload"
    />

    <DocumentIssueDialog
      v-model="dlgIssue"
      v-model:issue-to="issueTo"
      :target="issueTarget"
      :issue-targets="ISSUE_TARGETS"
      :issue-target-label="ISSUE_TARGET_LABEL"
      :acting="acting"
      @submit="submitIssue"
    />

    <DocumentRevokeDialog
      v-model="dlgRevoke"
      v-model:reason="revokeReason"
      :target="revokeTarget"
      :acting="acting"
      @submit="submitRevoke"
    />

    <DocumentControlDrawer v-model="dlgControl" :doc="controlDoc" @changed="refresh" />
    <DocumentEnterpriseDrawer v-model="enterpriseVisible" :doc="enterpriseDoc" />

    <DocumentVersionDrawer
      @lock="lockVersion"
      @unlock="unlockVersion"
      @rollback="rollbackVersion"
      v-model="dlgVersions"
      :versions="versions"
      :events="versionEvents"
      :current="versionsCurrent"
      :loading="versionsLoading"
      :status-label="STATUS_LABEL"
      :status-tag="STATUS_TAG"
      @download="downloadDocById"
    />
  </div>

  <DocumentAckDialog
    v-model="dlgAcks"
    :target="ackTarget"
    :ack-list="ackList"
  />

</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Refresh, UploadFilled } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'
import PageToolbar from '../components/PageToolbar.vue'
import DocumentAckDialog from './documents/DocumentAckDialog.vue'
import DocumentIssueDialog from './documents/DocumentIssueDialog.vue'
import DocumentListCard from './documents/DocumentListCard.vue'
import DocumentRevokeDialog from './documents/DocumentRevokeDialog.vue'
import DocumentStats from './documents/DocumentStats.vue'
import DocumentUploadDialog from './documents/DocumentUploadDialog.vue'
import DocumentEnterpriseDrawer from './documents/DocumentEnterpriseDrawer.vue'
import DocumentControlDrawer from './documents/DocumentControlDrawer.vue'
import DocumentVersionDrawer from './documents/DocumentVersionDrawer.vue'

const route = useRoute()

// 常量 (与后端 services/documentService.js 一致)
const DOC_TYPES = [
  { value: 'drawing',  label: '图纸' },
  { value: 'sop',      label: 'SOP' },
  { value: 'process',  label: '工艺文件' },
  { value: 'qc_std',   label: '质检标准' },
  { value: 'contract', label: '合同' },
  { value: 'report',   label: '报告' },
  { value: 'other',    label: '其他' }
]
const DOC_TYPE_LABEL: Record<string, string> = Object.fromEntries(DOC_TYPES.map(t => [t.value, t.label]))
const STATUSES = ['draft', 'issued', 'revoked', 'archived', 'obsolete']
const STATUS_LABEL: Record<string, string> = {
  draft: '草稿', issued: '已签发', revoked: '已收回', archived: '已归档', obsolete: '已作废'
}
const STATUS_TAG: Record<string, 'success' | 'info' | 'warning' | 'danger' | ''> = {
  draft: 'info', issued: 'success', revoked: 'warning', archived: 'danger', obsolete: 'info'
}
const ISSUE_TARGETS = ['assembly', 'welding', 'qc', 'warehouse', 'field', 'design', 'procurement', 'management']
const ISSUE_TARGET_LABEL: Record<string, string> = {
  assembly: '装配车间', welding: '焊接车间', qc: '质检部', warehouse: '仓库',
  field: '现场服务', design: '设计部', procurement: '采购部', management: '管理层'
}

// 状态
const items = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const loadError = ref('')
const stats = reactive<{ by_status?: any[]; by_type?: any[]; total_bytes?: number; human_total?: string }>({})
const totalCount = computed(() => {
  if (!stats.by_status) return 0
  return stats.by_status.reduce((s, b) => s + b.count, 0)
})
const instances = ref<any[]>([])
const bomNodes = ref<any[]>([])
const bomLoading = ref(false)

const filter = reactive({
  type: '' as string, status: '' as string, issued_to: '' as string,
  equipment_instance_id: null as number | null, bom_node_id: null as number | null,
  q: '' as string, tag: '' as string, version: '' as string, classification: '' as string
})

const resetFilter = () => {
  filter.type = ''; filter.status = ''; filter.issued_to = ''
  filter.equipment_instance_id = null; filter.bom_node_id = null; filter.q = ''
  page.value = 1
  refresh()
}

const refresh = async () => {
  loading.value = true
  loadError.value = ''
  try {
    const params: any = { limit: pageSize.value, offset: (page.value - 1) * pageSize.value }
    if (filter.type) params.doc_type = filter.type
    if (filter.status) params.status = filter.status
    if (filter.issued_to) params.issued_to = filter.issued_to
    if (filter.equipment_instance_id) params.equipment_instance_id = filter.equipment_instance_id
    if (filter.bom_node_id) params.bom_node_id = filter.bom_node_id
    if (filter.q) params.q = filter.q
    if (filter.tag) params.tag = filter.tag
    if (filter.version) params.version = filter.version
    if (filter.classification) params.classification = filter.classification
    const r: any = await api.documents(params)
    items.value = r.items || []
    total.value = r.total || 0
  } catch (error: any) {
    items.value = []
    total.value = 0
    loadError.value = error?.message || '文档服务暂时不可用，请稍后重试。'
  } finally {
    loading.value = false
  }
  // 统计
  try {
    const s: any = await api.documentStats()
    Object.assign(stats, s)
  } catch (_e) { /* 统计失败不影响列表 */ }
}

const loadInstances = async () => {
  try {
    const r: any = await api.instances({ limit: 500 })
    instances.value = r.items || r || []
  } catch (_e) { instances.value = [] }
}

const loadBomNodes = async (instanceId?: number | null) => {
  bomNodes.value = []
  if (!instanceId) return
  bomLoading.value = true
  try {
    const r: any = await api.get(`/equipment_instances/${instanceId}/bom`, { params: { view: 'flat' } })
    bomNodes.value = r.items || []
  } catch (_e) {
    bomNodes.value = []
  } finally {
    bomLoading.value = false
  }
}

// 行点击 → 不展开, 避免误操作
const onRowClick = () => { /* noop */ }

// 下载
// 2026-10-19：改走带 Authorization 的 blob 下载（window.open 无法带请求头 → 401）
const enterpriseVisible = ref(false)
const enterpriseDoc = ref<any>(null)
const dlgControl = ref(false)
const controlDoc = ref<any>(null)
const previewVisible = ref(false)
const previewUrl = ref('')
const previewType = ref('')
const previewTitle = ref('')
const previewWatermark = ref('')
const openPreview = async (row: any) => {
  try {
    const result: any = await api.previewDocument(row.id)
    let userName = 'user'
    try { const u = JSON.parse(localStorage.getItem('tbm_user') || '{}'); userName = u.full_name || u.username || 'user' } catch (_error) { /* ignore */ }
    previewUrl.value = result.url
    previewType.value = result.type
    previewTitle.value = row.title || row.file_name
    previewWatermark.value = `${userName} ${new Date().toLocaleString('zh-CN')}`
    previewVisible.value = true
  } catch (error: any) {
    ElMessage.error(error?.message || '预览失败')
  }
}
const closePreview = () => {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = ''
  previewVisible.value = false
}

const downloadDoc = async (row: any) => {
  try {
    await api.downloadDocument(row.id)
  } catch (error: any) {
    ElMessage.error(error?.message || '下载失败')
  }
}
const downloadDocById = async (v: any) => {
  try {
    await api.downloadDocument(v.id)
  } catch (error: any) {
    ElMessage.error(error?.message || '下载失败')
  }
}

// 归档
const archiveDoc = async (row: any) => {
  try {
    await ElMessageBox.confirm(`确认归档《${row.title}》? 归档后仅历史保留, 不再出现在签发列表。`, '归档确认', { type: 'warning' })
  } catch { return }
  try {
    await api.archiveDocument(row.id)
    ElMessage.success('已归档')
    refresh()
  } catch (e: any) { ElMessage.error(e.message || '归档失败') }
}

// 上传
const dlgUpload = ref(false)
const uploading = ref(false)
const uploadDialogRef = ref<any>(null)
const uploadForm = reactive({
  title: '', doc_code: '', version: 'A0', doc_type: 'drawing',
  equipment_instance_id: null as number | null, bom_node_id: null as number | null, eco_id: '',
  description: '', tags: '', parent_document_id: null as number | null
})
const resetUpload = () => {
  uploadForm.title = ''; uploadForm.doc_code = ''; uploadForm.version = 'A0'
  uploadForm.doc_type = 'drawing'; uploadForm.equipment_instance_id = null
  uploadForm.bom_node_id = null as any; uploadForm.eco_id = ''
  uploadForm.description = ''; uploadForm.tags = ''; uploadForm.parent_document_id = null
  uploadDialogRef.value?.clearFiles()
}
const onFileChange = (file: any) => {
  // 自动从文件名推断标题
  if (!uploadForm.title && file?.name) {
    uploadForm.title = file.name.replace(/\.[^.]+$/, '')
  }
}
const submitUpload = async (fileList: any[] = []) => {
  if (!fileList.length) return ElMessage.warning('请先选择文件')
  if (!uploadForm.title || !uploadForm.doc_code || !uploadForm.doc_type) {
    return ElMessage.warning('请填写 文档标题 / 文档编码 / 类型')
  }
  // 2026-10-19：documents.equipment_instance_id 是 NOT NULL，前端原来标"可选"→ 提交后 500
  if (!uploadForm.equipment_instance_id) {
    return ElMessage.warning('请选择关联设备（文档需挂到某台装备实例）')
  }
  const file = fileList[0].raw as File
  if (file.size > 50 * 1024 * 1024) return ElMessage.error('文件超过 50MB')
  const meta: any = {
    title: String(uploadForm.title || '').trim(), doc_code: String(uploadForm.doc_code || '').trim(), version: String(uploadForm.version || 'A0').trim(),
    doc_type: uploadForm.doc_type, equipment_instance_id: uploadForm.equipment_instance_id,
    bom_node_id: uploadForm.bom_node_id, eco_id: uploadForm.eco_id || undefined,
    description: uploadForm.description || undefined,
    tags: uploadForm.tags ? uploadForm.tags.split(',').map((s: string) => s.trim()).filter(Boolean) : undefined,
    parent_document_id: uploadForm.parent_document_id || undefined
  }
  uploading.value = true
  try {
    const r: any = await api.uploadDocument(file, meta)
    ElMessage.success(`上传成功, ID=${r.id}`)
    dlgUpload.value = false
    resetUpload()
    refresh()
  } catch (e: any) { ElMessage.error(e.message || '上传失败') }
  finally { uploading.value = false }
}

// 签发
const dlgIssue = ref(false)
const issueTarget = ref<any>(null)
const issueTo = ref('')
const acting = ref(false)

const pendingCount = ref(0)
const dlgAcks = ref(false)
const ackTarget = ref<any>(null)
const ackList = ref<any[]>([])
const openIssue = (row: any) => {
  issueTarget.value = row
  issueTo.value = row.issued_to || 'assembly'
  dlgIssue.value = true
}
const submitIssue = async () => {
  if (!issueTo.value) return ElMessage.warning('请选择签发目标')
  acting.value = true
  try {
    await api.issueDocument(issueTarget.value.id, issueTo.value)
    ElMessage.success('签发成功')
    dlgIssue.value = false
    refresh()
  } catch (e: any) { ElMessage.error(e.message || '签发失败') }
  finally { acting.value = false }
}

// 收回
const dlgRevoke = ref(false)
const revokeTarget = ref<any>(null)
const revokeReason = ref('')
const openRevoke = (row: any) => {
  revokeTarget.value = row
  revokeReason.value = ''
  dlgRevoke.value = true
}
const submitRevoke = async () => {
  if (!revokeReason.value.trim()) return ElMessage.warning('请填写收回原因')
  acting.value = true
  try {
    await api.revokeDocument(revokeTarget.value.id, revokeReason.value.trim())
    ElMessage.success('已收回')
    dlgRevoke.value = false
    refresh()
  } catch (e: any) { ElMessage.error(e.message || '收回失败') }
  finally { acting.value = false }
}

// 版本历史
const dlgVersions = ref(false)
const versions = ref<any[]>([])
const versionsCurrent = ref<any>(null)
const versionsLoading = ref(false)
const openEnterprise = (row: any) => { enterpriseDoc.value = row; enterpriseVisible.value = true }

const openNewVersion = async (row: any) => {
  try {
    const next: any = await api.get(`/documents/${row.id}/next-version`)
    uploadForm.title = row.title || row.doc_name || ''
    uploadForm.doc_code = row.doc_code || ''
    uploadForm.version = next.suggested_version || 'A1'
    uploadForm.doc_type = row.doc_type || 'drawing'
    uploadForm.equipment_instance_id = row.equipment_instance_id || null
    uploadForm.bom_node_id = row.bom_node_id || null
    uploadForm.parent_document_id = row.id
    dlgUpload.value = true
  } catch (error: any) { ElMessage.error('获取新版本号失败：' + (error.response?.data?.message || error.message)) }
}

const openControl = (row: any) => { controlDoc.value = row; dlgControl.value = true }

const reloadVersions = async () => {
  if (!versionsCurrent.value?.id) return
  const row = versionsCurrent.value
  await openVersions(row)
}

const lockVersion = async (version: any) => {
  try { await api.post(`/documents/${version.id}/lock`, {}); ElMessage.success('版本已锁定'); await reloadVersions() }
  catch (error: any) { ElMessage.error('锁定失败：' + (error.response?.data?.message || error.message)) }
}
const unlockVersion = async (version: any) => {
  try { await api.post(`/documents/${version.id}/unlock`, {}); ElMessage.success('版本已解锁'); await reloadVersions() }
  catch (error: any) { ElMessage.error('解锁失败：' + (error.response?.data?.message || error.message)) }
}
const rollbackVersion = async (version: any) => {
  try {
    const { value } = await ElMessageBox.prompt('回滚原因', '回滚到 v' + version.version, { inputValue: '回退到历史版本' })
    const result: any = await api.post(`/documents/${version.id}/rollback`, { source_document_id: version.id, reason: value })
    ElMessage.success(`已生成新版本 v${result.version}（草稿）`)
    await refresh()
  } catch (error: any) { if (error !== 'cancel' && error !== 'close') ElMessage.error('回滚失败：' + (error.response?.data?.message || error.message)) }
}

const openVersions = async (row: any) => {
  versionsCurrent.value = row
  dlgVersions.value = true
  versionsLoading.value = true
  try {
    const r: any = await api.documentVersions(row.id)
    versions.value = r.items || []
    versionEvents.value = r.events || []
  } catch (_e) { versions.value = []; versionEvents.value = [] }
  finally { versionsLoading.value = false }
}

const versionEvents = ref<any[]>([])

// 签收
const acknowledge = async (row: any) => {
  try {
    await api.acknowledgeDocument(row.id)
    ElMessage.success('签收成功')
    refresh()
    loadPendingCount()
  } catch (e: any) { ElMessage.error(e.message || '签收失败') }
}

// 查看签收记录
const loadAcks = async (row: any) => {
  ackTarget.value = row
  dlgAcks.value = true
  try {
    var r: any = await api.documentAcknowledgements(row.id)
    ackList.value = r.acknowledgements || []
  } catch (_e) { ackList.value = [] }
}

// 加载待签收数量
const loadPendingCount = async () => {
  try {
    var r: any = await api.pendingAckDocuments()
    pendingCount.value = r.count || 0
  } catch (_e) { pendingCount.value = 0 }
}

// 加载待签收列表
const loadPendingAck = async () => {
  try {
    var r: any = await api.pendingAckDocuments()
    items.value = r.pending || []
    total.value = r.count || 0
  } catch (_e) { /* ignore */ }
}


onMounted(async () => {
  const routeInstanceId = Number(route.query.instance_id || route.query.equipment_instance_id || 0)
  if (routeInstanceId) {
    filter.equipment_instance_id = routeInstanceId
    uploadForm.equipment_instance_id = routeInstanceId
  }
  watch(() => uploadForm.equipment_instance_id, (instanceId) => {
    uploadForm.bom_node_id = null as any
    loadBomNodes(instanceId)
  })
  if (uploadForm.equipment_instance_id) await loadBomNodes(uploadForm.equipment_instance_id)
  await Promise.all([refresh(), loadInstances(), loadPendingCount()])
})
</script>

<style scoped>
.page { padding: 16px }
</style>
