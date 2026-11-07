<template>
  <el-drawer v-model="visible" :title="`受控文件管理 · ${doc?.title || doc?.file_name || ''}`" size="min(860px, 96vw)" destroy-on-close>
    <el-tabs v-model="activeTab">
      <el-tab-pane label="审批与签署" name="approval">
        <div class="toolbar">
          <el-tag :type="approvalTagType">{{ approvalStatusLabel }}</el-tag>
          <el-button size="small" type="primary" :disabled="!canSubmit" @click="submitReview">提交审批</el-button>
          <span class="hint">审批中的文档不能签发；全部通过后才能签发。</span>
        </div>
        <el-table :data="approvals" size="small">
          <el-table-column prop="step_no" label="步骤" width="60" />
          <el-table-column prop="step_type" label="类型" width="100" />
          <el-table-column prop="approver_role" label="审批角色" width="130" />
          <el-table-column prop="status" label="状态" width="100">
            <template #default="{ row }"><el-tag size="small" :type="row.status === 'approved' ? 'success' : row.status === 'rejected' ? 'danger' : 'warning'">{{ row.status }}</el-tag></template>
          </el-table-column>
          <el-table-column prop="comment" label="意见" min-width="160" />
          <el-table-column label="签署" width="170">
            <template #default="{ row }">
              <span v-if="row.signature" class="sig">{{ (row.signature || '').slice(0, 12) }}…</span>
              <el-button v-if="row.status === 'pending'" size="small" link type="success" @click="approveStep(row, true)">通过</el-button>
              <el-button v-if="row.status === 'pending'" size="small" link type="danger" @click="approveStep(row, false)">驳回</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="修订块" name="revision">
        <el-form label-width="100px" style="max-width: 640px">
          <el-form-item label="修订说明"><el-input v-model="revisionForm.revision_note" type="textarea" :rows="3" placeholder="本次修订内容（如：修改刀盘开口尺寸）" /></el-form-item>
          <el-form-item label="修订原因"><el-input v-model="revisionForm.revision_reason" type="textarea" :rows="2" placeholder="变更原因/依据（ECO/评审）" /></el-form-item>
          <el-form-item><el-button type="primary" @click="saveRevision">保存修订说明</el-button></el-form-item>
        </el-form>
        <el-table :data="revisions" size="small" max-height="260">
          <el-table-column prop="version" label="版本" width="80" />
          <el-table-column prop="status" label="状态" width="90" />
          <el-table-column prop="approval_status" label="审批" width="90" />
          <el-table-column prop="revision_note" label="修订说明" min-width="180" />
          <el-table-column prop="created_at" label="上传时间" width="160" />
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="发放与签收" name="distribution">
        <div class="toolbar">
          <el-button size="small" type="primary" @click="regenerate">重新生成发放任务</el-button>
          <span class="hint">已签收 {{ distributionAcknowledged }}/{{ distribution.length }}；新版本签发生效后旧版待签任务自动作废。</span>
        </div>
        <el-table :data="distribution" size="small" max-height="380">
          <el-table-column prop="username" label="人员" width="120" />
          <el-table-column prop="role" label="角色" width="120" />
          <el-table-column prop="status" label="状态" width="100">
            <template #default="{ row }"><el-tag size="small" :type="row.status === 'acknowledged' ? 'success' : row.status === 'superseded' ? 'info' : 'warning'">{{ row.status }}</el-tag></template>
          </el-table-column>
          <el-table-column prop="required_at" label="要求签收时间" width="170" />
          <el-table-column prop="acked_at" label="实际签收" width="170" />
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="机号/日期有效性" name="effectivity">
        <el-form label-width="110px" style="max-width: 680px">
          <el-form-item label="有效性类型">
            <el-select v-model="effectivityForm.effectivity_type" style="width: 220px">
              <el-option label="全部机号/长期" value="all" />
              <el-option label="指定机号" value="instance" />
              <el-option label="日期范围" value="date_range" />
              <el-option label="序列号范围" value="serial_range" />
            </el-select>
          </el-form-item>
          <el-form-item label="生效日期"><el-date-picker v-model="effectivityForm.effective_from" type="date" value-format="YYYY-MM-DD" style="width: 180px" /></el-form-item>
          <el-form-item label="失效日期"><el-date-picker v-model="effectivityForm.effective_to" type="date" value-format="YYYY-MM-DD" style="width: 180px" /></el-form-item>
          <el-form-item label="序列号起"><el-input v-model="effectivityForm.serial_from" style="width: 220px" /></el-form-item>
          <el-form-item label="序列号止"><el-input v-model="effectivityForm.serial_to" style="width: 220px" /></el-form-item>
          <el-form-item><el-button type="primary" @click="saveEffectivity">保存有效性</el-button></el-form-item>
        </el-form>
        <el-alert type="info" :closable="false" show-icon :title="`该文档当前所属机号：${doc?.instance_code || doc?.equipment_instance_id || '-'}；生效文件接口可按 as_of 日期查询。`" />

      </el-tab-pane>

      <el-tab-pane label="批注/对比" name="annotations">
        <el-form inline>
          <el-form-item><el-input v-model="annotationForm.content" placeholder="批注内容" style="width: 300px" /></el-form-item>
          <el-form-item><el-select v-model="annotationForm.annotation_type" style="width: 110px"><el-option label="备注" value="note" /><el-option label="问题" value="issue" /><el-option label="变更" value="change" /></el-select></el-form-item>
          <el-form-item><el-button type="primary" @click="addAnnotation">添加批注</el-button></el-form-item>
        </el-form>
        <el-table :data="annotations" size="small" max-height="240">
          <el-table-column prop="annotation_type" label="类型" width="80" />
          <el-table-column prop="content" label="内容" min-width="220" />
          <el-table-column prop="status" label="状态" width="90" />
          <el-table-column label="操作" width="110"><template #default="{ row }"><el-button size="small" link type="success" @click="resolveAnnotation(row)">解决</el-button></template></el-table-column>
        </el-table>
        <el-divider />
        <el-form inline>
          <el-form-item label="对比版本">
            <el-select v-model="compareId" placeholder="选择同族版本" style="width: 220px">
              <el-option v-for="item in familyVersions" :key="item.id" :label="`${item.version} · ${item.status}`" :value="item.id" />
            </el-select>
          </el-form-item>
          <el-form-item><el-button @click="compareVersions">对比</el-button></el-form-item>
        </el-form>
        <el-table v-if="compareResult" :data="compareResult.changes" size="small" max-height="220">
          <el-table-column prop="field" label="字段" width="150" />
          <el-table-column prop="left" label="当前" min-width="150" />
          <el-table-column prop="right" label="对比" min-width="150" />
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="密级/下载" name="security">
        <el-form label-width="110px" style="max-width: 560px">
          <el-form-item label="文档密级">
            <el-select v-model="securityForm.classification" style="width: 220px">
              <el-option label="公开" value="public" /><el-option label="内部" value="internal" />
              <el-option label="机密" value="confidential" /><el-option label="绝密" value="secret" />
            </el-select>
          </el-form-item>
          <el-form-item label="下载策略">
            <el-select v-model="securityForm.download_policy" style="width: 240px">
              <el-option label="允许下载" value="allow" /><el-option label="仅在线预览" value="preview_only" />
              <el-option label="下载带水印" value="watermark_only" /><el-option label="禁止打印" value="no_print" />
            </el-select>
          </el-form-item>
          <el-form-item><el-button type="primary" @click="saveSecurity">保存密级/策略</el-button></el-form-item>
        </el-form>
      </el-tab-pane>

      <el-tab-pane label="关联影响" name="links">
        <el-descriptions v-if="links" :column="1" border>
          <el-descriptions-item label="BOM 节点">{{ links.bom ? `${links.bom.part_number || links.bom.id}（tier ${links.bom.tier}）` : '-' }}</el-descriptions-item>
          <el-descriptions-item label="ECO">{{ links.eco ? `${links.eco.change_no || links.eco.id}` : '-' }}</el-descriptions-item>
          <el-descriptions-item label="工单">{{ links.work_order ? `${links.work_order.order_no || links.work_order.id}（${links.work_order.status}）` : '-' }}</el-descriptions-item>
          <el-descriptions-item label="关联工艺节点">{{ (links.process_nodes || []).map((n: any) => n.operation_name).join('、') || '-' }}</el-descriptions-item>
          <el-descriptions-item label="同族版本">{{ (links.family_versions || []).map((v: any) => v.version).join('、') || '-' }}</el-descriptions-item>
          <el-descriptions-item label="批注数">{{ links.annotation_count || 0 }}</el-descriptions-item>
        </el-descriptions>
      </el-tab-pane>
    </el-tabs>
  </el-drawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Api } from '../../api'

const props = defineProps<{ modelValue: boolean; doc: any | null }>()
const emit = defineEmits<{ (event: 'update:modelValue', value: boolean): void; (event: 'changed'): void }>()
const visible = computed({ get: () => props.modelValue, set: (value: boolean) => emit('update:modelValue', value) })
const activeTab = ref('approval')
const approvals = ref<any[]>([])
const approvalStatus = ref('draft')
const revisions = ref<any[]>([])
const distribution = ref<any[]>([])
const distributionAcknowledged = ref(0)
const revisionForm = ref({ revision_note: '', revision_reason: '' })
const effectivityForm = ref({ effectivity_type: 'all', effective_from: null, effective_to: null, serial_from: '', serial_to: '' })
const annotations = ref<any[]>([])
const annotationForm = ref({ content: '', annotation_type: 'note', page_no: 1 })
const familyVersions = ref<any[]>([])
const compareId = ref<number | null>(null)
const compareResult = ref<any>(null)
const securityForm = ref({ classification: 'internal', download_policy: 'allow' })
const links = ref<any>(null)

const approvalTagType = computed(() => approvalStatus.value === 'approved' ? 'success' : approvalStatus.value === 'rejected' ? 'danger' : approvalStatus.value === 'in_review' ? 'warning' : 'info')
const approvalStatusLabel = computed(() => ({ draft: '草稿', in_review: '审批中', approved: '已批准', rejected: '已驳回' }[approvalStatus.value] || approvalStatus.value))
const canSubmit = computed(() => ['draft', 'rejected'].includes(approvalStatus.value))

async function loadApproval() {
  if (!props.doc?.id) return
  const data: any = await Api.get(`/documents/${props.doc.id}/approvals`)
  approvals.value = data.steps || []
  approvalStatus.value = data.approval_status || 'draft'
}

async function loadRevisions() {
  if (!props.doc?.id) return
  const data: any = await Api.get(`/documents/${props.doc.id}/revisions`)
  revisions.value = data.revisions || []
  revisionForm.value = { revision_note: props.doc?.revision_note || '', revision_reason: props.doc?.revision_reason || '' }
}

async function loadDistribution() {
  if (!props.doc?.id) return
  const data: any = await Api.get(`/documents/${props.doc.id}/distribution`)
  distribution.value = data.targets || []
  distributionAcknowledged.value = data.acknowledged || 0
}

async function loadEffectivity() {
  if (!props.doc?.id) return
  const data: any = await Api.get(`/documents/${props.doc.id}/effectivity`)
  effectivityForm.value = { effectivity_type: data.effectivity_type || 'all', effective_from: data.effective_from, effective_to: data.effective_to, serial_from: data.serial_from || '', serial_to: data.serial_to || '' }
}

async function loadAnnotations() {
  if (!props.doc?.id) return
  const data: any = await Api.get(`/documents/${props.doc.id}/annotations`)
  annotations.value = data.items || []
  const versions: any = await Api.get(`/documents/${props.doc.id}/versions`)
  familyVersions.value = (versions.items || []).filter((item: any) => Number(item.id) !== Number(props.doc.id))
  if (!compareId.value && familyVersions.value.length) compareId.value = familyVersions.value[0].id
  const security: any = await Api.get(`/documents/${props.doc.id}/classification`)
  securityForm.value = { classification: security.classification || 'internal', download_policy: security.download_policy || 'allow' }
  links.value = await Api.get(`/documents/${props.doc.id}/links`)
}

async function addAnnotation() {
  if (!annotationForm.value.content.trim()) return
  try {
    await Api.post(`/documents/${props.doc.id}/annotations`, annotationForm.value)
    ElMessage.success('批注已添加')
    annotationForm.value = { content: '', annotation_type: 'note', page_no: 1 }
    await loadAnnotations()
  } catch (error: any) { ElMessage.error('添加批注失败：' + (error.response?.data?.message || error.message)) }
}

async function resolveAnnotation(row: any) {
  try {
    await Api.patch(`/document-annotations/${row.id}`, { status: 'resolved', content: row.content })
    ElMessage.success('批注已解决')
    await loadAnnotations()
  } catch (error: any) { ElMessage.error('更新批注失败：' + (error.response?.data?.message || error.message)) }
}

async function compareVersions() {
  if (!compareId.value) return
  try { compareResult.value = await Api.get(`/documents/${props.doc.id}/compare`, { params: { with_document_id: compareId.value } }) }
  catch (error: any) { ElMessage.error('对比失败：' + (error.response?.data?.message || error.message)) }
}

async function saveSecurity() {
  try {
    await Api.put(`/documents/${props.doc.id}/classification`, securityForm.value)
    ElMessage.success('密级/下载策略已保存')
  } catch (error: any) { ElMessage.error('保存失败：' + (error.response?.data?.message || error.message)) }
}

async function loadAll() {
  if (!props.doc?.id) return
  try { await Promise.all([loadApproval(), loadRevisions(), loadDistribution(), loadEffectivity(), loadAnnotations()]) }
  catch (error: any) { ElMessage.error('加载受控信息失败：' + (error.response?.data?.message || error.message)) }
}

async function submitReview() {
  try {
    await Api.post(`/documents/${props.doc.id}/submit`)
    ElMessage.success('已提交审批')
    await loadApproval()
    emit('changed')
  } catch (error: any) { ElMessage.error('提交审批失败：' + (error.response?.data?.message || error.message)) }
}

async function approveStep(step: any, approve: boolean) {
  try {
    const { value } = await ElMessageBox.prompt('审批意见（可选）', approve ? '审批通过' : '审批驳回', { inputValue: approve ? '同意' : '', confirmButtonText: '确认', cancelButtonText: '取消' })
    await Api.post(`/documents/${props.doc.id}/approve`, { step_id: step.id, action: approve ? 'approve' : 'reject', comment: value || '' })
    ElMessage.success(approve ? '审批已通过' : '已驳回')
    await loadApproval()
    emit('changed')
  } catch (error: any) { if (error !== 'cancel' && error !== 'close') ElMessage.error('审批失败：' + (error.response?.data?.message || error.message)) }
}

async function saveRevision() {
  try {
    await Api.patch(`/documents/${props.doc.id}/revision`, revisionForm.value)
    ElMessage.success('修订说明已保存')
    emit('changed')
    await loadRevisions()
  } catch (error: any) { ElMessage.error('保存失败：' + (error.response?.data?.message || error.message)) }
}

async function regenerate() {
  try {
    await Api.post(`/documents/${props.doc.id}/distribution/regenerate`)
    ElMessage.success('已重新生成发放任务')
    await loadDistribution()
  } catch (error: any) { ElMessage.error('生成失败：' + (error.response?.data?.message || error.message)) }
}

async function saveEffectivity() {
  try {
    await Api.put(`/documents/${props.doc.id}/effectivity`, effectivityForm.value)
    ElMessage.success('有效性已保存')
    emit('changed')
  } catch (error: any) { ElMessage.error('保存失败：' + (error.response?.data?.message || error.message)) }
}

watch(() => [props.modelValue, props.doc?.id], ([open]) => { if (open) loadAll() }, { immediate: true })
</script>

<style scoped>
.toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
.hint { color: var(--el-color-info); font-size: 12px; }
.sig { color: var(--el-color-success); font-family: monospace; font-size: 12px; }
</style>
