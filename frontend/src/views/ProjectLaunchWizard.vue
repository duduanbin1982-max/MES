<template>
  <div class="page project-launch">
    <div class="hero-card">
      <div>
        <div class="eyebrow">TBM-MES PROJECT STARTUP</div>
        <h1>新建 TBM 项目启动向导</h1>
        <p>按真实生产主线把“建项目、建 BOM、图纸、工艺、齐套、工单、派工、报工、质检、成本、验收”串成一条线。</p>
        <div class="hero-tags">
          <el-tag effect="plain">先建项目装备</el-tag>
          <el-tag effect="plain" type="warning">再建树状 BOM</el-tag>
          <el-tag effect="plain" type="success">最后进入生产执行</el-tag>
        </div>
      </div>
      <div class="hero-actions">
        <el-button type="primary" size="large" @click="showCreate = true">
          <el-icon><Plus /></el-icon> 新建项目装备
        </el-button>
        <el-button size="large" @click="go('/help/manual')">查看操作手册</el-button>
        <el-button size="large" :loading="loading" @click="refreshAll">刷新状态</el-button>
      </div>
    </div>

    <el-row :gutter="16">
      <el-col :span="7">
        <el-card shadow="never" class="side-card">
          <template #header>
            <div class="card-head">
              <strong>1. 选择或创建项目装备</strong>
              <el-tag size="small" type="info">{{ instances.length }} 台</el-tag>
            </div>
          </template>
          <el-select
            v-model="selectedInstanceId"
            filterable
            placeholder="请选择一台 TBM 项目装备"
            class="full"
            @change="handleInstanceChange"
          >
            <el-option
              v-for="item in instances"
              :key="item.id"
              :label="`${item.instance_code} · ${item.instance_name || item.customer_name || ''}`"
              :value="item.id"
            />
          </el-select>
          <div v-if="selectedInstance" class="instance-card">
            <div class="instance-code">{{ selectedInstance.instance_code }}</div>
            <div class="instance-name">{{ selectedInstance.instance_name || '-' }}</div>
            <el-descriptions :column="1" size="small" border>
              <el-descriptions-item label="项目号">{{ selectedInstance.project_no || '-' }}</el-descriptions-item>
              <el-descriptions-item label="客户">{{ selectedInstance.customer_name || '-' }}</el-descriptions-item>
              <el-descriptions-item label="合同">{{ selectedInstance.contract_no || '-' }}</el-descriptions-item>
              <el-descriptions-item label="阶段">{{ selectedInstance.lifecycle_stage || selectedInstance.status || '-' }}</el-descriptions-item>
            </el-descriptions>
          </div>
          <el-empty v-else description="还没有项目装备，先点击新建" :image-size="72" />
        </el-card>

        <el-card shadow="never" class="side-card">
          <template #header>
            <div class="card-head">
              <strong>真实业务主线</strong>
              <span class="muted">照这个顺序做</span>
            </div>
          </template>
          <div class="mini-flow">
            <div v-for="(step, index) in flowSteps" :key="step.key" class="mini-flow-row" :class="step.status">
              <span class="mini-index">{{ index + 1 }}</span>
              <div>
                <div class="mini-title">{{ step.title }}</div>
                <div class="mini-module">{{ step.module }}</div>
              </div>
            </div>
          </div>
        </el-card>
      </el-col>

      <el-col :span="17">
        <el-card shadow="never" class="readiness-card">
          <el-row :gutter="16" align="middle">
            <el-col :span="6">
              <el-progress type="dashboard" :percentage="readinessPct" :color="progressColor" />
            </el-col>
            <el-col :span="18">
              <div class="readiness-title">项目启动完成度 {{ readinessPct }}%</div>
              <div class="muted">完成前 8 步后，车间就能开始按工单执行；后 3 步用于质量、成本、验收闭环。</div>
              <div class="kpi-row">
                <div class="kpi"><strong>{{ dashboard.bom_count || 0 }}</strong><span>BOM 节点</span></div>
                <div class="kpi"><strong>{{ processTotal }}</strong><span>工艺节点</span></div>
                <div class="kpi"><strong>{{ workOrderTotal }}</strong><span>工单</span></div>
                <div class="kpi"><strong>{{ docsCount }}</strong><span>图纸/文档</span></div>
              </div>
            </el-col>
          </el-row>
        </el-card>

        <el-alert
          v-if="!selectedInstanceId"
          type="warning"
          show-icon
          :closable="false"
          title="请先选择或创建项目装备。所有 BOM、图纸、工艺、工单、成本都必须挂到一台项目装备下面。"
          class="section-gap"
        />

        <el-alert
          v-if="loadErrors.length"
          type="warning"
          show-icon
          :closable="false"
          title="部分启动状态加载失败"
          :description="loadErrors.join('；')"
          class="section-gap"
        />

        <div class="flow-grid">
          <el-card v-for="step in flowSteps" :key="step.key" shadow="hover" class="flow-card" :class="step.status">
            <template #header>
              <div class="step-head">
                <div>
                  <div class="step-title">{{ step.title }}</div>
                  <div class="step-module">{{ step.module }}</div>
                </div>
                <el-tag :type="statusTag(step.status)" size="small">{{ statusText(step.status) }}</el-tag>
              </div>
            </template>
            <div class="step-purpose">{{ step.purpose }}</div>
            <div class="step-evidence">{{ step.evidence }}</div>
            <div class="step-actions">
              <el-button
                v-for="action in step.actions"
                :key="action.label"
                size="small"
                :type="action.type || 'default'"
                :disabled="!selectedInstanceId && action.needInstance !== false"
                :loading="action.loadingKey && actionLoading === action.loadingKey"
                @click="runAction(action)"
              >
                {{ action.label }}
              </el-button>
            </div>
          </el-card>
        </div>
      </el-col>
    </el-row>

    <EquipmentInstanceCreateDialog v-model="showCreate" :types="types" :rows="instances" @created="handleCreated" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Api } from '../api'
import EquipmentInstanceCreateDialog from './equipment/EquipmentInstanceCreateDialog.vue'

const route = useRoute()
const router = useRouter()

const loading = ref(false)
const showCreate = ref(false)
const actionLoading = ref('')
const selectedInstanceId = ref<number | null>(null)
const instances = ref<any[]>([])
const types = ref<any[]>([])
const dashboard = ref<any>({})
const bomHealth = ref<any>({})
const docsCount = ref(0)
const kitStatus = ref<any>({})
const qualityStatus = ref<any>({ inspection_count: 0, ncr_count: 0, open_ncr_count: 0 })
const costStatus = ref<any>({})
const acceptanceStatus = ref<any>({ total: 0, done: 0 })
const loadErrors = ref<string[]>([])

const selectedInstance = computed(() => instances.value.find((item) => Number(item.id) === Number(selectedInstanceId.value)) || null)
const processTotal = computed(() => Number(dashboard.value.process_nodes?.total || 0))
const workOrderTotal = computed(() => Number(dashboard.value.work_orders?.total || 0))
const dispatchedTotal = computed(() => {
  const workOrders = dashboard.value.work_orders || {}
  return Number(workOrders.dispatched || 0) + Number(workOrders.in_progress || 0) + Number(workOrders.completed || 0)
})

const statusOf = (done: boolean, partial = false) => (done ? 'done' : partial ? 'partial' : 'todo')
const statusText = (status: string) => ({ done: '已完成', partial: '待完善', todo: '待开始' } as any)[status] || status
const statusTag = (status: string) => ({ done: 'success', partial: 'warning', todo: 'info' } as any)[status] || 'info'
const progressColor = computed(() => readinessPct.value >= 80 ? 'var(--el-color-success)' : readinessPct.value >= 45 ? 'var(--el-color-warning)' : 'var(--el-color-primary)')

const routeFor = (path: string) => selectedInstanceId.value ? `${path}${path.includes('?') ? '&' : '?'}instance_id=${selectedInstanceId.value}` : path
const isDoneStatus = (value: any) => ['done', 'closed', 'accepted', 'passed', 'signed', 'completed'].includes(String(value || '').toLowerCase())
const safeLoad = async (label: string, loader: () => Promise<any>, fallback: any) => {
  try {
    return await loader()
  } catch (error: any) {
    loadErrors.value.push(`${label}: ${error?.message || error || '加载失败'}`)
    return fallback
  }
}

const flowSteps = computed(() => {
  const bomCount = Number(dashboard.value.bom_count || 0)
  const workOrders = dashboard.value.work_orders || {}
  const completedWo = Number(workOrders.completed || 0)
  const bomScore = Number(bomHealth.value.score || 0)
  const kitStats = kitStatus.value.stats || {}
  const kitTotal = Number(kitStats.total || 0)
  const kitBlocked = Number(kitStats.blocked || 0)
  const kitPartial = Number(kitStats.partial || 0)
  const inspectionCount = Number(qualityStatus.value.inspection_count || 0)
  const openNcrCount = Number(qualityStatus.value.open_ncr_count || 0)
  const ncrCount = Number(qualityStatus.value.ncr_count || 0)
  const actualCost = Number(costStatus.value.totals?.actual_cost || 0)
  const estimatedCost = Number(costStatus.value.totals?.estimated_cost || 0)
  const pendingKeyComponents = Number(costStatus.value.key_components?.pending_count || 0)
  const acceptanceTotal = Number(acceptanceStatus.value.total || 0)
  const acceptanceDone = Number(acceptanceStatus.value.done || 0)
  return [
    {
      key: 'project',
      title: '建立项目装备',
      module: '项目与装备 → 项目装备',
      purpose: '建立这台 TBM 的唯一业务主对象，后续所有数据都挂在它下面。',
      evidence: selectedInstance.value ? `已选择 ${selectedInstance.value.instance_code}` : '尚未选择项目装备',
      status: statusOf(Boolean(selectedInstance.value)),
      actions: [
        { label: '新建项目装备', type: 'primary', needInstance: false, handler: () => { showCreate.value = true } },
        { label: '查看项目详情', route: selectedInstanceId.value ? `/instances/${selectedInstanceId.value}` : '/instances' },
      ],
    },
    {
      key: 'bom',
      title: '建立树状 BOM',
      module: '设计与BOM → BOM 管理',
      purpose: '按 0级整机、1级主要部件、2级子部件/零件建立可展开的产品结构树。',
      evidence: `当前 BOM 节点 ${bomCount} 个，健康度 ${bomScore || 0} 分`,
      status: statusOf(bomCount >= 3, bomCount > 0),
      actions: [
        { label: '打开 BOM 树', type: 'primary', route: routeFor('/bom') },
        { label: '生成最低三级骨架', loadingKey: 'bom', handler: initMinimumBom },
      ],
    },
    {
      key: 'docs',
      title: '绑定图纸/SOP',
      module: '设计与BOM → 文档/图纸',
      purpose: '把图纸、SOP、检验标准绑定到项目装备或 BOM 节点，保证现场看到最新版。',
      evidence: `当前已关联文档 ${docsCount.value} 份`,
      status: statusOf(docsCount.value > 0),
      actions: [
        { label: '上传图纸/SOP', type: 'primary', route: routeFor('/documents') },
      ],
    },
    {
      key: 'process',
      title: '建立工艺路线',
      module: '设计与BOM → 工艺树',
      purpose: '为每个主要部件定义工序、标准工时、工位、质检要求和前后置关系。',
      evidence: `当前工艺节点 ${processTotal.value} 个`,
      status: statusOf(processTotal.value > 0),
      actions: [
        { label: '打开工艺树', type: 'primary', route: routeFor('/process-tree') },
        { label: '按 BOM 生成缺失工艺', loadingKey: 'process', handler: generateProcessRoutes },
      ],
    },
    {
      key: 'kit',
      title: '齐套/缺料检查',
      module: '采购与库存 → 齐套/缺料闭环',
      purpose: '生产前检查 BOM 需求与库存/采购到货，发现缺料并分派责任人。',
      evidence: kitTotal ? `齐套工单 ${kitTotal} 个，阻塞 ${kitBlocked} 个，部分齐套 ${kitPartial} 个` : '进入齐套页面查看缺料、责任人、预计到货和采购跟催状态',
      status: statusOf(kitTotal > 0 && kitBlocked === 0 && kitPartial === 0, bomCount > 0 || kitTotal > 0),
      actions: [
        { label: '打开齐套闭环', type: 'primary', route: routeFor('/kit-closure') },
        { label: '采购跟催', route: routeFor('/purchase?tab=followup') },
      ],
    },
    {
      key: 'workorder',
      title: '生成工单',
      module: '生产执行 → 工单管理',
      purpose: '把项目装备、BOM 部件和工艺路线转成可执行的生产任务。',
      evidence: `当前工单 ${workOrderTotal.value} 张`,
      status: statusOf(workOrderTotal.value > 0),
      actions: [
        { label: '打开工单管理', type: 'primary', route: routeFor('/work-orders?tab=list') },
      ],
    },
    {
      key: 'dispatch',
      title: '派工到人/工位',
      module: '生产执行 → 生产单元派工',
      purpose: '把工单下发给班组、人员和工位，形成现场可执行任务。',
      evidence: `已派工/执行/完成 ${dispatchedTotal.value} 张`,
      status: statusOf(dispatchedTotal.value > 0, workOrderTotal.value > 0),
      actions: [
        { label: '进入待派工', type: 'primary', route: routeFor('/work-orders?tab=dispatch') },
      ],
    },
    {
      key: 'shopfloor',
      title: '领料与报工',
      module: '生产执行 → 车间工作台',
      purpose: '现场扫码领料、查看图纸、报工、质检录入、异常上报。',
      evidence: `已完工 ${completedWo} 张；未完工 ${Math.max(workOrderTotal.value - completedWo, 0)} 张`,
      status: statusOf(completedWo > 0, dispatchedTotal.value > 0),
      actions: [
        { label: '扫码报工', type: 'primary', route: routeFor('/shopfloor?tab=scan') },
        { label: '领料', route: routeFor('/shopfloor?tab=pick') },
      ],
    },
    {
      key: 'quality',
      title: '质检闭环',
      module: '质量与追溯 → 过程/出厂检验',
      purpose: '记录来料、过程、出厂检验；不合格进入 NCR/CAPA 闭环。',
      evidence: `质检记录 ${inspectionCount} 条，NCR ${ncrCount} 个，未闭环 ${openNcrCount} 个`,
      status: statusOf(inspectionCount > 0 && openNcrCount === 0, completedWo > 0 || inspectionCount > 0 || ncrCount > 0),
      actions: [
        { label: '过程检验', type: 'primary', route: routeFor('/quality?tab=inspections&type=in_process') },
        { label: 'NCR/CAPA', route: routeFor('/quality?tab=ncr') },
      ],
    },
    {
      key: 'cost',
      title: '成本归集',
      module: '成本与经营 → 成本归集',
      purpose: '把材料、人工、外协、折旧、返工、质量损失归集到项目装备。',
      evidence: actualCost ? `已归集 ${actualCost.toLocaleString('zh-CN')} 元，待签关键件 ${pendingKeyComponents} 项` : '进入成本归集查看项目成本偏差与明细科目',
      status: statusOf(actualCost > 0 && pendingKeyComponents === 0, estimatedCost > 0 || actualCost > 0 || workOrderTotal.value > 0),
      actions: [
        { label: '查看成本归集', type: 'primary', route: routeFor('/cost') },
      ],
    },
    {
      key: 'accept',
      title: '客户验收交付',
      module: '项目与装备 → 客户验收',
      purpose: '完成整机调试、出厂验收、签收和交付归档。',
      evidence: acceptanceTotal ? `验收单 ${acceptanceTotal} 张，已完成 ${acceptanceDone} 张` : '交付后建议冻结 BOM、图纸、工艺和成本基线',
      status: statusOf(acceptanceTotal > 0 && acceptanceDone >= acceptanceTotal, completedWo > 0 || acceptanceTotal > 0),
      actions: [
        { label: '客户验收', type: 'primary', route: routeFor('/tbm-advanced?tab=accept') },
      ],
    },
  ]
})

const readinessPct = computed(() => {
  if (!flowSteps.value.length) return 0
  const score = flowSteps.value.reduce((sum, step) => sum + (step.status === 'done' ? 1 : step.status === 'partial' ? 0.45 : 0), 0)
  return Math.round((score / flowSteps.value.length) * 100)
})

const normalizeList = (value: any) => Array.isArray(value) ? value : (value?.items || value?.rows || value?.data || [])
const countList = (value: any) => normalizeList(value).length || Number(value?.total || value?.count || 0)

const loadInstances = async () => {
  const [instanceRows, typeRows] = await Promise.all([
    safeLoad('项目装备', () => Api.instances(), []),
    safeLoad('装备类型', () => Api.equipmentTypes(), []),
  ])
  instances.value = normalizeList(instanceRows)
  types.value = normalizeList(typeRows)
  const routeInstanceId = Number(route.query.instance_id || route.query.equipment_instance_id || 0)
  if (routeInstanceId && instances.value.some((item) => Number(item.id) === routeInstanceId)) {
    selectedInstanceId.value = routeInstanceId
  } else if (!selectedInstanceId.value && instances.value.length) {
    selectedInstanceId.value = Number(instances.value[0].id)
  }
}

const loadProjectStatus = async () => {
  if (!selectedInstanceId.value) {
    dashboard.value = {}
    bomHealth.value = {}
    docsCount.value = 0
    kitStatus.value = {}
    qualityStatus.value = { inspection_count: 0, ncr_count: 0, open_ncr_count: 0 }
    costStatus.value = {}
    acceptanceStatus.value = { total: 0, done: 0 }
    return
  }
  const id = selectedInstanceId.value
  loading.value = true
  try {
    const [dash, health, docs, kit, inspections, ncrs, cost, acceptance] = await Promise.all([
      safeLoad('项目仪表盘', () => Api.instanceDashboard(id), {}),
      safeLoad('BOM健康度', () => Api.get(`/equipment_instances/${id}/bom/health`), {}),
      safeLoad('文档/图纸', () => Api.get('/documents', { params: { equipment_instance_id: id } }), []),
      safeLoad('齐套检查', () => Api.get(`/equipment_instances/${id}/kit_check`), {}),
      safeLoad('质检记录', () => Api.get('/qc_inspections', { params: { equipment_instance_id: id } }), []),
      safeLoad('NCR闭环', () => Api.get('/qc/ncr', { params: { equipment_instance_id: id } }), []),
      safeLoad('成本归集', () => Api.get(`/equipment_instances/${id}/cost_rollup`), {}),
      safeLoad('客户验收', () => Api.get('/acceptance-checklists', { params: { equipment_instance_id: id } }), []),
    ])
    const inspectionRows = normalizeList(inspections)
    const ncrRows = normalizeList(ncrs)
    const acceptanceRows = normalizeList(acceptance)
    dashboard.value = dash || {}
    bomHealth.value = health || {}
    docsCount.value = countList(docs)
    kitStatus.value = kit || {}
    qualityStatus.value = {
      inspection_count: inspectionRows.length,
      ncr_count: ncrRows.length,
      open_ncr_count: ncrRows.filter((item: any) => !isDoneStatus(item.status) && !item.closed_at).length,
    }
    costStatus.value = cost || {}
    acceptanceStatus.value = {
      total: acceptanceRows.length,
      done: acceptanceRows.filter((item: any) => isDoneStatus(item.status) || isDoneStatus(item.result)).length,
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '项目启动状态加载失败')
  } finally {
    loading.value = false
  }
}

const refreshAll = async () => {
  loadErrors.value = []
  await loadInstances()
  await loadProjectStatus()
}

const handleInstanceChange = async () => {
  if (selectedInstanceId.value) router.replace({ query: { ...route.query, instance_id: selectedInstanceId.value } })
  await loadProjectStatus()
}

const handleCreated = async (id: number) => {
  showCreate.value = false
  selectedInstanceId.value = id
  await refreshAll()
  router.replace({ query: { ...route.query, instance_id: id } })
  ElMessage.success('项目装备已创建，请继续完善 BOM 树')
}

const runAction = async (action: any) => {
  if (action.handler) {
    await action.handler()
    return
  }
  if (action.route) go(action.route)
}

const go = (path: string) => router.push(path)

async function initMinimumBom() {
  if (!selectedInstanceId.value) return
  actionLoading.value = 'bom'
  try {
    await Api.post(`/equipment_instances/${selectedInstanceId.value}/bom/init-minimum`)
    ElMessage.success('已生成最低三级 BOM 骨架')
    await loadProjectStatus()
  } catch (error: any) {
    ElMessage.error(error?.message || '生成 BOM 骨架失败')
  } finally {
    actionLoading.value = ''
  }
}

async function generateProcessRoutes() {
  if (!selectedInstanceId.value) return
  actionLoading.value = 'process'
  try {
    const result: any = await Api.post(`/process-route/instances/${selectedInstanceId.value}/generate-missing`)
    try {
      await Api.post(`/process-route/instances/${selectedInstanceId.value}/auto-bind`)
    } catch (error: any) {
      ElMessage.warning('工艺已生成，但自动绑定工位/技能失败: ' + (error?.message || error))
    }
    ElMessage.success(`已生成缺失工艺 ${result?.created || 0} 条`)
    await loadProjectStatus()
  } catch (error: any) {
    ElMessage.error(error?.message || '生成工艺路线失败')
  } finally {
    actionLoading.value = ''
  }
}

onMounted(refreshAll)
</script>

<style scoped>
.page { padding: 16px 24px; }
.project-launch { min-height: calc(100vh - 56px); }
.hero-card {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  padding: 22px;
  margin-bottom: 16px;
  border: 1px solid var(--color-border, var(--el-border-color-lighter));
  border-radius: 18px;
  background: linear-gradient(135deg, var(--color-surface, #fff), var(--color-surface-muted, #f7f9fb));
  box-shadow: var(--shadow-sm, 0 8px 22px rgba(31, 41, 55, 0.06));
}
.eyebrow { color: var(--color-primary, var(--el-color-primary)); font-size: 12px; font-weight: 700; letter-spacing: 0.12em; }
.hero-card h1 { margin: 6px 0; color: var(--color-text, var(--el-text-color-primary)); font-size: 28px; }
.hero-card p { max-width: 820px; margin: 0; color: var(--color-text-secondary, var(--el-text-color-secondary)); line-height: 1.6; }
.hero-tags, .hero-actions, .step-actions, .kpi-row { display: flex; flex-wrap: wrap; gap: 8px; }
.hero-tags { margin-top: 14px; }
.hero-actions { align-content: center; justify-content: flex-end; min-width: 380px; }
.side-card, .readiness-card, .section-gap { margin-bottom: 16px; }
.card-head, .step-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.full { width: 100%; }
.muted { color: var(--color-text-secondary, var(--el-text-color-secondary)); font-size: 13px; }
.instance-card { margin-top: 14px; }
.instance-code { font-size: 18px; font-weight: 700; color: var(--color-text, var(--el-text-color-primary)); }
.instance-name { margin: 4px 0 12px; color: var(--color-text-secondary, var(--el-text-color-secondary)); }
.mini-flow { display: grid; gap: 8px; }
.mini-flow-row {
  display: grid;
  grid-template-columns: 30px 1fr;
  gap: 8px;
  padding: 9px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  background: var(--el-fill-color-blank);
}
.mini-flow-row.done { border-color: var(--el-color-success-light-5); background: var(--el-color-success-light-9); }
.mini-flow-row.partial { border-color: var(--el-color-warning-light-5); background: var(--el-color-warning-light-9); }
.mini-index {
  width: 24px;
  height: 24px;
  display: inline-grid;
  place-items: center;
  border-radius: 999px;
  background: var(--el-fill-color-light);
  font-weight: 700;
}
.mini-title { font-weight: 700; font-size: 13px; }
.mini-module, .step-module { color: var(--color-text-secondary, var(--el-text-color-secondary)); font-size: 12px; margin-top: 2px; }
.readiness-title { font-size: 20px; font-weight: 700; margin-bottom: 6px; }
.kpi-row { margin-top: 14px; }
.kpi { min-width: 96px; padding: 10px 12px; border-radius: 12px; background: var(--el-fill-color-light); text-align: center; }
.kpi strong { display: block; font-size: 22px; color: var(--color-text, var(--el-text-color-primary)); }
.kpi span { color: var(--color-text-secondary, var(--el-text-color-secondary)); font-size: 12px; }
.flow-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.flow-card { border-left: 4px solid var(--el-border-color); }
.flow-card.done { border-left-color: var(--el-color-success); }
.flow-card.partial { border-left-color: var(--el-color-warning); }
.flow-card.todo { border-left-color: var(--el-color-info-light-3); }
.step-title { font-size: 16px; font-weight: 700; color: var(--color-text, var(--el-text-color-primary)); }
.step-purpose { min-height: 44px; color: var(--color-text, var(--el-text-color-primary)); line-height: 1.55; }
.step-evidence {
  margin: 10px 0 12px;
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--el-fill-color-light);
  color: var(--color-text-secondary, var(--el-text-color-secondary));
  font-size: 13px;
}
@media (max-width: 1180px) {
  .hero-card { flex-direction: column; }
  .hero-actions { min-width: 0; justify-content: flex-start; }
  .flow-grid { grid-template-columns: 1fr; }
}
</style>
