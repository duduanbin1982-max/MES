<template>
  <div class="delivery-tab">
    <el-row :gutter="16">
      <!-- 交付单 -->
      <el-col :span="24" style="margin-bottom: 16px">
        <el-card shadow="never">
          <template #header>
            <div class="card-head">
              <span>交付单（发运记录）</span>
              <el-button size="small" type="primary" @click="openDelivery()">+ 新增交付单</el-button>
            </div>
          </template>
          <el-table :data="deliveries" size="small" border v-loading="loading" empty-text="还没有交付记录">
            <el-table-column label="单号" min-width="150">
              <template #default="{ row }"><span class="mono">{{ row.delivery_no }}</span></template>
            </el-table-column>
            <el-table-column label="类型" width="80">
              <template #default="{ row }">{{ deliveryTypeLabel(row.delivery_type) }}</template>
            </el-table-column>
            <el-table-column label="计划/实际" width="170">
              <template #default="{ row }">
                <div>{{ row.planned_date || '-' }}</div>
                <div class="muted">{{ row.actual_date || '未发生' }}</div>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="90" align="center">
              <template #default="{ row }">
                <el-tag :type="deliveryStatusTone(row.status)" size="small">{{ deliveryStatusLabel(row.status) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="承运 / 跟踪" min-width="140">
              <template #default="{ row }">
                <div>{{ row.carrier || '-' }}</div>
                <div class="muted">{{ row.tracking_no || '-' }}</div>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="190" align="center" fixed="right">
              <template #default="{ row }">
                <el-dropdown v-if="nextDeliveryStatuses(row.status).length" trigger="click" @command="(status: string) => changeStatus(row, status)">
                  <el-button size="small" type="primary" link>推进状态<el-icon><ArrowDown /></el-icon></el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item v-for="status in nextDeliveryStatuses(row.status)" :key="status" :command="status">
                        {{ deliveryStatusLabel(status) }}
                      </el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
                <el-button size="small" link @click="openDelivery(row)">编辑</el-button>
                <el-button size="small" link type="danger" @click="removeDelivery(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>

      <!-- 验收单 -->
      <el-col :span="24">
        <el-card shadow="never">
          <template #header>
            <div class="card-head">
              <span>验收单（FAT / SAT / 终验）</span>
              <el-button size="small" type="primary" @click="openAcceptance()">+ 新增验收单</el-button>
            </div>
          </template>
          <el-table :data="acceptances" size="small" border v-loading="loading" empty-text="还没有验收记录">
            <el-table-column label="单号" min-width="150">
              <template #default="{ row }"><span class="mono">{{ row.acceptance_no }}</span></template>
            </el-table-column>
            <el-table-column label="类型" width="120">
              <template #default="{ row }">{{ acceptanceTypeLabel(row.acceptance_type) }}</template>
            </el-table-column>
            <el-table-column label="结论" width="90" align="center">
              <template #default="{ row }">
                <el-tag :type="acceptanceResultTone(row.result)" size="small">{{ acceptanceResultLabel(row.result) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="签署" min-width="180">
              <template #default="{ row }">
                <div>{{ signSummary(row) }}</div>
                <div v-if="row.condition_note" class="muted">说明：{{ row.condition_note }}</div>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="180" align="center" fixed="right">
              <template #default="{ row }">
                <el-button size="small" type="primary" link @click="openSign(row)">
                  {{ row.result === 'pending' ? '签署' : '重签' }}
                </el-button>
                <el-button size="small" link @click="openAcceptance(row)">编辑</el-button>
                <el-button size="small" link type="danger" @click="removeAcceptance(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>

    <!-- 交付单弹窗 -->
    <el-dialog v-model="deliveryVisible" :title="deliveryForm.id ? '编辑交付单' : '新增交付单'" width="640px" :close-on-click-modal="false">
      <el-form :model="deliveryForm" label-width="110px" size="small">
        <el-row :gutter="12">
          <el-col :span="12"><el-form-item label="交付类型"><el-select v-model="deliveryForm.delivery_type" style="width:100%"><el-option v-for="(label, value) in DELIVERY_TYPE_META" :key="value" :label="label" :value="value" /></el-select></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="计划日期"><el-date-picker v-model="deliveryForm.planned_date" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="运输方式"><el-select v-model="deliveryForm.transport_mode" clearable style="width:100%"><el-option v-for="(label, value) in TRANSPORT_MODE_META" :key="value" :label="label" :value="value" /></el-select></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="承运单位"><el-input v-model="deliveryForm.carrier" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="运单/跟踪号"><el-input v-model="deliveryForm.tracking_no" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="包装件数"><el-input-number v-model="deliveryForm.package_count" :min="0" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="毛重(kg)"><el-input-number v-model="deliveryForm.gross_weight" :min="0" :precision="2" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="联系人"><el-input v-model="deliveryForm.contact_name" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="联系电话"><el-input v-model="deliveryForm.contact_phone" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="收货地点"><el-input v-model="deliveryForm.ship_to" /></el-form-item></el-col>
          <el-col :span="24"><el-form-item label="备注"><el-input v-model="deliveryForm.notes" type="textarea" :rows="2" /></el-form-item></el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="deliveryVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveDelivery">保存</el-button>
      </template>
    </el-dialog>

    <!-- 验收单弹窗 -->
    <el-dialog v-model="acceptanceVisible" :title="acceptanceForm.id ? '编辑验收单' : '新增验收单'" width="560px" :close-on-click-modal="false">
      <el-form :model="acceptanceForm" label-width="110px" size="small">
        <el-form-item label="验收类型">
          <el-select v-model="acceptanceForm.acceptance_type" style="width:100%">
            <el-option v-for="(label, value) in ACCEPTANCE_TYPE_META" :key="value" :label="label" :value="value" />
          </el-select>
        </el-form-item>
        <el-form-item label="计划日期"><el-date-picker v-model="acceptanceForm.planned_date" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item>
        <el-form-item label="客户名称"><el-input v-model="acceptanceForm.customer_name" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="acceptanceForm.notes" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="acceptanceVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveAcceptance">保存</el-button>
      </template>
    </el-dialog>

    <!-- 签署弹窗 -->
    <el-dialog v-model="signVisible" title="验收签署" width="520px" :close-on-click-modal="false">
      <el-form :model="signForm" label-width="110px" size="small">
        <el-form-item label="验收结论" required>
          <el-select v-model="signForm.result" style="width:100%">
            <el-option label="通过" value="passed" />
            <el-option label="让步接收" value="conditional" />
            <el-option label="不通过" value="rejected" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="signForm.result === 'conditional'" label="让步说明" required>
          <el-input v-model="signForm.condition_note" type="textarea" :rows="2" placeholder="让步接收原因 / 后续处理措施" />
        </el-form-item>
        <el-form-item label="签署人" required><el-input v-model="signForm.signer_name" placeholder="客户签署人姓名" /></el-form-item>
        <el-form-item label="职务"><el-input v-model="signForm.signer_title" /></el-form-item>
        <el-form-item label="签署日期"><el-date-picker v-model="signForm.actual_date" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="signVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitSign">确认签署</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown } from '@element-plus/icons-vue'
import { Api } from '../../api'
import {
  ACCEPTANCE_TYPE_META,
  DELIVERY_TYPE_META,
  TRANSPORT_MODE_META,
  acceptanceResultLabel,
  acceptanceResultTone,
  acceptanceTypeLabel,
  deliveryStatusLabel,
  deliveryStatusTone,
  deliveryTypeLabel,
  nextDeliveryStatuses,
  signSummary,
} from '../../domain/deliveryRecords'

const props = defineProps<{ instanceId: number }>()

const deliveries = ref<any[]>([])
const acceptances = ref<any[]>([])
const loading = ref(false)
const saving = ref(false)

const emptyDelivery = () => ({
  id: null as number | null, delivery_type: 'machine', planned_date: '', transport_mode: 'road',
  carrier: '', tracking_no: '', ship_to: '', contact_name: '', contact_phone: '',
  package_count: 1 as number | null, gross_weight: null as number | null, notes: '',
})
const deliveryForm = reactive<any>(emptyDelivery())
const deliveryVisible = ref(false)

const emptyAcceptance = () => ({ id: null as number | null, acceptance_type: 'fat', planned_date: '', customer_name: '', notes: '' })
const acceptanceForm = reactive<any>(emptyAcceptance())
const acceptanceVisible = ref(false)

const signForm = reactive<any>({ id: null as number | null, result: 'passed', signer_name: '', signer_title: '', actual_date: '', condition_note: '' })
const signVisible = ref(false)

const load = async () => {
  if (!props.instanceId) return
  loading.value = true
  try {
    const [d, a] = await Promise.all([
      Api.get(`/equipment_instances/${props.instanceId}/deliveries`),
      Api.get(`/equipment_instances/${props.instanceId}/acceptances`),
    ])
    deliveries.value = (d as any)?.items || []
    acceptances.value = (a as any)?.items || []
  } catch (error: any) {
    ElMessage.error('加载交付/验收数据失败: ' + (error?.message || error))
  } finally {
    loading.value = false
  }
}

const openDelivery = (row?: any) => {
  Object.assign(deliveryForm, emptyDelivery())
  if (row) Object.assign(deliveryForm, { ...row })
  deliveryVisible.value = true
}

const saveDelivery = async () => {
  saving.value = true
  try {
    const payload = {
      delivery_type: deliveryForm.delivery_type,
      planned_date: deliveryForm.planned_date || null,
      transport_mode: deliveryForm.transport_mode || null,
      carrier: deliveryForm.carrier || null,
      tracking_no: deliveryForm.tracking_no || null,
      ship_to: deliveryForm.ship_to || null,
      contact_name: deliveryForm.contact_name || null,
      contact_phone: deliveryForm.contact_phone || null,
      package_count: deliveryForm.package_count ?? null,
      gross_weight: deliveryForm.gross_weight ?? null,
      notes: deliveryForm.notes || null,
    }
    if (deliveryForm.id) await Api.put(`/deliveries/${deliveryForm.id}`, payload)
    else await Api.post(`/equipment_instances/${props.instanceId}/deliveries`, payload)
    ElMessage.success('交付单已保存')
    deliveryVisible.value = false
    await load()
  } catch (error: any) {
    ElMessage.error('保存失败: ' + (error?.response?.data?.message || error?.message || error))
  } finally {
    saving.value = false
  }
}

const changeStatus = async (row: any, status: string) => {
  try {
    await Api.post(`/deliveries/${row.id}/status`, { status })
    ElMessage.success(`已推进到「${deliveryStatusLabel(status)}」`)
    await load()
  } catch (error: any) {
    ElMessage.error('状态推进失败: ' + (error?.response?.data?.message || error?.message || error))
  }
}

const removeDelivery = async (row: any) => {
  try { await ElMessageBox.confirm(`确认删除交付单 ${row.delivery_no}？`, '删除确认', { type: 'warning' }) } catch { return }
  try {
    await Api.delete(`/deliveries/${row.id}`)
    ElMessage.success('已删除')
    await load()
  } catch (error: any) {
    ElMessage.error('删除失败: ' + (error?.response?.data?.message || error?.message || error))
  }
}

const openAcceptance = (row?: any) => {
  Object.assign(acceptanceForm, emptyAcceptance())
  if (row) Object.assign(acceptanceForm, { ...row })
  acceptanceVisible.value = true
}

const saveAcceptance = async () => {
  saving.value = true
  try {
    const payload = {
      acceptance_type: acceptanceForm.acceptance_type,
      planned_date: acceptanceForm.planned_date || null,
      customer_name: acceptanceForm.customer_name || null,
      notes: acceptanceForm.notes || null,
    }
    if (acceptanceForm.id) await Api.put(`/acceptances/${acceptanceForm.id}`, payload)
    else await Api.post(`/equipment_instances/${props.instanceId}/acceptances`, payload)
    ElMessage.success('验收单已保存')
    acceptanceVisible.value = false
    await load()
  } catch (error: any) {
    ElMessage.error('保存失败: ' + (error?.response?.data?.message || error?.message || error))
  } finally {
    saving.value = false
  }
}

const openSign = (row: any) => {
  Object.assign(signForm, {
    id: row.id, result: row.result && row.result !== 'pending' ? row.result : 'passed',
    signer_name: row.signer_name || '', signer_title: row.signer_title || '',
    actual_date: row.actual_date || '', condition_note: row.condition_note || '',
  })
  signVisible.value = true
}

const submitSign = async () => {
  saving.value = true
  try {
    await Api.post(`/acceptances/${signForm.id}/sign`, {
      result: signForm.result,
      signer_name: signForm.signer_name,
      signer_title: signForm.signer_title || null,
      actual_date: signForm.actual_date || null,
      condition_note: signForm.condition_note || null,
    })
    ElMessage.success('验收结论已签署')
    signVisible.value = false
    await load()
  } catch (error: any) {
    ElMessage.error('签署失败: ' + (error?.response?.data?.message || error?.message || error))
  } finally {
    saving.value = false
  }
}

const removeAcceptance = async (row: any) => {
  try { await ElMessageBox.confirm(`确认删除验收单 ${row.acceptance_no}？`, '删除确认', { type: 'warning' }) } catch { return }
  try {
    await Api.delete(`/acceptances/${row.id}`)
    ElMessage.success('已删除')
    await load()
  } catch (error: any) {
    ElMessage.error('删除失败: ' + (error?.response?.data?.message || error?.message || error))
  }
}

onMounted(load)
watch(() => props.instanceId, load)
</script>

<style scoped>
.card-head { display: flex; justify-content: space-between; align-items: center; }
.mono { font-family: Consolas, monospace; font-size: 12px; }
.muted { color: var(--el-color-info); font-size: 12px; }
</style>
