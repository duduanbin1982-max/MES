<template>
  <div class="page">
    <PageToolbar class="page-header">
      <div>
        <el-button @click="$router.back()" size="small" style="margin-right: 12px">
          <el-icon><ArrowLeft /></el-icon>返回
        </el-button>
        <span class="page-title" v-if="inst">{{ inst.instance_code }} · {{ inst.instance_name }}</span>
      </div>
      <div v-if="inst" class="header-actions">
        <el-tag :type="statusTagType(inst.lifecycle_stage || inst.status)" size="default">{{ statusLabel(inst.lifecycle_stage || inst.status) }}</el-tag>
        <el-tag v-if="overview?.freeze?.archive_status === 'archived'" type="danger">已归档</el-tag>
        <el-tag v-else-if="overview?.freeze?.frozen_at" type="warning">已冻结</el-tag>
        <el-button size="small" type="primary" :disabled="isFrozen" @click="openEdit">编辑项目信息</el-button>
        <el-button size="small" :disabled="!canEdit" :title="canEdit ? '' : '需要 equipment:write 权限'" @click="recalcProgress">重算进度</el-button>
        <el-button size="small" @click="load">刷新</el-button>
      </div>
    </PageToolbar>

    <div v-loading="loading">
      <el-alert
        v-if="overview?.freeze?.frozen_at"
        :title="`该项目装备已冻结基线：${overview.freeze.frozen_at}。BOM、图纸、工艺、成本基线禁止继续修改。`"
        type="warning"
        show-icon
        style="margin-bottom: 12px"
      />

      <el-card style="margin-bottom: 14px">
        <div class="lifecycle-bar">
          <el-steps :active="activeLifecycleIndex" finish-status="success" align-center>
            <el-step v-for="s in lifecycleOptions" :key="s.value" :title="s.label" />
          </el-steps>
          <div class="lifecycle-actions">
            <el-select v-model="nextStage" placeholder="流转到..." size="small" style="width: 150px">
              <el-option v-for="s in lifecycleOptions" :key="s.value" :label="s.label" :value="s.value" />
            </el-select>
            <el-input aria-label="流转原因" v-model="transitionReason" size="small" placeholder="流转原因" style="width: 220px" />
            <el-button size="small" type="primary" :disabled="isFrozen" @click="changeLifecycle">确认流转</el-button>
            <el-button size="small" type="warning" :disabled="!canEdit || isFrozen" :title="canEdit ? '' : '需要 equipment:write 权限'" @click="freezeInstance">冻结基线</el-button>
            <el-button size="small" type="danger" :disabled="!canEdit || overview?.freeze?.archive_status === 'archived'" :title="canEdit ? '' : '需要 equipment:write 权限'" @click="archiveInstance">归档</el-button>
          </div>
        </div>
      </el-card>

      <el-tabs v-model="tab">
        <el-tab-pane label="项目装备总览" name="overview">
          <el-row :gutter="16">
            <el-col :span="14">
              <el-card>
                <template #header>合同与编码</template>
                <el-descriptions :column="2" border>
                  <el-descriptions-item label="项目装备编码">{{ inst?.instance_code }}</el-descriptions-item>
                  <el-descriptions-item label="项目号">{{ inst?.project_no || '-' }}</el-descriptions-item>
                  <el-descriptions-item label="合同号">{{ inst?.contract_no || '-' }}</el-descriptions-item>
                  <el-descriptions-item label="出厂序列号">{{ inst?.serial_no || '-' }}</el-descriptions-item>
                  <el-descriptions-item label="客户">{{ inst?.customer_name }}</el-descriptions-item>
                  <el-descriptions-item label="客户联系人">{{ inst?.customer_contact || '-' }}</el-descriptions-item>
                  <el-descriptions-item label="型号">{{ inst?.model_name || '-' }} {{ inst?.model_code ? `(${inst.model_code})` : '' }}</el-descriptions-item>
                  <el-descriptions-item label="合同金额">{{ inst?.contract_amount ? inst.contract_amount + ' 万' : '-' }}</el-descriptions-item>
                  <el-descriptions-item label="现场位置" :span="2">{{ inst?.site_location || '-' }}</el-descriptions-item>
                  <el-descriptions-item label="进度（自动）">{{ inst?.progress_pct ?? 0 }}%
                    <el-tag size="small" type="info" style="margin-left: 6px">按工序工时加权</el-tag>
                  </el-descriptions-item>
                  <el-descriptions-item label="计划工期" :span="2">{{ (inst?.planned_start || '-') + ' → ' + (inst?.planned_end || '-') }}</el-descriptions-item>
                </el-descriptions>
              </el-card>
            </el-col>
            <el-col :span="10">
              <el-card>
                <template #header>交付风险</template>
                <PageState state="empty" compact :show-action="false" v-if="!riskItems.length" description="暂无风险，漂亮。" />
                <el-timeline v-else>
                  <el-timeline-item v-for="r in riskItems" :key="r.type + r.title" :type="r.level === 'high' ? 'danger' : 'warning'">
                    <span>{{ r.title }}</span>
                  </el-timeline-item>
                </el-timeline>
              </el-card>
            </el-col>
          </el-row>

          <el-row :gutter="14" style="margin-top: 14px">
            <el-col v-for="card in overviewCards" :key="card.title" :span="6">
              <el-card shadow="hover" class="overview-card">
                <div class="card-title">{{ card.title }}</div>
                <div class="card-value" :style="{ color: card.color }">{{ card.value }}</div>
                <div class="card-sub">{{ card.sub }}</div>
              </el-card>
            </el-col>
          </el-row>

          <el-row :gutter="16" style="margin-top: 14px">
            <el-col :span="12">
              <el-card>
                <template #header>里程碑</template>
                <el-timeline>
                  <el-timeline-item
                    v-for="m in overview?.milestones || []"
                    :key="m.id"
                    :timestamp="m.planned_start"
                    placement="top"
                    :type="m.status === 'completed' ? 'success' : (m.status === 'active' ? 'primary' : 'info')"
                  >
                    {{ m.phase_code }} · {{ m.phase_name }}
                    <el-tag size="small" style="margin-left: 8px">{{ m.status }}</el-tag>
                  </el-timeline-item>
                </el-timeline>
              </el-card>
            </el-col>
            <el-col :span="12">
              <el-card>
                <template #header>生命周期日志</template>
                <el-table :data="overview?.lifecycle_logs || []" size="small" height="280">
                  <el-table-column prop="changed_at" label="时间" width="145" />
                  <el-table-column label="流转" width="150">
                    <template #default="{ row }">{{ statusLabel(row.from_stage) || '-' }} → {{ statusLabel(row.to_stage) }}</template>
                  </el-table-column>
                  <el-table-column prop="reason" label="原因" min-width="160" />
                </el-table>
              </el-card>
            </el-col>
          </el-row>
        </el-tab-pane>

        <el-tab-pane :label="`BOM 树 (${overview?.cards?.bom?.total || dash?.bom_count || 0})`" name="bom">
          <el-card>
            <el-input v-model="bomFilter" placeholder="搜索零件..." size="small" style="margin-bottom: 12px; width: 300px" clearable />
            <el-tree
              :data="filteredBom"
              :props="{ label: 'label', children: 'children' }"
              node-key="id"
              default-expand-all
              :filter-node-method="filterNode"
              ref="treeRef"
            >
              <template #default="{ data }">
                <span style="display: flex; align-items: center; gap: 8px; width: 100%">
                  <span v-if="data.material_id" style="flex: 1">{{ data.material_name || '(未命名物料)' }}</span>
                  <span v-else style="flex: 1; font-weight: 500">{{ data.notes || data.part_number || data.code || '(未命名)' }}</span>
                  <el-tag v-if="data.is_key_component" type="danger" size="small">关键</el-tag>
                  <span style="color: var(--el-color-info); font-size: 12px">qty={{ data.quantity }}</span>
                </span>
              </template>
            </el-tree>
          </el-card>
        </el-tab-pane>

        <el-tab-pane :label="`工单 (${overview?.cards?.work_orders?.total || 0})`" name="work-orders">
          <el-card>
            <el-table :data="workOrders" stripe size="small">
              <el-table-column prop="wo_code" label="工单号" width="160" />
              <el-table-column prop="subsystem_name" label="子系统" width="100" />
              <el-table-column prop="title" label="标题" min-width="200" />
              <el-table-column label="状态" width="100">
                <template #default="{ row }">
                  <el-tag :type="woStatusTagType(row.status)" size="small">{{ row.status }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="priority" label="优先级" width="80" />
              <el-table-column label="计划开始" width="110">
                <template #default="{ row }">{{ row.planned_start || '-' }}</template>
              </el-table-column>
              <el-table-column label="实际开始" width="170">
                <template #default="{ row }">{{ row.actual_start || '-' }}</template>
              </el-table-column>
            </el-table>
          </el-card>
        </el-tab-pane>

        <el-tab-pane label="交付验收" name="delivery">
          <InstanceDeliveryTab :instance-id="id" />
        </el-tab-pane>
      </el-tabs>
    </div>

    <!-- 2026-10-21：原来进度/合同/客户等字段只能看不能改（PUT 接口有、前端没入口） -->
    <el-dialog v-model="editVisible" title="编辑项目信息" width="640px" :close-on-click-modal="false">
      <el-form :model="editForm" label-width="110px" size="default">
        <el-form-item label="项目名称">
          <el-input v-model="editForm.instance_name" placeholder="例如：郑州地铁 4 号线 4m 盾构机" />
        </el-form-item>
        <el-form-item label="进度">
          <el-slider :model-value="editForm.progress_pct" :min="0" :max="100" :step="1" disabled show-input style="width: 100%" />
          <div class="progress-tip">进度由系统自动计算（工序完成率按标准工时加权；没有工序时按工单完成率），不支持手工修改。</div>
        </el-form-item>
        <el-form-item label="项目号">
          <el-input v-model="editForm.project_no" placeholder="可选" />
        </el-form-item>
        <el-form-item label="出厂序列号">
          <el-input v-model="editForm.serial_no" placeholder="可选" />
        </el-form-item>
        <el-form-item label="客户">
          <el-input v-model="editForm.customer_name" />
        </el-form-item>
        <el-form-item label="客户联系人">
          <el-input v-model="editForm.customer_contact" placeholder="姓名 / 电话" />
        </el-form-item>
        <el-form-item label="现场位置">
          <el-input v-model="editForm.site_location" />
        </el-form-item>
        <el-form-item label="合同号">
          <el-input v-model="editForm.contract_no" />
        </el-form-item>
        <el-form-item label="合同金额(万)">
          <el-input v-model="editForm.contract_amount" type="number" placeholder="单位：万元" />
        </el-form-item>
        <el-form-item label="计划开始">
          <el-date-picker v-model="editForm.planned_start" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" style="width: 100%" />
        </el-form-item>
        <el-form-item label="计划结束">
          <el-date-picker v-model="editForm.planned_end" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" style="width: 100%" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="editForm.notes" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="editSaving" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, watch, computed } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Api } from '../api'
import InstanceDeliveryTab from './delivery/InstanceDeliveryTab.vue'
import { EQUIPMENT_LIFECYCLE_META, EQUIPMENT_LIFECYCLE_OPTIONS, statusLabel as catalogStatusLabel, statusTag as catalogStatusTag } from '../domain/statusCatalog'
import { buildInstancePatch, normalizeProgressPct } from '../domain/instanceEdit'

const route = useRoute()
const id = computed(() => Number(route.params.id))
const loading = ref(false)
const tab = ref('overview')

const inst = ref<any>(null)
const dash = ref<any>(null)
const overview = ref<any>(null)
const bomTree = ref<any[]>([])
const workOrders = ref<any[]>([])
const materials = ref<any[]>([])
const bomFilter = ref('')
const treeRef = ref()
const nextStage = ref('')
const transitionReason = ref('')

const lifecycleOptions = ref<any[]>([...EQUIPMENT_LIFECYCLE_OPTIONS])
const auth = useAuthStore()
const canEdit = computed(() => auth.hasPerm('equipment:write'))

// 2026-10-21：编辑项目信息（进度/客户/合同等）
const editVisible = ref(false)
const editSaving = ref(false)
const editForm = reactive<any>({
  instance_name: '', progress_pct: 0, project_no: '', serial_no: '', customer_name: '',
  customer_contact: '', site_location: '', contract_no: '', contract_amount: '',
  planned_start: '', planned_end: '', notes: '',
})

const openEdit = () => {
  const source = inst.value || {}
  editForm.instance_name = source.instance_name || ''
  editForm.progress_pct = normalizeProgressPct(source.progress_pct)
  editForm.project_no = source.project_no || ''
  editForm.serial_no = source.serial_no || ''
  editForm.customer_name = source.customer_name || ''
  editForm.customer_contact = source.customer_contact || ''
  editForm.site_location = source.site_location || ''
  editForm.contract_no = source.contract_no || ''
  editForm.contract_amount = source.contract_amount ?? ''
  editForm.planned_start = source.planned_start || ''
  editForm.planned_end = source.planned_end || ''
  editForm.notes = source.notes || ''
  editVisible.value = true
}

const recalcProgress = async () => {
  try {
    const result: any = await Api.post(`/equipment_instances/${id.value}/progress/recalc`)
    const sourceLabel: Record<string, string> = { process_nodes: '工序完成率', work_orders: '工单完成率', none: '暂无工序/工单', unavailable: '进度模型未就绪' }
    ElMessage.success(`进度已重算：${result.pct ?? 0}%（${sourceLabel[result.source] || result.source}）`)
    await load()
  } catch (error: any) {
    ElMessage.error('重算失败: ' + (error?.response?.data?.message || error?.message || error))
  }
}

const saveEdit = async () => {
  editSaving.value = true
  try {
    const patch = buildInstancePatch({ ...editForm })
    // 进度由后端自动回写，前端不再提交，避免覆盖系统计算值
    delete patch.progress_pct
    await Api.put(`/equipment_instances/${id.value}`, patch)
    ElMessage.success('已保存项目信息')
    editVisible.value = false
    await load()
  } catch (error: any) {
    ElMessage.error('保存失败: ' + (error?.response?.data?.message || error?.message || error))
  } finally {
    editSaving.value = false
  }
}

const statusLabel = (s: string) => lifecycleOptions.value.find(x => x.value === s)?.label || catalogStatusLabel(EQUIPMENT_LIFECYCLE_META, s)
const statusTagType = (s: string) => catalogStatusTag(EQUIPMENT_LIFECYCLE_META, s)
const woStatusTagType = (s: string) => ({ pending: 'info', in_progress: 'primary', paused: 'warning', completed: 'success', issue: 'danger', rework: 'danger' } as any)[s] || 'info'
const matName = (mid: number) => materials.value.find((m: any) => m.id === mid)?.material_name
const isFrozen = computed(() => !!overview.value?.freeze?.frozen_at || overview.value?.freeze?.archive_status === 'archived')

const activeLifecycleIndex = computed(() => {
  const current = inst.value?.lifecycle_stage || inst.value?.status
  const idx = lifecycleOptions.value.findIndex((x: any) => x.value === current)
  return idx >= 0 ? idx : 0
})

const riskItems = computed(() => overview.value?.cards?.risks?.items || [])
const overviewCards = computed(() => {
  const c = overview.value?.cards || {}
  return [
    { title: 'BOM / 关键件', value: c.bom?.total || 0, sub: `关键件 ${c.bom?.key_components || 0}`, color: 'var(--el-color-primary)' },
    { title: '图纸文档', value: c.documents?.total || 0, sub: `目录 ${c.documents?.folders || 0}`, color: '#626aef' },
    { title: '采购 / 缺料', value: c.purchase?.open || 0, sub: `缺料 ${c.kit?.open || 0}`, color: (c.kit?.open || 0) ? 'var(--el-color-danger)' : 'var(--el-color-success)' },
    { title: '工单进度', value: c.work_orders?.completed || 0, sub: `进行中 ${c.work_orders?.in_progress || 0} / 总 ${c.work_orders?.total || 0}`, color: 'var(--el-color-success)' },
    { title: '质检 / NCR', value: c.quality?.inspections?.total || 0, sub: `NCR 未闭环 ${c.quality?.ncr?.open || 0}`, color: (c.quality?.ncr?.open || 0) ? 'var(--el-color-danger)' : 'var(--el-color-success)' },
    { title: '成本归集', value: Math.round(c.cost?.total || 0), sub: `材料估算 ${Math.round(c.cost?.material_estimate || 0)}`, color: 'var(--el-color-warning)' },
    { title: '交付风险', value: c.risks?.total || 0, sub: (c.risks?.total || 0) ? '需要主管处理' : '无阻塞', color: (c.risks?.total || 0) ? 'var(--el-color-danger)' : 'var(--el-color-success)' },
    { title: '冻结状态', value: overview.value?.freeze?.archive_status || 'active', sub: overview.value?.freeze?.frozen_at || '未冻结', color: isFrozen.value ? 'var(--el-color-warning)' : 'var(--el-color-success)' },
  ]
})

const decorateBom = (nodes: any[]): any[] => (Array.isArray(nodes) ? nodes : []).map(n => ({
  ...n,
  label: n.material_id ? (matName(n.material_id) || `物料#${n.material_id}`) : (n.notes || n.part_number || `节点#${n.id}`),
  material_name: n.material_id ? matName(n.material_id) : null,
  children: n.children ? decorateBom(n.children) : []
}))
const filteredBom = ref<any[]>([])
const filterNode = (value: any, data: any) => !value || [data.material_name, data.notes, data.part_number].some(x => x && String(x).includes(value))

const load = async () => {
  loading.value = true
  try {
    const [life, i, ov, d, bom, wo, mats] = await Promise.all([
      Api.instanceLifecycleOptions().catch(() => lifecycleOptions.value),
      Api.instance(id.value),
      Api.instanceOverview(id.value),
      Api.instanceDashboard(id.value).catch(() => null),
      Api.instanceBomTree(id.value).catch(() => []),
      Api.workOrders({ equipment_instance_id: id.value }),
      Api.materials()
    ])
    lifecycleOptions.value = life
    inst.value = ov?.instance || i
    overview.value = ov
    dash.value = d
    bomTree.value = Array.isArray(bom) ? bom : (bom?.tree || [])
    workOrders.value = Array.isArray(wo) ? wo : (wo?.items || [])
    materials.value = mats
    filteredBom.value = decorateBom(bomTree.value)
    nextStage.value = inst.value?.lifecycle_stage || inst.value?.status || 'design'
    await new Promise(r => setTimeout(r, 50))
    treeRef.value?.filter(bomFilter.value)
  } finally {
    loading.value = false
  }
}

const changeLifecycle = async () => {
  try {
    if (!nextStage.value) return
    await Api.updateInstanceLifecycle(id.value, { lifecycle_stage: nextStage.value, reason: transitionReason.value })
    ElMessage.success('生命周期已流转')
    transitionReason.value = ''
    await load()
  } catch (e: any) {
    ElMessage.error('生命周期流转失败: ' + (e?.message || e))
  }
}

const freezeInstance = async () => {
  try {
    await ElMessageBox.confirm('冻结后 BOM、图纸、工艺、成本基线不再允许修改，确认冻结？', '冻结基线', { type: 'warning' })
    await Api.freezeInstance(id.value, { reason: '交付基线冻结' })
    ElMessage.success('已冻结基线')
    await load()
  } catch (e: any) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error('冻结失败: ' + (e?.message || e))
  }
}

const archiveInstance = async () => {
  try {
    await ElMessageBox.confirm('归档会把项目装备转为历史状态，并自动冻结基线。确认归档？', '归档项目装备', { type: 'warning' })
    await Api.archiveInstance(id.value, { reason: '交付归档' })
    ElMessage.success('已归档')
    await load()
  } catch (e: any) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error('归档失败: ' + (e?.message || e))
  }
}

watch(bomFilter, (val) => treeRef.value?.filter(val))
onMounted(load)
</script>

<style scoped>
.header-actions { display: flex; gap: 8px; align-items: center; }
.lifecycle-actions { display: flex; gap: 8px; align-items: center; justify-content: flex-end; margin-top: 12px; }
.overview-card { min-height: 118px; }
.card-title { color: var(--el-text-color-secondary); font-size: 13px; }
.card-value { font-size: 28px; font-weight: 800; margin: 8px 0 4px; }
.card-sub { color: var(--el-text-color-secondary); font-size: 12px; }
.progress-tip {
  color: var(--el-color-info);
  font-size: 12px;
  line-height: 1.5;
  margin-top: 4px;
}
</style>
