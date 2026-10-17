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
import EquipmentInstanceCreateDialog from './equipment/EquipmentInstanceCreateDialog.vue'
import { useProjectLaunchWizardPage } from '../composables/useProjectLaunchWizardPage'

const {
  loading,
  showCreate,
  actionLoading,
  selectedInstanceId,
  instances,
  types,
  dashboard,
  docsCount,
  loadErrors,
  selectedInstance,
  processTotal,
  workOrderTotal,
  statusText,
  statusTag,
  progressColor,
  flowSteps,
  readinessPct,
  refreshAll,
  handleInstanceChange,
  handleCreated,
  runAction,
  go } = useProjectLaunchWizardPage()
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
