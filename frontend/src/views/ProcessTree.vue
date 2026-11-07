<template>
  <div class="page">
    <section class="process-hero">
      <div class="hero-copy">
        <div class="eyebrow">PROCESS ROUTE</div>
        <h1>工艺树</h1>
        <p>围绕每台 TBM 建立工序路线、标准工时、工位/岗位、依赖关系与执行状态，服务排程、报工、质检和成本归集。</p>
        <div class="hero-tags">
          <el-tag effect="plain">实例 {{ selectedInstanceMeta?.instance_code || '未选择' }}</el-tag>
          <el-tag effect="plain" type="success">完成率 {{ progress.progress_pct || 0 }}%</el-tag>
          <el-tag effect="plain" type="warning">路线完整率 {{ routeCompletenessPct }}%</el-tag>
          <el-tag v-if="(progress.by_status?.blocked || 0) > 0" effect="plain" type="danger">卡住 {{ progress.by_status?.blocked || 0 }}</el-tag>
        </div>
      </div>
      <div class="hero-actions">
        <el-select v-model="selectedInstance" placeholder="选择项目装备" filterable class="instance-select" @change="reloadAll">
          <el-option v-for="i in instances" :key="i.id" :label="i.instance_code + ' | ' + (i.instance_name || '')" :value="i.id" />
        </el-select>
        <div class="action-row">
          <el-button :icon="Refresh" @click="reloadAll" :loading="loading">刷新</el-button>
          <el-button type="warning" :icon="MagicStick" @click="regenerate" :loading="regenerating">从 BOM 生成</el-button>
          <el-button type="primary" :icon="Plus" @click="onAddRoot" :disabled="!selectedInstance">新增节点</el-button>
        </div>
      </div>
    </section>

    <el-card v-if="!selectedInstance" class="empty-state-card">
      <PageState state="empty" :show-action="false" description="请选择项目装备后查看工艺树">
        <template #actions>
          <el-button type="primary" @click="selectedInstance = instances[0]?.id; selectedInstance && reloadAll()">选择第一台装备</el-button>
        </template>
      </PageState>
    </el-card>

    <div v-else v-loading="loading" class="process-tree-workspace">
      <!-- 总览统计 -->
      <ProcessTreeStats :progress="progress" :cpm="cpm" />

      <ProcessTreeRouteCompleteness
        v-model:route-gap-filter="routeGapFilter"
        :route-completeness-pct="routeCompletenessPct"
        :component-route-summary="componentRouteSummary"
        :route-fixing="routeFixing"
        :auto-binding="autoBinding"
        :has-route-gaps="hasRouteGaps"
        :filtered-component-routes="filteredComponentRoutes"
        @generate-missing-routes="generateMissingRoutes"
        @auto-bind-routes="autoBindRoutes"
        @load-component-routes="loadComponentRoutes"
        @focus-process-node="focusProcessNode"
        @focus-component-route="focusComponentRoute"
      />

      <!-- 子系统分布 -->
      <el-card v-if="subsystems.length > 0" class="overview-card" style="margin-bottom: 16px">
        <div style="font-weight: 600; margin-bottom: 8px">子系统分布</div>
        <div class="subsystem-bars">
          <div v-for="s in subsystems" :key="s.id" class="sub-bar" role="button" tabindex="0" @click="scrollToCard(s.id)" @keydown.enter.prevent="scrollToCard(s.id)" @keydown.space.prevent="scrollToCard(s.id)">
            <div class="sub-bar-color" :style="{ background: s.color }"></div>
            <span class="sub-bar-name">{{ s.name_zh }}</span>
            <span class="sub-bar-count">{{ s.completed }}/{{ s.total }}</span>
            <el-progress :percentage="s.progress_pct" :show-text="false" :stroke-width="4" :color="s.color" style="flex: 1; margin: 0 8px" />
            <span class="sub-bar-pct">{{ s.progress_pct }}%</span>
          </div>
        </div>
      </el-card>

      <!-- 跨子系统依赖矩阵 (可折叠) -->
      <ProcessTreeCrossSubsystemMatrix
        v-if="selectedInstance"
        :instance-id="selectedInstance"
      />

      <!-- 工艺树思维导图 (可折叠，默认展开) -->
      <ProcessTreeMindmap
        v-if="selectedInstance"
        :instance-id="selectedInstance"
        @navigate="onMindmapNavigate"
      />

      <!-- 筛选 / 搜索 -->
      <ProcessTreeLegend
        v-model:search-key="filters.searchKey"
        v-model:workstation-id="filters.workstationId"
        v-model:only-critical="filters.onlyCritical"
        v-model:only-mine="filters.onlyMine"
        :workstations="workstations"
        :current-user-id="currentUserId"
        :all-expanded="allExpanded"
        @expand-toggle="toggleExpandAll"
      />

      <!-- 总装根节点（uncategorized） -->
      <ProcessTreeSubsystemCard
        v-for="u in uncategorized"
        :key="'uncategorized-' + (u.name_zh || u.name_en || 'node')"
        :ref="'card_uncategorized'"
        :subsystem="{ id: null, name_zh: u.name_zh, name_en: '', sequence: 0, color: 'var(--el-color-info)', nodes: u.nodes, ...u }"
        :critical-set="criticalSet"
        :search-key="filters.searchKey"
        :only-critical="filters.onlyCritical"
        :only-mine="filters.onlyMine"
        :workstation-id="filters.workstationId"
        :current-user-id="currentUserId"
        :force-collapsed="!allExpanded"
        @start="onStart" @complete="onComplete" @cmd="onCmd"
        @node-dropped="onNodeDropped"
      />

      <!-- 按 subsystem 分组的卡片 -->
      <ProcessTreeSubsystemCard
        v-for="s in subsystems"
        :key="s.id"
        :ref="'card_' + s.id"
        :subsystem="s"
        :critical-set="criticalSet"
        :search-key="filters.searchKey"
        :only-critical="filters.onlyCritical"
        :only-mine="filters.onlyMine"
        :workstation-id="filters.workstationId"
        :current-user-id="currentUserId"
        :force-collapsed="!allExpanded"
        @start="onStart" @complete="onComplete" @cmd="onCmd"
        @node-dropped="onNodeDropped"
      />

      <el-card v-if="!loading && subsystems.length === 0 && uncategorized.length === 0" class="empty-state-card">
        <PageState state="empty" :show-action="false" description="当前装备还没有工艺节点">
          <template #actions>
            <el-button type="warning" :icon="MagicStick" @click="regenerate">从 BOM 生成工艺树</el-button>
          </template>
        </PageState>
      </el-card>
    </div>

    <ProcessTreeDialogs
      v-model:show-edit="showEdit"
      v-model:show-assign="showAssign"
      v-model:show-dep="showDep"
      v-model:edit-form="editForm"
      v-model:assign-form="assignForm"
      v-model:dep-form="depForm"
      :workstations="workstations"
      :users="users"
      :flat="flat"
      :subsystems-list="subsystemsList"
      :operation-templates="operationTemplates"
      :saving="saving"
      :show-hours="showHours"
      v-model:hours-form="hoursForm"
      :hours-saving="hoursSaving"
      @save-node="saveNode"
      @save-assign="saveAssign"
      @save-dep="saveDep"
      @save-hours="saveHours"
    />
  </div>
</template>

<script setup lang="ts">
import { Refresh, Plus, MagicStick } from '@element-plus/icons-vue'
import { useProcessTreePage } from '../composables/useProcessTreePage.js'
import ProcessTreeStats from '../components/ProcessTreeStats.vue'
import ProcessTreeRouteCompleteness from '../components/ProcessTreeRouteCompleteness.vue'
import ProcessTreeLegend from '../components/ProcessTreeLegend.vue'
import ProcessTreeSubsystemCard from '../components/ProcessTreeSubsystemCard.vue'
import ProcessTreeDialogs from '../components/ProcessTreeDialogs.vue'
import ProcessTreeCrossSubsystemMatrix from '../components/ProcessTreeCrossSubsystemMatrix.vue'
import ProcessTreeMindmap from '../components/ProcessTreeMindmap.vue'

const {
  allExpanded,
  assignForm,
  autoBindRoutes,
  autoBinding,
  componentRouteSummary,
  cpm,
  criticalSet,
  currentUserId,
  depForm,
  editForm,
  filteredComponentRoutes,
  filters,
  flat,
  focusComponentRoute,
  focusProcessNode,
  generateMissingRoutes,
  hasRouteGaps,
  hoursForm,
  hoursSaving,
  instances,
  loadComponentRoutes,
  loading,
  onAddRoot,
  onCmd,
  onComplete,
  onMindmapNavigate,
  onNodeDropped,
  onStart,
  operationTemplates,
  progress,
  regenerate,
  regenerating,
  reloadAll,
  routeCompletenessPct,
  routeFixing,
  routeGapFilter,
  saveAssign,
  saveDep,
  saveHours,
  saveNode,
  saving,
  scrollToCard,
  selectedInstance,
  selectedInstanceMeta,
  showAssign,
  showDep,
  showEdit,
  showHours,
  subsystems,
  subsystemsList,
  toggleExpandAll,
  uncategorized,
  users,
  workstations,
} = useProcessTreePage()

</script>

<style scoped>
.page {
  width: 100%;
  max-width: none;
  min-height: calc(100vh - 56px);
  margin: 0;
  padding: clamp(12px, 1.4vw, var(--space-lg));
  box-sizing: border-box;
}
.process-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(340px, 430px);
  justify-content: space-between;
  gap: var(--space-lg);
  align-items: stretch;
  padding: var(--space-lg);
  margin-bottom: var(--space-lg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  background:
    radial-gradient(circle at 8% 0%, rgba(47, 95, 143, 0.10), transparent 34%),
    linear-gradient(135deg, var(--color-surface) 0%, var(--color-surface-muted) 100%);
  box-shadow: var(--shadow-sm);
}
.hero-copy { max-width: none; min-width: 0; }
.eyebrow {
  color: var(--color-primary);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
}
.hero-copy h1 {
  margin: 4px 0 6px;
  color: var(--color-text);
  font-size: 26px;
  line-height: 1.25;
}
.hero-copy p {
  color: var(--color-text-secondary);
  max-width: 980px;
}
.hero-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
  margin-top: var(--space-md);
}
.hero-actions {
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--space-md);
}
.instance-select { width: 100%; }
.action-row {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: var(--space-sm);
}
.process-tree-workspace {
  width: 100%;
  min-width: 0;
}

.overview-card {
  margin-bottom: var(--space-md);
  border-color: var(--color-border);
  box-shadow: var(--shadow-xs);
}
.empty-state-card {
  margin: var(--space-lg) 0;
  border: 1px dashed var(--color-border);
  background: var(--color-surface-raised);
}
.subsystem-bars {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}
.sub-bar {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  cursor: pointer;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  transition: background var(--transition-fast), color var(--transition-fast);
}
.sub-bar:hover { background: var(--color-surface-soft); }
.sub-bar-color { width: 4px; height: 20px; border-radius: 2px; }
.sub-bar-name {
  color: var(--color-text);
  font-size: 13px;
  min-width: 86px;
}
.sub-bar-count {
  color: var(--color-text-secondary);
  font-size: 12px;
  min-width: 56px;
  text-align: right;
}
.sub-bar-pct {
  color: var(--color-text-secondary);
  font-size: 12px;
  min-width: 38px;
}
:deep(.focus-flash) {
  outline: 2px solid var(--color-primary);
  outline-offset: 3px;
  box-shadow: 0 0 0 6px rgba(47, 95, 143, 0.10);
}
:deep(.node-flash) {
  background: var(--color-primary-soft) !important;
  box-shadow: inset 0 0 0 1px var(--color-primary);
}
@media (max-width: 1024px) {
  .process-hero {
    grid-template-columns: 1fr;
  }
  .hero-actions {
    width: 100%;
    min-width: 0;
  }
}
@media (max-width: 640px) {
  .page { padding: var(--space-md); }
  .process-hero { padding: var(--space-md); }
  .action-row { justify-content: stretch; }
  .action-row .el-button { flex: 1; }
}
</style>
