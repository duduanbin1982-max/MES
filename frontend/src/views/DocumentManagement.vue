<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title"><el-icon><Files /></el-icon> 文档/图纸管理 (PLM 基础)</div>
      <div style="display:flex; gap:8px; align-items:center">
        <el-button @click="refresh" :icon="Refresh">刷新</el-button>
        <el-button type="primary" @click="dlgUpload = true" :icon="UploadFilled">上传新文档</el-button>
      </div>
    </div>

    <!-- 统计卡片 -->
    <div class="stat-row">
      <el-card shadow="never" class="stat-card">
        <div class="stat-label">总文档数</div>
        <div class="stat-value">{{ stats.total_bytes !== undefined ? totalCount : '—' }}</div>
      </el-card>
      <el-card shadow="never" class="stat-card">
        <div class="stat-label">已签发</div>
        <div class="stat-value" style="color:var(--el-color-success)">{{ countByStatus('issued') }}</div>
      </el-card>
      <el-card shadow="never" class="stat-card">
        <div class="stat-label">草稿</div>
        <div class="stat-value" style="color:var(--el-color-info)">{{ countByStatus('draft') }}</div>
      </el-card>
      <el-card shadow="never" class="stat-card">
        <div class="stat-label">已收回</div>
        <div class="stat-value" style="color:var(--el-color-warning)">{{ countByStatus('revoked') }}</div>
      </el-card>
      <el-card shadow="never" class="stat-card">
        <div class="stat-label">存储占用</div>
        <div class="stat-value" style="font-size:16px">{{ stats.human_total || '—' }}</div>
      </el-card>
    </div>

    <!-- 过滤 -->
    <el-card shadow="never" style="margin-bottom:12px">
      <el-form inline size="small">
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
        <el-form-item label="搜索">
          <el-input v-model="filter.q" placeholder="名称/编码" clearable style="width:180px" @keyup.enter="refresh" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="refresh" size="small">查询</el-button>
          <el-button @click="resetFilter" size="small">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

      <el-card shadow="never" class="stat-card" style="cursor:pointer;border-left:3px solid var(--el-color-danger)" @click="loadPendingAck">
        <div class="stat-label">待签收 <span style="color:var(--el-color-danger)">NEW</span></div>
        <div class="stat-value" style="color:var(--el-color-danger)">{{ pendingCount }}</div>
      </el-card>

    <!-- 列表 -->
    <el-card shadow="never">
      <el-table :data="items" v-loading="loading" stripe size="small" @row-click="onRowClick">
        <el-table-column label="" width="40">
          <template #default="{ row }"><span style="font-size:18px">{{ row.icon }}</span></template>
        </el-table-column>
        <el-table-column prop="doc_code" label="编码" width="160" />
        <el-table-column prop="title" label="名称" min-width="200" show-overflow-tooltip />
        <el-table-column label="类型" width="100">
          <template #default="{ row }">
            <el-tag size="small">{{ DOC_TYPE_LABEL[row.doc_type] || row.doc_type }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="version" label="版本" width="60" />
        <el-table-column prop="human_size" label="大小" width="80" />
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="STATUS_TAG[row.status]" size="small">{{ STATUS_LABEL[row.status] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="签发目标" width="100">
          <template #default="{ row }">
            <span v-if="row.issued_to">{{ ISSUE_TARGET_LABEL[row.issued_to] || row.issued_to }}</span>
            <span v-else style="color:var(--el-text-color-placeholder)">—</span>
          </template>
        </el-table-column>
        <el-table-column label="关联" width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.instance_name" style="color:var(--el-color-primary)"><el-icon><Box /></el-icon> {{ row.instance_name }}</span>
            <span v-if="row.bom_part_number" style="margin-left:6px; color:var(--el-color-success)"><el-icon><Tools /></el-icon> {{ row.bom_part_number }}</span>
            <span v-if="!row.instance_name && !row.bom_part_number" style="color:var(--el-text-color-placeholder)">—</span>
          </template>
        </el-table-column>
        <el-table-column prop="created_at_alias" label="上传时间" width="160" />
        <el-table-column label="操作" width="260" fixed="right">
          <template #default="{ row }">
            <el-button size="small" link @click.stop="downloadDoc(row)">下载</el-button>

            <el-button v-if="row.status === 'issued'" size="small" link type="success" @click.stop="acknowledge(row)">签收</el-button>
            <el-button size="small" link type="info" @click.stop="loadAcks(row)">签收记录</el-button>            <el-button size="small" link type="primary" @click.stop="openVersions(row)">版本</el-button>
            <el-button v-if="row.status === 'draft'" size="small" link type="success" @click.stop="openIssue(row)">签发</el-button>
            <el-button v-if="row.status === 'issued'" size="small" link type="warning" @click.stop="openRevoke(row)">收回</el-button>
            <el-button v-if="row.status !== 'archived'" size="small" link type="danger" @click.stop="archiveDoc(row)">归档</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-pagination
        v-model:current-page="page" v-model:page-size="pageSize"
        :total="total" :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next, jumper"
        style="margin-top:12px; justify-content:flex-end"
        @current-change="refresh" @size-change="refresh"
      />
    </el-card>

    <!-- 上传对话框 -->
    <el-dialog v-model="dlgUpload" title="上传文档" width="640px" :close-on-click-modal="false">
      <el-form :model="uploadForm" label-width="100px" size="default">
        <el-form-item label="文件" required>
          <el-upload
            ref="uploadRef"
            :auto-upload="false"
            :limit="1"
            :on-change="onFileChange"
            :on-exceed="() => ElMessage.warning('只能选择 1 个文件')"
            drag
          >
            <el-icon style="font-size:48px; color:var(--el-color-primary)"><UploadFilled /></el-icon>
            <div class="el-upload__text">拖拽文件到此处，或<em>点击选择</em></div>
            <template #tip>
              <div style="color:var(--el-color-info); font-size:12px">支持 PDF / Word / Excel / 图片 / DWG / STEP, 最大 50MB</div>
            </template>
          </el-upload>
        </el-form-item>
        <el-form-item label="文档标题" required>
          <el-input v-model="uploadForm.title" placeholder="例如: 机架总装图 A0" />
        </el-form-item>
        <el-form-item label="文档编码" required>
          <el-input v-model="uploadForm.doc_code" placeholder="例如: ZZ-001-A0" />
        </el-form-item>
        <el-form-item label="版本">
          <el-input v-model="uploadForm.version" placeholder="默认 A0" />
        </el-form-item>
        <el-form-item label="类型" required>
          <el-select v-model="uploadForm.doc_type" placeholder="请选择" style="width:100%">
            <el-option v-for="t in DOC_TYPES" :key="t.value" :label="t.label" :value="t.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="关联设备">
          <el-select v-model="uploadForm.equipment_instance_id" placeholder="可选" clearable filterable style="width:100%">
            <el-option v-for="i in instances" :key="i.id" :label="`${i.instance_code || ''} ${i.instance_name || ''}`" :value="i.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="关联 BOM 节点">
          <el-input v-model.number="uploadForm.bom_node_id" placeholder="节点 ID, 可选" />
        </el-form-item>
        <el-form-item label="ECO 变更号">
          <el-input v-model="uploadForm.eco_id" placeholder="可选" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="uploadForm.description" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="标签">
          <el-input v-model="uploadForm.tags" placeholder="逗号分隔, 例如: 易损件,关键件" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlgUpload = false">取消</el-button>
        <el-button type="primary" :loading="uploading" @click="submitUpload">提交上传</el-button>
      </template>
    </el-dialog>

    <!-- 签发对话框 -->
    <el-dialog v-model="dlgIssue" title="签发文档" width="480px">
      <el-form label-width="100px">
        <el-form-item label="文档">{{ issueTarget?.title }} <el-tag size="small">{{ issueTarget?.doc_code }}</el-tag></el-form-item>
        <el-form-item label="签发目标" required>
          <el-select v-model="issueTo" placeholder="请选择" style="width:100%">
            <el-option v-for="t in ISSUE_TARGETS" :key="t" :label="ISSUE_TARGET_LABEL[t]" :value="t" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlgIssue = false">取消</el-button>
        <el-button type="primary" :loading="acting" @click="submitIssue">确认签发</el-button>
      </template>
    </el-dialog>

    <!-- 收回对话框 -->
    <el-dialog v-model="dlgRevoke" title="收回文档" width="480px">
      <el-form label-width="100px">
        <el-form-item label="文档">{{ revokeTarget?.title }}</el-form-item>
        <el-form-item label="收回原因" required>
          <el-input v-model="revokeReason" type="textarea" :rows="3" placeholder="例如: 工艺更新 / 错版 / 客户要求" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlgRevoke = false">取消</el-button>
        <el-button type="warning" :loading="acting" @click="submitRevoke">确认收回</el-button>
      </template>
    </el-dialog>

    <!-- 版本历史侧栏 -->
    <el-drawer v-model="dlgVersions" title="版本历史" size="640px" :with-header="true">
      <div v-if="versionsLoading" v-loading="true" style="height:100%"></div>
      <div v-else>
        <div style="margin-bottom:12px; color:var(--el-color-info)">文档: <b>{{ versionsCurrent?.title }}</b> ({{ versionsCurrent?.doc_code }})</div>
        <el-timeline>
          <el-timeline-item
            v-for="v in versions"
            :key="v.id"
            :type="v.id === versionsCurrent?.id ? 'primary' : 'info'"
            :timestamp="v.created_at"
            :hollow="v.id !== versionsCurrent?.id"
          >
            <el-card shadow="never" style="cursor:pointer" @click="downloadDocById(v)">
              <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap">
                <el-tag :type="v.id === versionsCurrent?.id ? 'primary' : 'info'" size="small">v{{ v.version }}</el-tag>
                <el-tag :type="STATUS_TAG[v.status]" size="small">{{ STATUS_LABEL[v.status] }}</el-tag>
                <span>{{ v.file_name }}</span>
                <span style="color:var(--el-color-info); margin-left:auto">{{ v.human_size }}</span>
              </div>
              <div style="color:var(--el-color-info); font-size:12px; margin-top:4px">
                点击下载 · 哈希: {{ (v.file_hash || '').slice(0, 12) }}…
              </div>
            </el-card>
          </el-timeline-item>
        </el-timeline>
      </div>
    </el-drawer>
  </div>

    <!-- 签收记录对话框 -->
    <el-dialog v-model="dlgAcks" :title="'签收记录: ' + (ackTarget ? ackTarget.title : '') + ' (' + (ackTarget ? ackTarget.version : '') + ')'" width="600px">
      <el-table :data="ackList" size="small" border>
        <el-table-column prop="full_name" label="签收人" width="120" />
        <el-table-column prop="username" label="账号" width="100" />
        <el-table-column prop="ack_at" label="签收时间" width="180" />
        <el-table-column prop="ack_method" label="方式" width="80" />
      </el-table>
      <el-empty v-if="!ackList.length" description="暂无签收记录" />
      <template #footer>
        <el-button @click="dlgAcks = false">关闭</el-button>
      </template>
    </el-dialog>

</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { Refresh, UploadFilled } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'

// 常量 (与后端 services/documentService.js 一致)
const DOC_TYPES = [
  { value: 'drawing',  label: '<el-icon><TrendCharts /></el-icon> 图纸' },
  { value: 'sop',      label: '<el-icon><Document /></el-icon> SOP 作业指导' },
  { value: 'process',  label: '<el-icon><Setting /></el-icon> 工艺文件' },
  { value: 'qc_std',   label: '<el-icon><CircleCheck /></el-icon> 质检标准' },
  { value: 'contract', label: '<el-icon><Document /></el-icon> 合同/技术协议' },
  { value: 'report',   label: '<el-icon><DataAnalysis /></el-icon> 试验报告' },
  { value: 'other',    label: '<el-icon><Paperclip /></el-icon> 其他' }
]
const DOC_TYPE_LABEL: Record<string, string> = Object.fromEntries(DOC_TYPES.map(t => [t.value, t.label]))
const STATUSES = ['draft', 'issued', 'revoked', 'archived']
const STATUS_LABEL: Record<string, string> = {
  draft: '草稿', issued: '已签发', revoked: '已收回', archived: '已归档'
}
const STATUS_TAG: Record<string, 'success' | 'info' | 'warning' | 'danger' | ''> = {
  draft: 'info', issued: 'success', revoked: 'warning', archived: 'danger'
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
const stats = reactive<{ by_status?: any[]; by_type?: any[]; total_bytes?: number; human_total?: string }>({})
const totalCount = computed(() => {
  if (!stats.by_status) return 0
  return stats.by_status.reduce((s, b) => s + b.count, 0)
})
const instances = ref<any[]>([])

const filter = reactive({
  type: '' as string, status: '' as string, issued_to: '' as string,
  equipment_instance_id: null as number | null, bom_node_id: null as number | null,
  q: '' as string
})

const resetFilter = () => {
  filter.type = ''; filter.status = ''; filter.issued_to = ''
  filter.equipment_instance_id = null; filter.bom_node_id = null; filter.q = ''
  page.value = 1
  refresh()
}

const countByStatus = (s: string) => {
  const b = stats.by_status?.find((x: any) => x.status === s)
  return b ? b.count : 0
}

const refresh = async () => {
  loading.value = true
  try {
    const params: any = { limit: pageSize.value, offset: (page.value - 1) * pageSize.value }
    if (filter.type) params.doc_type = filter.type
    if (filter.status) params.status = filter.status
    if (filter.issued_to) params.issued_to = filter.issued_to
    if (filter.equipment_instance_id) params.equipment_instance_id = filter.equipment_instance_id
    if (filter.bom_node_id) params.bom_node_id = filter.bom_node_id
    if (filter.q) params.q = filter.q
    const r: any = await api.documents(params)
    items.value = r.items || []
    total.value = r.total || 0
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

// 行点击 → 不展开, 避免误操作
const onRowClick = () => { /* noop */ }

// 下载
const downloadDoc = async (row: any) => {
  const token = localStorage.getItem('tbm_access_token') || localStorage.getItem('tbm_token') || ''
  const url = api.documentDownloadUrl(row.id) + (token ? `?t=${encodeURIComponent(token)}` : '')
  window.open(url, '_blank')
}
const downloadDocById = (v: any) => {
  const token = localStorage.getItem('tbm_access_token') || localStorage.getItem('tbm_token') || ''
  const url = api.documentDownloadUrl(v.id) + (token ? `?t=${encodeURIComponent(token)}` : '')
  window.open(url, '_blank')
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
const uploadRef = ref<any>(null)
const uploadForm = reactive({
  title: '', doc_code: '', version: 'A0', doc_type: 'drawing',
  equipment_instance_id: null as number | null, bom_node_id: null as number, eco_id: '',
  description: '', tags: ''
})
const resetUpload = () => {
  uploadForm.title = ''; uploadForm.doc_code = ''; uploadForm.version = 'A0'
  uploadForm.doc_type = 'drawing'; uploadForm.equipment_instance_id = null
  uploadForm.bom_node_id = null as any; uploadForm.eco_id = ''
  uploadForm.description = ''; uploadForm.tags = ''
  uploadRef.value?.clearFiles()
}
const onFileChange = (file: any) => {
  // 自动从文件名推断标题
  if (!uploadForm.title && file?.name) {
    uploadForm.title = file.name.replace(/\.[^.]+$/, '')
  }
}
const submitUpload = async () => {
  const fileList = uploadRef.value?.uploadFiles || []
  if (!fileList.length) return ElMessage.warning('请先选择文件')
  if (!uploadForm.title || !uploadForm.doc_code || !uploadForm.doc_type) {
    return ElMessage.warning('请填写 文档标题 / 文档编码 / 类型')
  }
  const file = fileList[0].raw as File
  if (file.size > 50 * 1024 * 1024) return ElMessage.error('文件超过 50MB')
  const meta: any = {
    title: uploadForm.title, doc_code: uploadForm.doc_code, version: uploadForm.version,
    doc_type: uploadForm.doc_type, equipment_instance_id: uploadForm.equipment_instance_id,
    bom_node_id: uploadForm.bom_node_id, eco_id: uploadForm.eco_id || undefined,
    description: uploadForm.description || undefined,
    tags: uploadForm.tags ? uploadForm.tags.split(',').map((s: string) => s.trim()).filter(Boolean) : undefined
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
const openVersions = async (row: any) => {
  versionsCurrent.value = row
  dlgVersions.value = true
  versionsLoading.value = true
  try {
    const r: any = await api.documentVersions(row.id)
    versions.value = r.items || []
  } catch (_e) { versions.value = [] }
  finally { versionsLoading.value = false }
}

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
  await Promise.all([refresh(), loadInstances(), loadPendingCount()])
})
</script>

<style scoped>
.page { padding: 16px }
.page-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px }
.page-title { font-size: 18px; font-weight: 600; margin-right: auto }
.stat-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 12px }
.stat-card { text-align: center; padding: 8px }
.stat-label { font-size: 12px; color: var(--el-color-info); margin-bottom: 4px }
.stat-value { font-size: 22px; font-weight: 600; color: var(--el-text-color-primary) }
</style>