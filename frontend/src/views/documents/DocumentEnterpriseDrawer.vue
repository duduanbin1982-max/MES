<template>
  <el-drawer v-model="visible" :title="doc ? `现场/治理 · ${doc.title || doc.file_name}` : '现场扫码 / 文档治理'" size="min(920px, 97vw)" destroy-on-close>
    <el-tabs v-model="activeTab">
      <el-tab-pane label="现场扫码" name="field">
        <el-form inline>
          <el-form-item><el-input v-model="qr" placeholder="扫描/输入二维码：EQ:1 / BOM:10 / DOC:29 / 机号" style="width: 360px" @keyup.enter="scan" /></el-form-item>
          <el-form-item><el-button type="primary" @click="scan">查询有效文件</el-button></el-form-item>
        </el-form>
        <el-descriptions v-if="scanResult" :column="3" border size="small">
          <el-descriptions-item label="对象">{{ scanResult.instance?.instance_code || scanResult.bom_node?.part_number || scanResult.workstation?.code || '-' }}</el-descriptions-item>
          <el-descriptions-item label="类型">{{ scanResult.kind }}</el-descriptions-item>
          <el-descriptions-item label="文件数">{{ scanResult.documents?.length || 0 }}</el-descriptions-item>
        </el-descriptions>
        <template v-if="scanResult">
          <el-divider content-position="left">图纸</el-divider>
          <div v-for="item in scanResult.groups?.drawing || []" :key="item.id" class="line">
            <span>{{ item.title || item.file_name }} <el-tag size="small">{{ item.version }}</el-tag></span>
            <span>
              <el-button size="small" link type="primary" @click="borrow(item)">借阅</el-button>
              <el-button size="small" link @click="returnDoc(item)">归还</el-button>
              <el-button size="small" link type="warning" @click="fieldIssue(item)">现场问题</el-button>
              <el-button size="small" link @click="queueOffline(item)">离线签收</el-button>
            </span>
          </div>
          <el-divider content-position="left">SOP / ITP / 点检</el-divider>
          <div v-for="item in [...(scanResult.groups?.sop || []), ...(scanResult.groups?.itp || []), ...(scanResult.groups?.checklist || []), ...(scanResult.groups?.other || [])]" :key="item.id" class="line">
            <span>{{ item.title || item.file_name }} <el-tag size="small">{{ item.version }}</el-tag></span>
            <span>
              <el-button size="small" link type="warning" @click="fieldIssue(item)">现场问题</el-button>
              <el-button size="small" link @click="queueOffline(item)">离线签收</el-button>
            </span>
          </div>
        </template>
        <el-divider content-position="left">离线队列（{{ offlineQueue.length }}）</el-divider>
        <el-button size="small" :disabled="!offlineQueue.length" @click="syncOffline">联网同步</el-button>
        <el-button size="small" link @click="offlineQueue = []; saveQueue()">清空</el-button>
      </el-tab-pane>

      <el-tab-pane label="供应商协同" name="supplier" :disabled="!doc">
        <el-form v-if="doc" label-width="100px" style="max-width: 620px">
          <el-form-item label="供应商 ID"><el-input v-model="supplierForm.supplier_id" style="width: 200px" /></el-form-item>
          <el-form-item label="采购单 ID"><el-input v-model="supplierForm.purchase_order_id" style="width: 200px" /></el-form-item>
          <el-form-item><el-button type="primary" @click="linkSupplier">关联供应商/采购单</el-button></el-form-item>
          <el-form-item label="审核意见"><el-input v-model="supplierForm.comment" style="width: 360px" /></el-form-item>
          <el-form-item>
            <el-button type="success" @click="reviewSupplier(true)">审核通过</el-button>
            <el-button type="danger" @click="reviewSupplier(false)">驳回</el-button>
            <el-button @click="ackSupplier">供应商签收</el-button>
          </el-form-item>
        </el-form>
        <el-alert v-else type="info" :closable="false" title="请从文档列表点击“治理”进入供应商协同" />
      </el-tab-pane>

      <el-tab-pane label="法律保留/归档" name="governance" :disabled="!doc">
        <template v-if="doc">
          <el-form inline>
            <el-form-item><el-input v-model="holdReason" placeholder="法律保留原因" style="width: 300px" /></el-form-item>
            <el-form-item><el-button type="warning" @click="addHold">设置法律保留</el-button></el-form-item>
          </el-form>
          <el-table :data="holds" size="small" max-height="180">
            <el-table-column prop="reason" label="原因" min-width="180" />
            <el-table-column prop="status" label="状态" width="90" />
            <el-table-column prop="created_at" label="时间" width="160" />
            <el-table-column label="操作" width="100"><template #default="{ row }"><el-button v-if="row.status === 'active'" size="small" link type="danger" @click="releaseHold(row)">解除</el-button></template></el-table-column>
          </el-table>
          <el-divider />
          <el-button type="primary" @click="loadPackage">生成归档包</el-button>
          <el-descriptions v-if="archivePackage" :column="1" border style="margin-top: 10px">
            <el-descriptions-item label="包哈希">{{ archivePackage.package_hash }}</el-descriptions-item>
            <el-descriptions-item label="事件数">{{ archivePackage.events?.length || 0 }}</el-descriptions-item>
            <el-descriptions-item label="审批数">{{ archivePackage.approvals?.length || 0 }}</el-descriptions-item>
            <el-descriptions-item label="批注数">{{ archivePackage.annotations?.length || 0 }}</el-descriptions-item>
          </el-descriptions>
        </template>
        <el-alert v-else type="info" :closable="false" title="请从文档列表点击“治理”选择文档" />
      </el-tab-pane>
    </el-tabs>
  </el-drawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Api } from '../../api'

const props = defineProps<{ modelValue: boolean; doc?: any | null }>()
const emit = defineEmits<{ (event: 'update:modelValue', value: boolean): void }>()
const visible = computed({ get: () => props.modelValue, set: (value: boolean) => emit('update:modelValue', value) })
const activeTab = ref('field')
const qr = ref('')
const scanResult = ref<any>(null)
const offlineQueue = ref<any[]>(JSON.parse(localStorage.getItem('tbm_doc_offline') || '[]'))
const supplierForm = ref({ supplier_id: '', purchase_order_id: '', comment: '' })
const holds = ref<any[]>([])
const holdReason = ref('')
const archivePackage = ref<any>(null)

function saveQueue() { localStorage.setItem('tbm_doc_offline', JSON.stringify(offlineQueue.value)) }
async function scan() {
  if (!qr.value.trim()) return
  try {
    scanResult.value = await Api.get(`/documents/scan/${encodeURIComponent(qr.value.trim())}`)
    ElMessage.success(`识别成功，共 ${scanResult.value.documents?.length || 0} 个有效文件`)
  } catch (error: any) { ElMessage.error('识别失败：' + (error.response?.data?.message || error.message)) }
}
async function borrow(item: any) {
  try { await Api.post(`/documents/${item.id}/borrow`, { copy_no: 'FIELD' }); ElMessage.success('借阅已登记') }
  catch (error: any) { ElMessage.error('借阅失败：' + (error.response?.data?.message || error.message)) }
}
async function returnDoc(item: any) {
  try { await Api.post(`/documents/${item.id}/return`, {}); ElMessage.success('归还已登记') }
  catch (error: any) { ElMessage.error('归还失败：' + (error.response?.data?.message || error.message)) }
}
async function fieldIssue(item: any) {
  try {
    const { value } = await ElMessageBox.prompt('现场问题描述', '现场问题反馈', { inputType: 'textarea' })
    await Api.post(`/documents/${item.id}/field-issues`, { content: value, page_no: 1, photos: [] })
    ElMessage.success('现场问题已提交')
  } catch (error: any) { if (error !== 'cancel' && error !== 'close') ElMessage.error('提交失败：' + (error.response?.data?.message || error.message)) }
}
function queueOffline(item: any) {
  offlineQueue.value.push({ client_action_id: `off-${Date.now()}-${Math.random().toString(16).slice(2)}`, doc_id: item.id, action: 'ack' })
  saveQueue()
  ElMessage.success('已加入离线队列')
}
async function syncOffline() {
  try {
    const result: any = await Api.post('/documents/offline-sync', { actions: offlineQueue.value })
    ElMessage.success(`同步完成：应用 ${result.applied || 0} 条`)
    offlineQueue.value = []
    saveQueue()
  } catch (error: any) { ElMessage.error('同步失败：' + (error.response?.data?.message || error.message)) }
}
async function loadHolds() {
  if (!props.doc?.id) return
  const data: any = await Api.get(`/documents/${props.doc.id}/legal-holds`)
  holds.value = data.items || []
}
async function linkSupplier() {
  try {
    await Api.put(`/documents/${props.doc.id}/supplier`, { supplier_id: Number(supplierForm.value.supplier_id), purchase_order_id: Number(supplierForm.value.purchase_order_id) || null })
    ElMessage.success('供应商关联已保存')
  } catch (error: any) { ElMessage.error('保存失败：' + (error.response?.data?.message || error.message)) }
}
async function reviewSupplier(approve: boolean) {
  try {
    await Api.post(`/documents/${props.doc.id}/supplier/review`, { approve, comment: supplierForm.value.comment })
    ElMessage.success(approve ? '已审核通过' : '已驳回')
  } catch (error: any) { ElMessage.error('审核失败：' + (error.response?.data?.message || error.message)) }
}
async function ackSupplier() {
  try { await Api.post(`/documents/${props.doc.id}/supplier/ack`, { note: '已收到' }); ElMessage.success('供应商签收已登记') }
  catch (error: any) { ElMessage.error('签收失败：' + (error.response?.data?.message || error.message)) }
}
async function addHold() {
  if (!holdReason.value.trim()) return
  try { await Api.post(`/documents/${props.doc.id}/legal-hold`, { reason: holdReason.value }); holdReason.value = ''; ElMessage.success('已设置法律保留'); await loadHolds() }
  catch (error: any) { ElMessage.error('设置失败：' + (error.response?.data?.message || error.message)) }
}
async function releaseHold(row: any) {
  try { await Api.delete(`/document-legal-holds/${row.id}`); ElMessage.success('已解除'); await loadHolds() }
  catch (error: any) { ElMessage.error('解除失败：' + (error.response?.data?.message || error.message)) }
}
async function loadPackage() {
  try { archivePackage.value = await Api.get(`/documents/${props.doc.id}/archive-package`); ElMessage.success('归档包已生成') }
  catch (error: any) { ElMessage.error('生成失败：' + (error.response?.data?.message || error.message)) }
}
watch(() => [props.modelValue, props.doc?.id], ([open]) => {
  if (open) {
    scanResult.value = null
    archivePackage.value = null
    activeTab.value = props.doc?.id ? 'supplier' : 'field'
    loadHolds()
  }
}, { immediate: true })
</script>

<style scoped>
.line { display: flex; align-items: center; justify-content: space-between; padding: 5px 0; border-bottom: 1px dashed var(--el-border-color-lighter); }
</style>
