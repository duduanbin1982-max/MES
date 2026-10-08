<template>
  <div class="page">
    <div class="page-header">
      <div>
        <div class="page-title"><el-icon><Promotion /></el-icon> 系统初始化向导</div>
        <div class="sub">空白 MES 首日落地：按 8 步把人、机、料、法、图纸、工单准备好。</div>
      </div>
      <div class="header-actions">
        <el-button @click="go('/delivery')">项目交付闭环</el-button>
        <el-button type="primary" :loading="loading" @click="loadStatus">刷新状态</el-button>
      </div>
    </div>

    <el-card shadow="never" class="summary-card">
      <el-row :gutter="16" align="middle">
        <el-col :span="6">
          <el-progress type="dashboard" :percentage="status.overall || 0" :color="progressColor" />
        </el-col>
        <el-col :span="18">
          <div class="summary-head">
            <div>
              <h3>初始化完成度 {{ status.overall || 0 }}%</h3>
              <p class="sub" v-if="status.next_step">下一步建议：{{ status.next_step.title }} · {{ status.next_step.owner_role }}</p>
              <p class="sub" v-else>主数据与首日生产准备已基本完成，可以进入项目交付闭环。</p>
            </div>
            <div class="summary-kpis">
              <div class="mini-kpi"><strong>{{ status.summary?.done_steps || 0 }}</strong><span>已完成</span></div>
              <div class="mini-kpi danger"><strong>{{ status.summary?.blocked_steps || 0 }}</strong><span>阻塞步骤</span></div>
              <div class="mini-kpi warning"><strong>{{ status.summary?.issue_count || 0 }}</strong><span>待完善项</span></div>
            </div>
          </div>
          <div class="quick-actions" v-if="status.next_step">
            <el-button
              v-for="action in status.next_step.actions"
              :key="action.route"
              :type="action.primary ? 'primary' : 'default'"
              @click="go(action.route)"
            >
              {{ action.label }}
            </el-button>
          </div>
          <div class="quick-actions" v-else>
            <el-button v-for="action in status.exit_actions || []" :key="action.route" @click="go(action.route)">
              {{ action.label }}
            </el-button>
          </div>
        </el-col>
      </el-row>
    </el-card>

    <el-card shadow="never" class="flow-card">
      <template #header>
        <div class="step-head">
          <strong>首日业务顺序</strong>
          <span class="sub">从左到右做，后一步依赖前一步的数据质量</span>
        </div>
      </template>
      <div class="flow-line">
        <div
          v-for="step in status.steps || []"
          :key="step.id"
          class="flow-node"
          :class="`flow-${step.status}`"
          role="button"
          tabindex="0"
          @click="focusStep(step)"
          @keydown.enter.prevent="focusStep(step)"
          @keydown.space.prevent="focusStep(step)"
        >
          <div class="flow-title">{{ shortTitle(step.title) }}</div>
          <div class="flow-progress">{{ step.progress }}%</div>
          <el-tag size="small" :type="tagType(step.status)">{{ statusText(step.status) }}</el-tag>
        </div>
      </div>
    </el-card>

    <el-row :gutter="16" class="steps">
      <el-col v-for="step in status.steps || []" :key="step.id" :span="12">
        <el-card shadow="hover" class="step-card" :class="{ active: selectedStep?.id === step.id }">
          <template #header>
            <div class="step-head">
              <div>
                <strong>{{ step.title }}</strong>
                <div class="owner">责任角色：{{ step.owner_role }}</div>
              </div>
              <el-tag :type="tagType(step.status)" size="small">{{ statusText(step.status) }}</el-tag>
            </div>
          </template>
          <div class="goal">{{ step.business_goal }}</div>
          <el-progress :percentage="step.progress" :status="step.progress >= 100 ? 'success' : undefined" />
          <div class="metrics">
            <el-tag v-for="(value, key) in step.metrics" :key="key" size="small" type="info">
              {{ metricLabel(String(key)) }}: {{ value }}
            </el-tag>
          </div>
          <div v-if="step.issues && step.issues.length" class="issue-list">
            <div v-for="item in step.issues" :key="item.title" class="issue-line">
              <el-tag :type="severityTag(item.severity)" size="small">{{ severityText(item.severity) }}</el-tag>
              <div class="issue-body">
                <div class="issue-title">{{ item.title }}</div>
                <div class="issue-detail">{{ item.detail }}</div>
              </div>
            </div>
          </div>
          <el-empty v-else description="该步骤已达首日可用标准" :image-size="46" />
          <div class="quick-actions">
            <el-button
              v-for="action in step.actions"
              :key="action.route"
              size="small"
              :type="action.primary ? 'primary' : 'default'"
              @click="go(action.route)"
            >
              {{ action.label }}
            </el-button>
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Api } from '../api'

const router = useRouter()
const loading = ref(false)
const status = ref<any>({ overall: 0, steps: [], summary: {} })
const selectedStep = ref<any | null>(null)

const progressColor = computed(() => {
  const value = status.value.overall || 0
  if (value >= 85) return 'var(--el-color-success)'
  if (value >= 60) return 'var(--el-color-warning)'
  return 'var(--el-color-danger)'
})

const tagType = (value: string) => ({ done: 'success', partial: 'warning', blocked: 'danger', empty: 'info' } as any)[value] || 'info'
const statusText = (value: string) => ({ done: '已完成', partial: '待完善', blocked: '阻塞', empty: '未开始' } as any)[value] || value
const severityTag = (value: string) => ({ critical: 'danger', high: 'danger', warning: 'warning', info: 'info' } as any)[value] || 'info'
const severityText = (value: string) => ({ critical: '严重', high: '高', warning: '中', info: '低' } as any)[value] || value
const metricLabel = (key: string) => ({
  active_users: '启用用户',
  roles: '角色',
  required_roles: '必备角色',
  workstations: '工位',
  assembly_stations: '装配',
  welding_stations: '焊接',
  inspection_stations: '检验',
  suppliers: '供应商',
  key_suppliers: '关键件',
  outsourcing_suppliers: '外协',
  certificates: '资质',
  materials: '物料',
  material_with_code: '有编码',
  material_with_safety: '安全库存',
  duplicate_codes: '重复编码',
  instances: '装备',
  active_instances: '有效装备',
  coded_instances: '有编码',
  lifecycle_instances: '有阶段',
  bom_rows: 'BOM行',
  bom_instances: '覆盖装备',
  tier0: '0级',
  tier1: '1级',
  tier2: '2级',
  bom_without_material: '未绑物料',
  documents: '文档',
  issued_docs: '已签发',
  linked_docs: '已绑定',
  process_nodes: '工艺节点',
  with_hours: '有工时',
  with_station: '有工位',
  with_skill: '有技能',
  work_orders: '工单',
  dispatched_work_orders: '已下发',
  schedule_assignments: '排程',
} as any)[key] || key

const shortTitle = (title: string) => title.replace(/^\d+\.\s*/, '').replace('用户和角色权限', '用户权限').replace('工位、人员、供应商', '资源供应商').replace('绑定图纸/文档', '图纸文档').replace('生成工单和排程', '工单排程')

const focusStep = (step: any) => {
  selectedStep.value = step
}

const loadStatus = async () => {
  loading.value = true
  try {
    status.value = await Api.get('/setup/status')
    selectedStep.value = status.value.next_step || status.value.steps?.[0] || null
  } catch (e: any) {
    ElMessage.error(e?.message || '初始化状态加载失败')
  } finally {
    loading.value = false
  }
}

const go = (route: string) => router.push(route)

onMounted(loadStatus)
</script>

<style scoped>
.page { padding: 16px 24px; }
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.page-title { font-size: 20px; font-weight: 700; }
.sub { color: var(--color-text-muted); margin: 4px 0; font-size: 13px; }
.header-actions { display: flex; gap: 8px; }
.summary-card, .flow-card { margin-bottom: 16px; }
.summary-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
.summary-head h3 { margin: 0 0 8px; }
.summary-kpis { display: flex; gap: 10px; }
.mini-kpi { min-width: 86px; padding: 10px; border-radius: 10px; background: var(--el-fill-color-light); text-align: center; }
.mini-kpi strong { display: block; font-size: 22px; }
.mini-kpi span { color: var(--el-text-color-secondary); font-size: 12px; }
.mini-kpi.danger strong { color: var(--el-color-danger); }
.mini-kpi.warning strong { color: var(--el-color-warning); }
.steps { row-gap: 16px; }
.step-card { margin-bottom: 16px; min-height: 330px; border: 1px solid transparent; }
.step-card.active { border-color: var(--el-color-primary-light-5); }
.step-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.owner { color: var(--el-text-color-secondary); font-size: 12px; margin-top: 4px; }
.goal { color: var(--el-text-color-regular); font-size: 13px; margin-bottom: 10px; line-height: 1.5; }
.metrics { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; }
.quick-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.flow-line { display: grid; grid-template-columns: repeat(8, minmax(108px, 1fr)); gap: 10px; overflow-x: auto; }
.flow-node { min-height: 88px; border-radius: 12px; border: 1px solid var(--el-border-color-lighter); padding: 10px; cursor: pointer; background: var(--el-fill-color-blank); }
.flow-node:hover { box-shadow: var(--el-box-shadow-light); transform: translateY(-1px); }
.flow-title { font-weight: 700; font-size: 13px; }
.flow-progress { margin: 8px 0; color: var(--el-text-color-secondary); }
.flow-done { background: var(--el-color-success-light-9); border-color: var(--el-color-success-light-5); }
.flow-partial { background: var(--el-color-warning-light-9); border-color: var(--el-color-warning-light-5); }
.flow-blocked { background: var(--el-color-danger-light-9); border-color: var(--el-color-danger-light-5); }
.flow-empty { background: var(--el-fill-color-light); }
.issue-list { margin: 10px 0; border-top: 1px solid var(--el-border-color-lighter); }
.issue-line { display: flex; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--el-border-color-lighter); }
.issue-body { flex: 1; min-width: 0; }
.issue-title { font-weight: 600; font-size: 13px; }
.issue-detail { color: var(--el-text-color-secondary); font-size: 12px; margin-top: 4px; line-height: 1.5; }
</style>
