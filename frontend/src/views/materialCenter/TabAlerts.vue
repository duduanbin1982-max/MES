<template>
  <el-card shadow="never">
    <div class="alerts-toolbar">
      <div>
        <el-tag type="danger" size="small">P1 关键/A类</el-tag>
        <el-tag type="warning" size="small" style="margin-left:6px">P2 关键或A类</el-tag>
        <el-tag type="info" size="small" style="margin-left:6px">P3 其他</el-tag>
      </div>
      <div class="alerts-actions">
        <el-button size="small" :disabled="!selected.length" type="primary" @click="generatePR(selected)">生成采购申请（选中 {{ selected.length }}）</el-button>
        <el-button size="small" type="success" :disabled="!items.length" @click="generatePR(items)">全部生成采购申请</el-button>
        <el-button size="small" @click="load">刷新</el-button>
      </div>
    </div>
    <el-table :data="items" stripe v-loading="loading" size="small" max-height="560" @selection-change="onSelectionChange">
      <el-table-column type="selection" width="44" />
      <el-table-column label="优先级" width="90">
        <template #default="{ row }"><el-tag :type="priorityTag(row.priority)" size="small">{{ row.priority }}</el-tag></template>
      </el-table-column>
      <el-table-column prop="material_code" label="物料编码" width="150" />
      <el-table-column prop="material_name" label="物料名称" min-width="180" />
      <el-table-column label="关键性" width="80"><template #default="{ row }">{{ criticalityLabel(row.criticality) }}</template></el-table-column>
      <el-table-column prop="abc_class" label="ABC" width="60" />
      <el-table-column prop="available_qty" label="当前可用" width="90" align="right" />
      <el-table-column prop="threshold" label="补货线" width="90" align="right" />
      <el-table-column label="建议补货" width="90" align="right"><template #default="{ row }">{{ row.suggested_qty || row.shortage_qty }}</template></el-table-column>
      <el-table-column prop="suggested_date" label="建议到货" width="110" />
      <el-table-column label="预警级别" width="90">
        <template #default="{ row }"><el-tag :type="row.severity === 'critical' ? 'danger' : row.severity === 'high' ? 'warning' : 'info'" size="small">{{ severityLabel(row.severity) }}</el-tag></template>
      </el-table-column>
    </el-table>
    <div v-if="!loading && !items.length" class="alerts-empty">暂无低于补货线的常备物料</div>

    <el-divider content-position="left">最近采购申请</el-divider>
    <el-table :data="requisitions" size="small" border>
      <el-table-column prop="pr_no" label="采购申请号" width="180" />
      <el-table-column label="状态" width="90"><template #default="{ row }"><el-tag size="small" :type="prStatusTag(row.status)">{{ prStatusLabel(row.status) }}</el-tag></template></el-table-column>
      <el-table-column label="明细" min-width="320">
        <template #default="{ row }">
          <span v-for="item in row.items" :key="item.id" class="pr-line">{{ item.material_code }} × {{ item.quantity }}{{ item.unit }}（{{ item.priority }}）</span>
        </template>
      </el-table-column>
      <el-table-column label="采购订单" width="150"><template #default="{ row }">{{ (row.purchase_orders || []).map((p: any) => p.po_no).join('、') || '-' }}</template></el-table-column>
      <el-table-column prop="created_at" label="创建时间" width="170" />
      <el-table-column label="操作" width="220" fixed="right">
        <template #default="{ row }">
          <el-button v-if="row.status === 'draft'" size="small" type="primary" link @click="submitPR(row)">提交</el-button>
          <template v-if="row.status === 'submitted'">
            <el-button size="small" type="success" link @click="approvePR(row)">通过</el-button>
            <el-button size="small" type="danger" link @click="rejectPR(row)">驳回</el-button>
          </template>
          <el-button v-if="row.status === 'approved'" size="small" type="warning" link @click="convertPR(row)">转采购订单</el-button>
        </template>
      </el-table-column>
    </el-table>
    <div v-if="!requisitions.length" class="alerts-empty">还没有生成采购申请</div>
  </el-card>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../../api'

const items = ref<any[]>([])
const requisitions = ref<any[]>([])
const selected = ref<any[]>([])
const loading = ref(false)
const priorityTag = (value: string) => value === 'P1' ? 'danger' : value === 'P2' ? 'warning' : 'info'
const criticalityLabel = (value: string) => ({ normal: '普通', important: '重要', critical: '关键' } as any)[value] || value || '-'
const severityLabel = (value: string) => ({ critical: '紧急', high: '高', warning: '警告' } as any)[value] || value || '-'
const prStatusLabel = (value: string) => ({ draft: '草稿', submitted: '已提交', approved: '已审批', rejected: '已驳回', converted: '已转采购' } as any)[value] || value
const prStatusTag = (value: string) => ({ draft: 'info', submitted: 'warning', approved: 'success', rejected: 'danger', converted: 'success' } as any)[value] || 'info'
const onSelectionChange = (rows: any[]) => { selected.value = rows }
const load = async () => {
  loading.value = true
  try {
    const result: any = await api.get('/inventory/alerts')
    items.value = result.items || []
    const prs: any = await api.get('/inventory/purchase-requisitions', { params: { limit: 10 } })
    requisitions.value = Array.isArray(prs) ? prs : (prs.items || [])
  } catch { items.value = []; requisitions.value = [] } finally { loading.value = false }
}
const prAction = async (row: any, action: string, body?: any, success?: string) => {
  try {
    await api.post(`/inventory/purchase-requisitions/${row.id}/${action}`, body || {})
    ElMessage.success(success || '操作成功')
    await load()
  } catch (error: any) { ElMessage.error(error?.response?.data?.message || '操作失败') }
}
const submitPR = (row: any) => prAction(row, 'submit', undefined, '已提交审批')
const approvePR = async (row: any) => {
  try { await ElMessageBox.confirm(`确认审批通过 ${row.pr_no}？`, '审批采购申请'); await prAction(row, 'approve', undefined, '已审批通过') } catch (e: any) { if (e !== 'cancel' && e !== 'close') ElMessage.error('审批失败') }
}
const rejectPR = async (row: any) => {
  try {
    const result: any = await ElMessageBox.prompt('请输入驳回原因', '驳回采购申请', { inputPlaceholder: '驳回原因', inputValidator: (v) => !!v || '请填写原因' })
    await prAction(row, 'reject', { reason: result.value }, '已驳回')
  } catch (e: any) { if (e !== 'cancel' && e !== 'close') ElMessage.error('驳回失败') }
}
const convertPR = async (row: any) => {
  try {
    await ElMessageBox.confirm(`确认将 ${row.pr_no} 按供应商转为采购订单？`, '转采购订单')
    const result: any = await api.post(`/inventory/purchase-requisitions/${row.id}/convert`, {})
    ElMessage.success('已生成采购订单：' + (result.purchase_orders || []).map((p: any) => p.po_no).join('、'))
    await load()
  } catch (e: any) { if (e !== 'cancel' && e !== 'close') ElMessage.error(e?.response?.data?.message || '转采购订单失败') }
}
const generatePR = async (rows: any[]) => {
  if (!rows.length) return ElMessage.warning('请选择需要补货的物料')
  const payload = {
    items: rows.map((row) => ({
      material_id: row.id,
      quantity: row.suggested_qty || row.shortage_qty,
      unit: row.unit,
      priority: row.priority,
      suggested_date: row.suggested_date,
    })),
    notes: '低库存自动补货建议生成',
  }
  try {
    const result: any = await api.post('/inventory/purchase-requisitions', payload)
    ElMessage.success(`已生成采购申请 ${result.pr_no}，共 ${result.item_count} 项`)
    selected.value = []
    await load()
  } catch (error: any) { ElMessage.error(error?.response?.data?.message || '生成采购申请失败') }
}
onMounted(load)
</script>

<style scoped>
.alerts-toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.alerts-actions { display: flex; gap: 8px; align-items: center; }
.alerts-empty { padding: 24px; text-align: center; color: var(--el-text-color-secondary); }
.pr-line { display: inline-block; margin-right: 14px; }
</style>
