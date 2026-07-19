<template>
  <div class="page">
    <div class="page-header">
      <div>
        <div class="page-title">项目交付看板</div>
        <div class="page-subtitle">合同到验收的项目级进度、风险与业务断点</div>
      </div>
      <el-button :icon="Refresh" size="small" :loading="loading" @click="loadAll">刷新</el-button>
    </div>

    <el-row :gutter="16" class="kpi-row">
      <el-col :span="6">
        <el-card class="kpi-card">
          <div class="stat-label">项目总数</div>
          <div class="stat-value">{{ summary.total_projects || 0 }}</div>
          <div class="stat-sub">TBM 实例</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="kpi-card">
          <div class="stat-label">平均进度</div>
          <div class="stat-value">{{ summary.avg_progress || 0 }}%</div>
          <div class="stat-sub">按工单与工序综合</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="kpi-card">
          <div class="stat-label">风险项目</div>
          <div class="stat-value danger">{{ summary.risk_projects || 0 }}</div>
          <div class="stat-sub">存在延期/质量/变更等异常</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="kpi-card">
          <div class="stat-label">待处理异常</div>
          <div class="stat-value warning">{{ summary.open_exceptions || 0 }}</div>
          <div class="stat-sub">跨模块异常池</div>
        </el-card>
      </el-col>
    </el-row>

    <el-alert
      v-if="loadError"
      class="load-alert"
      type="error"
      show-icon
      :closable="false"
      title="项目交付看板加载失败"
      :description="loadError"
    >
      <template #default>
        <el-button size="small" type="primary" plain @click="loadAll">重试</el-button>
      </template>
    </el-alert>

    <el-card class="workflow-card">
      <template #header>
        <div class="card-header">
          <span>流程工作台</span>
          <span class="workflow-hint">一行一台 TBM，一格一个业务阶段；红/黄格就是当前堵点</span>
        </div>
      </template>
      <div class="workflow-scroll">
        <table class="workflow-table">
          <thead>
            <tr>
              <th class="project-col">项目</th>
              <th v-for="key in workflowKeys" :key="key">{{ workflowLabel(key) }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="project in filteredProjects" :key="project.id">
              <td class="project-col">
                <div class="wf-project-code">{{ project.instance_code }}</div>
                <div class="wf-project-name">{{ project.instance_name }}</div>
              </td>
              <td v-for="key in workflowKeys" :key="`${project.id}-${key}`">
                <div class="flow-cell" :class="`flow-${stageByKey(project, key).status}`" @click="openStage(project, stageByKey(project, key))">
                  <div class="flow-cell-head">
                    <span>{{ stageByKey(project, key).percent }}%</span>
                    <el-tag v-if="stageByKey(project, key).blocker_count" size="small" type="danger">{{ stageByKey(project, key).blocker_count }}</el-tag>
                  </div>
                  <div class="flow-cell-status">{{ statusLabel(stageByKey(project, key).status) }}</div>
                  <div class="flow-cell-owner">{{ stageByKey(project, key).owner_role }}</div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </el-card>

    <el-row :gutter="16">
      <el-col :span="15">
        <el-card>
          <template #header>
            <div class="card-header">
              <span>交付项目</span>
              <el-segmented v-model="riskFilter" :options="riskOptions" size="small" @change="applyFilter" />
            </div>
          </template>
          <el-table :data="filteredProjects" size="small" height="620" @row-click="selectProject">
            <el-table-column prop="instance_code" label="项目编码" width="140" />
            <el-table-column prop="instance_name" label="项目名称" min-width="220" show-overflow-tooltip />
            <el-table-column prop="customer_name" label="客户" width="140" show-overflow-tooltip />
            <el-table-column label="阶段" width="120">
              <template #default="{ row }">
                <el-tag size="small">{{ row.lifecycle_stage || row.status || '-' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="进度" width="170">
              <template #default="{ row }">
                <el-progress :percentage="Math.round(row.progress_pct || 0)" :stroke-width="8" />
              </template>
            </el-table-column>
            <el-table-column label="风险" width="110">
              <template #default="{ row }">
                <el-tag :type="riskTag(row.risk_level)" size="small">{{ riskLabel(row.risk_level) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="跟催" width="90">
              <template #default="{ row }">
                <el-badge :value="row.risk_breakdown?.purchase_followup_count || 0" :hidden="!(row.risk_breakdown?.purchase_followup_count)">
                  <span>{{ row.risk_breakdown?.purchase_followup_overdue || 0 }}延</span>
                </el-badge>
              </template>
            </el-table-column>
            <el-table-column label="风险钻取" width="110">
              <template #default="{ row }">
                <el-button link size="small" @click.stop="openRiskDrawer(row)">钻取</el-button>
              </template>
            </el-table-column>
            <el-table-column label="主线体检" width="110">
              <template #default="{ row }">
                <el-button link size="small" @click.stop="openLineageDrawer(row)">体检</el-button>
              </template>
            </el-table-column>
            <el-table-column label="异常" width="80">
              <template #default="{ row }">
                <el-badge :value="row.exception_count" :hidden="!row.exception_count">
                  <el-button link size="small" @click.stop="goExceptions(row)">查看</el-button>
                </el-badge>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>

      <el-col :span="9">
        <el-card class="detail-card">
          <template #header>
            <div class="card-header">
              <span>{{ selected?.instance_code || '项目详情' }}</span>
              <div>
                <el-button v-if="selected" link size="small" @click="openLineageDrawer(selected)">主线体检</el-button>
                <el-button v-if="selected" link size="small" @click="openRiskDrawer(selected)">风险钻取</el-button>
                <el-button v-if="selected" link size="small" @click="goDetail(selected)">实例详情</el-button>
              </div>
            </div>
          </template>

          <template v-if="selected">
            <div class="project-title">{{ selected.instance_name }}</div>
            <div class="project-meta">
              <el-tag :type="riskTag(selected.risk_level)" size="small">{{ riskLabel(selected.risk_level) }}</el-tag>
              <span>OEE 30天：{{ selected.oee_30d == null ? '-' : selected.oee_30d + '%' }}</span>
              <span>异常：{{ selected.exception_count }}</span><span>缺料：{{ selected.risk_breakdown?.shortage_count || 0 }}</span><span>跟催：{{ selected.risk_breakdown?.purchase_followup_count || 0 }}</span><span>延期跟催：{{ selected.risk_breakdown?.purchase_followup_overdue || 0 }}</span><span>NCR：{{ selected.risk_breakdown?.ncr_count || 0 }}</span><span>成本偏差：{{ selected.risk_breakdown?.cost_variance_pct || 0 }}%</span>
            </div>

            <el-divider />
            <div class="section-title">交付闭环</div>
            <div class="stage-list">
              <div v-for="s in selected.stages" :key="s.label" class="stage-item" @click="go(s.path)">
                <div class="stage-head">
                  <span>{{ s.label }}</span>
                  <span>{{ s.done }}/{{ s.total }}</span>
                </div>
                <el-progress :percentage="s.percent" :stroke-width="7" :status="s.status === 'done' ? 'success' : undefined" />
              </div>
            </div>

            <el-divider />
            <div class="section-title">核心指标</div>
            <el-descriptions :column="2" border size="small">
              <el-descriptions-item label="工单">{{ selected.metrics.work_orders.done }}/{{ selected.metrics.work_orders.total }}</el-descriptions-item>
              <el-descriptions-item label="工序">{{ selected.metrics.process_nodes.done }}/{{ selected.metrics.process_nodes.total }}</el-descriptions-item>
              <el-descriptions-item label="图纸">{{ selected.metrics.documents.issued }}/{{ selected.metrics.documents.total }}</el-descriptions-item>
              <el-descriptions-item label="质检">{{ selected.metrics.quality.pass }}/{{ selected.metrics.quality.total }}</el-descriptions-item>
            </el-descriptions>

            <el-divider />
            <div class="section-title">优先处理</div>
            <el-empty v-if="!selected.top_exceptions.length" description="暂无异常" :image-size="48" />
            <div v-for="item in selected.top_exceptions" :key="item.id" class="exception-line" @click="go(item.source_path)">
              <el-tag :type="severityTag(item.severity)" size="small">{{ severityLabel(item.severity) }}</el-tag>
              <span class="exception-title">{{ item.title }}</span>
            </div>
          </template>
          <el-empty v-else description="选择左侧项目查看交付闭环" />
        </el-card>
      </el-col>
    </el-row>


    <el-drawer v-model="stageDrawerVisible" size="520px" :title="stageData?.stage ? `${stageData.project.instance_code} · ${stageData.stage.label}` : '阶段详情'">
      <template v-if="stageData?.stage">
        <el-descriptions :column="1" border size="small" class="stage-desc">
          <el-descriptions-item label="当前状态">
            <el-tag :type="statusTag(stageData.stage.status)" size="small">{{ statusLabel(stageData.stage.status) }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="完成度">{{ stageData.stage.done }}/{{ stageData.stage.total }} · {{ stageData.stage.percent }}%</el-descriptions-item>
          <el-descriptions-item label="责任角色">{{ stageData.stage.owner_role }}</el-descriptions-item>
          <el-descriptions-item label="处理入口">{{ stageData.stage.action_label }}</el-descriptions-item>
        </el-descriptions>

        <el-divider />
        <div class="section-title">业务堵点</div>
        <el-empty v-if="!stageData.stage.blockers?.length" description="这个阶段暂无堵点" :image-size="60" />
        <div v-for="b in stageData.stage.blockers" :key="`${b.type}-${b.title}`" class="blocker-line">
          <el-tag :type="severityTag(b.severity)" size="small">{{ severityLabel(b.severity) }}</el-tag>
          <div class="blocker-body">
            <div class="blocker-title">{{ b.title }}</div>
            <div class="blocker-message">{{ b.message }}</div>
          </div>
        </div>

        <div class="stage-actions">
          <el-button type="primary" @click="go(stageData.stage.path)">{{ stageData.stage.action_label || '去处理' }}</el-button>
          <el-button @click="openRiskDrawer(stageData.project)">查看项目风险</el-button>
        </div>
      </template>
    </el-drawer>

    <el-drawer v-model="riskDrawerVisible" size="62%" :title="riskData?.project?.instance_code ? `${riskData.project.instance_code} 风险钻取` : '风险钻取'">
      <template v-if="riskData">
        <el-row :gutter="12" class="risk-kpis">
          <el-col v-for="m in riskData.milestones" :key="m.key" :span="6">
            <el-card shadow="never">
              <div class="stat-label">{{ m.label }}</div>
              <div class="stat-value" :class="{ danger: m.level === 'critical' || m.level === 'high', warning: m.level === 'warning' }">{{ m.value }}{{ m.suffix || '' }}</div>
            </el-card>
          </el-col>
        </el-row>

        <el-tabs v-model="riskTab">
          <el-tab-pane label="异常中心" name="exceptions">
            <el-table :data="riskData.exceptions" size="small" height="360" empty-text="暂无异常">
              <el-table-column label="级别" width="80"><template #default="{ row }"><el-tag :type="severityTag(row.severity)" size="small">{{ severityLabel(row.severity) }}</el-tag></template></el-table-column>
              <el-table-column prop="title" label="异常" min-width="180" show-overflow-tooltip />
              <el-table-column prop="message" label="说明" min-width="260" show-overflow-tooltip />
              <el-table-column label="状态" width="90"><template #default="{ row }">{{ row.case_status || 'open' }}</template></el-table-column>
              <el-table-column label="操作" width="90"><template #default="{ row }"><el-button link size="small" @click="go(row.source_path)">处理</el-button></template></el-table-column>
            </el-table>
          </el-tab-pane>
          <el-tab-pane label="缺料" name="shortages">
            <el-table :data="riskData.shortages" size="small" height="360" empty-text="暂无缺料">
              <el-table-column prop="material_code" label="物料编码" width="140" />
              <el-table-column prop="material_name" label="物料名称" min-width="180" show-overflow-tooltip />
              <el-table-column prop="wo_code" label="工单" width="160" />
              <el-table-column prop="shortage_qty" label="缺口" width="90" />
              <el-table-column prop="expected_date" label="预计到货" width="110" />
              <el-table-column prop="owner_name" label="责任人" width="100" />
            </el-table>
          </el-tab-pane>
          <el-tab-pane label="采购跟催" name="followups">
            <el-table :data="riskData.purchase_followups" size="small" height="360" empty-text="暂无采购跟催">
              <el-table-column prop="po_no" label="编号" width="150" />
              <el-table-column label="来源" width="120">
                <template #default="{ row }">
                  <el-tag :type="row.source_type === 'shortage' ? 'warning' : 'info'" size="small">{{ row.source_type === 'shortage' ? 'BOM风险催办' : '采购订单' }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="item_name" label="物料/事项" min-width="180" show-overflow-tooltip />
              <el-table-column prop="planned_delivery" label="计划到货" width="110" />
              <el-table-column label="延期" width="80">
                <template #default="{ row }">
                  <el-tag :type="Number(row.delay_days || 0) > 0 ? 'danger' : 'success'" size="small">{{ Number(row.delay_days || 0) }}天</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="owner_name" label="责任人" width="100" />
              <el-table-column label="状态" width="90">
                <template #default="{ row }">
                  <el-tag :type="row.tracking_status === 'following' ? 'warning' : row.tracking_status === 'pending' ? 'info' : 'success'" size="small">{{ row.tracking_status || '-' }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="90">
                <template #default="{ row }"><el-button link size="small" @click="go(row.source_path)">跟催</el-button></template>
              </el-table-column>
            </el-table>
          </el-tab-pane>
          <el-tab-pane label="NCR" name="ncr">
            <el-table :data="riskData.ncrs" size="small" height="360" empty-text="暂无NCR">
              <el-table-column prop="ncr_code" label="NCR" width="150" />
              <el-table-column prop="part_name" label="部件" width="140" />
              <el-table-column prop="defect_desc" label="缺陷" min-width="220" show-overflow-tooltip />
              <el-table-column prop="severity" label="级别" width="80" />
              <el-table-column prop="disposition" label="处置" width="100" />
              <el-table-column prop="open_capa_count" label="未完CAPA" width="100" />
              <el-table-column prop="pass_recheck_count" label="通过复检" width="100" />
            </el-table>
          </el-tab-pane>
          <el-tab-pane label="成本偏差" name="cost">
            <el-descriptions :column="2" border size="small" style="margin-bottom:12px">
              <el-descriptions-item label="合同预算">{{ money(riskData.cost.budget_amount) }}</el-descriptions-item>
              <el-descriptions-item label="按进度预算">{{ money(riskData.cost.earned_budget) }}</el-descriptions-item>
              <el-descriptions-item label="实际归集">{{ money(riskData.cost.actual_amount) }}</el-descriptions-item>
              <el-descriptions-item label="偏差">{{ money(riskData.cost.variance_amount) }} / {{ riskData.cost.variance_pct }}%</el-descriptions-item>
            </el-descriptions>
            <el-table :data="riskData.cost.by_account" size="small" height="280" empty-text="暂无成本归集">
              <el-table-column prop="gl_account_code" label="科目" width="100" />
              <el-table-column prop="source_type" label="来源" width="140" />
              <el-table-column prop="entry_count" label="笔数" width="80" />
              <el-table-column label="金额" min-width="120"><template #default="{ row }">{{ money(row.amount) }}</template></el-table-column>
            </el-table>
          </el-tab-pane>
        </el-tabs>

        <div class="quick-actions">
          <el-button v-for="a in riskData.summary.quick_actions" :key="a.type" size="small" type="primary" plain @click="go(a.path)">{{ a.label }} ({{ a.count }})</el-button>
        </div>
      </template>
      <el-skeleton v-else :rows="8" animated />
    </el-drawer>

    <el-drawer v-model="lineageDrawerVisible" size="70%" :title="lineageData?.project?.instance_code ? `${lineageData.project.instance_code} 主线数据体检` : '主线数据体检'">
      <template v-if="lineageData">
        <el-row :gutter="12" class="lineage-kpis">
          <el-col :span="6">
            <el-card shadow="never">
              <div class="stat-label">主线健康分</div>
              <div class="stat-value" :class="{ danger: lineageData.level === 'critical' || lineageData.level === 'high', warning: lineageData.level === 'warning' }">{{ lineageData.score }}</div>
            </el-card>
          </el-col>
          <el-col :span="6">
            <el-card shadow="never">
              <div class="stat-label">缺口总数</div>
              <div class="stat-value warning">{{ lineageData.summary?.gap_count || 0 }}</div>
            </el-card>
          </el-col>
          <el-col :span="6">
            <el-card shadow="never">
              <div class="stat-label">高危缺口</div>
              <div class="stat-value danger">{{ lineageData.summary?.severe_gap_count || 0 }}</div>
            </el-card>
          </el-col>
          <el-col :span="6">
            <el-card shadow="never">
              <div class="stat-label">主线关键字段</div>
              <div class="lineage-keys">{{ lineageData.link_keys?.join(' / ') }}</div>
            </el-card>
          </el-col>
        </el-row>

        <el-alert
          class="lineage-alert"
          type="info"
          :closable="false"
          show-icon
          title="主线体检用于确认一台 TBM 的合同、BOM、图纸、采购、齐套、工单、报工、质检、成本、批次和验收是否能串成完整数据链。"
        />

        <el-tabs v-model="lineageTab">
          <el-tab-pane label="链路阶段" name="segments">
            <el-table :data="lineageData.segments || []" size="small" height="380">
              <el-table-column prop="label" label="阶段" width="120" />
              <el-table-column label="状态" width="90">
                <template #default="{ row }">
                  <el-tag :type="lineageStatusTag(row.status)" size="small">{{ lineageStatusLabel(row.status) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="完整度" width="190">
                <template #default="{ row }">
                  <el-progress :percentage="row.percent || 0" :stroke-width="8" />
                </template>
              </el-table-column>
              <el-table-column prop="linked" label="已关联" width="90" />
              <el-table-column prop="total" label="总量" width="90" />
              <el-table-column prop="gap_count" label="缺口" width="90" />
              <el-table-column prop="owner_role" label="责任角色" width="130" />
              <el-table-column label="处理入口" width="160">
                <template #default="{ row }">
                  <div class="fix-entry">
                    <el-tag size="small" type="info">{{ fixEntry(row).module || '业务模块' }}</el-tag>
                    <span>{{ fixEntry(row).label || '进入处理' }}</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="110">
                <template #default="{ row }">
                  <el-button link type="primary" size="small" @click="openFixEntry(row)">一键处理</el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>
          <el-tab-pane label="数据缺口" name="gaps">
            <el-table :data="lineageData.gaps || []" size="small" height="420" empty-text="主线数据链暂无明显缺口">
              <el-table-column label="级别" width="80">
                <template #default="{ row }">
                  <el-tag :type="severityTag(row.severity)" size="small">{{ severityLabel(row.severity) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="title" label="缺口" min-width="180" show-overflow-tooltip />
              <el-table-column prop="message" label="影响说明" min-width="320" show-overflow-tooltip />
              <el-table-column prop="count" label="数量" width="80" />
              <el-table-column prop="owner_role" label="责任角色" width="120" />
              <el-table-column label="样例" min-width="160" show-overflow-tooltip>
                <template #default="{ row }">{{ (row.samples || []).join('，') || '-' }}</template>
              </el-table-column>
              <el-table-column label="修复入口" width="180">
                <template #default="{ row }">
                  <div class="fix-entry">
                    <el-tag size="small" type="info">{{ fixEntry(row).module || '业务模块' }}</el-tag>
                    <span>{{ fixEntry(row).label || '进入处理' }}</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="清单" width="80">
                <template #default="{ row }">
                  <el-popover placement="left" width="260" trigger="click">
                    <template #reference>
                      <el-button link size="small">查看</el-button>
                    </template>
                    <div class="fix-checklist-title">{{ row.title }}</div>
                    <ol class="fix-checklist">
                      <li v-for="item in fixEntry(row).checklist || []" :key="item">{{ item }}</li>
                    </ol>
                    <el-empty v-if="!(fixEntry(row).checklist || []).length" description="暂无处理清单" :image-size="42" />
                  </el-popover>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="110">
                <template #default="{ row }">
                  <el-button link type="primary" size="small" @click="openFixEntry(row)">一键处理</el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>
        </el-tabs>
      </template>
      <el-skeleton v-else :rows="8" animated />
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { Api } from '../api'

const router = useRouter()
const loading = ref(false)
const loadError = ref('')
const summary = reactive<any>({})
const projects = ref<any[]>([])
const selected = ref<any | null>(null)
const riskDrawerVisible = ref(false)
const riskData = ref<any | null>(null)
const riskTab = ref('exceptions')
const riskFilter = ref('all')
const stageDrawerVisible = ref(false)
const stageData = ref<any | null>(null)
const lineageDrawerVisible = ref(false)
const lineageData = ref<any | null>(null)
const lineageTab = ref('segments')
const workflowKeys = ['contract', 'bom', 'documents', 'process', 'purchase', 'kit', 'work_orders', 'report', 'quality', 'cost', 'acceptance']
const riskOptions = [
  { label: '全部', value: 'all' },
  { label: '严重', value: 'critical' },
  { label: '高风险', value: 'high' },
  { label: '预警', value: 'warning' },
  { label: '正常', value: 'normal' }
]

const filteredProjects = computed(() => riskFilter.value === 'all'
  ? projects.value
  : projects.value.filter((p) => p.risk_level === riskFilter.value))


function workflowLabel(key: string) {
  return ({ contract: '合同', bom: 'BOM', documents: '图纸', process: '工艺', purchase: '采购', kit: '齐套', work_orders: '工单', report: '报工', quality: '质检', cost: '成本', acceptance: '验收' } as any)[key] || key
}

function stageByKey(project: any, key: string) {
  return (project.stages || []).find((s: any) => s.key === key) || { key, label: workflowLabel(key), done: 0, total: 0, percent: 0, status: 'empty', owner_role: '-', action_label: '查看', path: '', blockers: [], blocker_count: 0 }
}

function statusTag(status: string) {
  return status === 'blocked' ? 'danger' : status === 'warning' ? 'warning' : status === 'done' ? 'success' : status === 'running' ? 'primary' : 'info'
}

function statusLabel(status: string) {
  return ({ blocked: '阻塞', warning: '预警', done: '完成', running: '进行中', pending: '待开始', empty: '未建' } as any)[status] || status || '-'
}

function lineageStatusTag(status: string) {
  return status === 'blocked' ? 'danger' : status === 'warning' ? 'warning' : status === 'ok' ? 'success' : 'info'
}

function lineageStatusLabel(status: string) {
  return ({ blocked: '阻塞', warning: '待完善', ok: '完整', empty: '未建' } as any)[status] || status || '-'
}

function openStage(project: any, stage: any) {
  selected.value = project
  stageData.value = { project, stage }
  stageDrawerVisible.value = true
}

function riskTag(level: string) {
  return level === 'critical' ? 'danger' : level === 'high' ? 'danger' : level === 'warning' ? 'warning' : 'success'
}

function riskLabel(level: string) {
  return ({ critical: '严重', high: '高风险', warning: '预警', normal: '正常' } as any)[level] || level || '-'
}

function severityTag(severity: string) {
  return severity === 'critical' || severity === 'high' ? 'danger' : severity === 'warning' ? 'warning' : 'info'
}

function severityLabel(severity: string) {
  return ({ critical: '严重', high: '高', warning: '中', info: '低' } as any)[severity] || severity
}

function selectProject(row: any) {
  selected.value = row
}

function applyFilter() {
  selected.value = filteredProjects.value[0] || null
}

function go(path?: string) {
  if (!path) return
  router.push(path)
}

function fixEntry(row: any) {
  return row?.fix_entry || {
    module: row?.owner_role || '业务模块',
    label: row?.action_label || '进入处理',
    path: row?.action_path || row?.path,
    checklist: []
  }
}

function openFixEntry(row: any) {
  const entry = fixEntry(row)
  const path = entry?.path || row?.action_path || row?.path
  if (!path) {
    ElMessage.warning('这个缺口暂未配置处理入口')
    return
  }
  lineageDrawerVisible.value = false
  router.push(path)
}

function goDetail(row: any) {
  router.push(`/instances/${row.id}`)
}

function goExceptions(row: any) {
  router.push(`/exceptions?instance_id=${row.id}&from=delivery`)
}

function money(value: any) {
  const n = Number(value || 0)
  return n.toLocaleString('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 0 })
}

async function openRiskDrawer(row: any) {
  riskDrawerVisible.value = true
  riskData.value = null
  riskTab.value = 'exceptions'
  try {
    riskData.value = await Api.deliveryProjectRisks(row.id)
  } catch (e: any) {
    ElMessage.error('加载风险数据失败: ' + (e?.message || e))
    riskDrawerVisible.value = false
  }
}

async function openLineageDrawer(row: any) {
  lineageDrawerVisible.value = true
  lineageData.value = null
  lineageTab.value = 'segments'
  try {
    lineageData.value = await Api.deliveryProjectLineage(row.id)
  } catch (e: any) {
    ElMessage.error('加载主线体检失败: ' + (e?.message || e))
    lineageDrawerVisible.value = false
  }
}

async function loadAll() {
  loading.value = true
  loadError.value = ''
  try {
    const data: any = await Api.deliveryOverview()
    Object.assign(summary, data.summary || {})
    projects.value = data.projects || []
    selected.value = filteredProjects.value[0] || projects.value[0] || null
  } catch (e: any) {
    loadError.value = e?.message || String(e || '加载失败')
    ElMessage.error('加载项目交付看板失败: ' + loadError.value)
  } finally {
    loading.value = false
  }
}

onMounted(loadAll)
</script>

<style scoped>
.page-subtitle { color: var(--el-text-color-secondary); font-size: 13px; margin-top: 4px; }
.kpi-row { margin-bottom: 16px; }
.load-alert { margin-bottom: 16px; }
.kpi-card { min-height: 104px; }
.stat-label { color: var(--el-text-color-secondary); font-size: 13px; }
.stat-value { font-size: 30px; font-weight: 700; margin-top: 10px; }
.stat-value.danger { color: var(--el-color-danger); }
.stat-value.warning { color: var(--el-color-warning); }
.stat-sub { color: var(--el-text-color-secondary); font-size: 12px; margin-top: 6px; }
.card-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.detail-card { min-height: 680px; }
.project-title { font-size: 16px; font-weight: 600; margin-bottom: 8px; }
.project-meta { display: flex; gap: 10px; align-items: center; color: var(--el-text-color-secondary); font-size: 13px; flex-wrap: wrap; }
.section-title { font-size: 13px; font-weight: 600; margin-bottom: 10px; color: var(--el-text-color-primary); }
.stage-list { display: grid; gap: 12px; }
.stage-item { cursor: pointer; padding: 10px; border: 1px solid var(--el-border-color-lighter); border-radius: 6px; }
.stage-item:hover { border-color: var(--el-color-primary-light-5); background: var(--el-fill-color-light); }
.stage-head { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px; }
.exception-line { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--el-border-color-lighter); cursor: pointer; }
.exception-line:hover .exception-title { color: var(--el-color-primary); }
.exception-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.risk-kpis { margin-bottom: 12px; }
.lineage-kpis { margin-bottom: 12px; }
.lineage-alert { margin-bottom: 12px; }
.lineage-keys { margin-top: 10px; color: var(--el-text-color-regular); font-size: 13px; line-height: 1.5; }
.fix-entry { display: flex; align-items: center; gap: 6px; min-width: 0; }
.fix-entry span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fix-checklist-title { font-weight: 600; margin-bottom: 8px; color: var(--el-text-color-primary); }
.fix-checklist { margin: 0; padding-left: 18px; color: var(--el-text-color-regular); line-height: 1.8; }
.quick-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; }

.workflow-card { margin-bottom: 16px; }
.workflow-hint { color: var(--el-text-color-secondary); font-size: 12px; font-weight: 400; }
.workflow-scroll { overflow-x: auto; padding-bottom: 2px; }
.workflow-table { width: max-content; min-width: 100%; border-collapse: separate; border-spacing: 8px; }
.workflow-table th { color: var(--el-text-color-secondary); font-size: 12px; font-weight: 600; text-align: left; padding: 0 4px 4px; white-space: nowrap; }
.workflow-table td { vertical-align: top; }
.project-col { width: 180px; min-width: 180px; position: sticky; left: 0; z-index: 2; background: var(--el-bg-color); }
.wf-project-code { font-weight: 700; font-size: 13px; }
.wf-project-name { color: var(--el-text-color-secondary); font-size: 12px; margin-top: 4px; max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.flow-cell { width: 116px; min-height: 78px; border: 1px solid var(--el-border-color-lighter); border-radius: 10px; padding: 9px; cursor: pointer; background: var(--el-fill-color-blank); transition: all .15s ease; }
.flow-cell:hover { transform: translateY(-1px); box-shadow: var(--el-box-shadow-light); }
.flow-cell-head { display: flex; justify-content: space-between; align-items: center; font-size: 13px; font-weight: 700; }
.flow-cell-status { margin-top: 8px; font-size: 12px; }
.flow-cell-owner { margin-top: 6px; color: var(--el-text-color-secondary); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.flow-done { border-color: var(--el-color-success-light-5); background: var(--el-color-success-light-9); }
.flow-running { border-color: var(--el-color-primary-light-5); background: var(--el-color-primary-light-9); }
.flow-warning { border-color: var(--el-color-warning-light-5); background: var(--el-color-warning-light-9); }
.flow-blocked { border-color: var(--el-color-danger-light-5); background: var(--el-color-danger-light-9); }
.flow-pending, .flow-empty { background: var(--el-fill-color-light); }
.stage-desc { margin-top: 4px; }
.blocker-line { display: flex; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--el-border-color-lighter); }
.blocker-body { flex: 1; min-width: 0; }
.blocker-title { font-weight: 600; font-size: 13px; }
.blocker-message { color: var(--el-text-color-secondary); font-size: 12px; margin-top: 4px; line-height: 1.5; }
.stage-actions { margin-top: 18px; display: flex; gap: 8px; }
</style>
