<template>
  <div class="page">
    <div class="page-header">
      <div>
        <span class="page-title"><el-icon><Share /></el-icon> 项目结构 / BOM 树</span>
        <el-tag size="small" type="info" style="margin-left: 12px">树状多级结构 · 节点类型 · ECO 追溯</el-tag>
      </div>
      <div>
        <el-select v-model="instanceId" placeholder="选择项目装备" filterable style="width: 280px; margin-right: 8px" @change="loadAll">
          <el-option v-for="i in instances" :key="i.id" :label="`${i.instance_code} · ${i.instance_name}`" :value="i.id" />
        </el-select>
        <el-button @click="loadAll" :disabled="!instanceId">刷新</el-button>
      </div>
    </div>

    <el-row :gutter="12" v-if="instanceId">
      <!-- 顶部 4 级统计卡 -->
      <el-col :span="6">
        <el-card class="level-card" :class="{ active: activeLevel === 0 }" @click="setLevel(0)" shadow="hover">
          <div class="level-num" style="color: var(--el-color-danger)">{{ summary[0] || 0 }}</div>
          <div class="level-label">0 级 · 项目装备</div>
          <div class="level-tip">整台 TBM / 盾构机 (1 个根)</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="level-card" :class="{ active: activeLevel === 1 }" @click="setLevel(1)" shadow="hover">
          <div class="level-num" style="color: var(--el-color-warning)">{{ summary[1] || 0 }}</div>
          <div class="level-label">1 级 · 主要部件</div>
          <div class="level-tip">刀盘、主驱动、盾体等</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="level-card" :class="{ active: activeLevel === 2 }" @click="setLevel(2)" shadow="hover">
          <div class="level-num" style="color: var(--el-color-primary)">{{ summary[2] || 0 }}</div>
          <div class="level-label">2 级 · 子部件/组件</div>
          <div class="level-tip">组件、装配体、功能单元</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="level-card" :class="{ active: activeLevel === 3 }" @click="setLevel(3)" shadow="hover">
          <div class="level-num" style="color: var(--el-color-success)">{{ summary[3] || 0 }}</div>
          <div class="level-label">3+ 级 · 基础件</div>
          <div class="level-tip">3级 {{ summary[3] || 0 }} · 深层 {{ summary.deep || 0 }}</div>
        </el-card>
      </el-col>
    </el-row>

    <el-tabs v-model="mainTab" v-if="instanceId" style="margin-top: 12px">
      <!-- Tab 1: 项目结构树 -->
      <el-tab-pane name="tree">
        <template #label>
          <span class="tab-label"><el-icon><Share /></el-icon>项目结构树</span>
        </template>
        <div style="display: flex; gap: 12px; margin-bottom: 8px">
          <el-button v-if="canEdit" size="small" type="primary" @click="prefillTier(0); dlgAdd = true; editingNode = null">+ 新增整机根节点</el-button>
          <el-button v-if="canEdit" size="small" type="primary" plain :disabled="!selected" @click="openAddChild(selected)">+ 新增子部件</el-button>
          <el-button v-if="canEdit" size="small" type="success" :disabled="summary.total > 0" @click="initMinimumBom"><el-icon><Histogram /></el-icon> 生成最低三级骨架</el-button>
          <el-button v-if="canEdit" size="small" @click="dlgImport = true"><el-icon><Download /></el-icon> CSV 导入</el-button>
          <el-button size="small" @click="loadTemplate"><el-icon><Document /></el-icon> 工业模板</el-button>
          <el-button size="small" type="warning" @click="doValidate"><el-icon><Search /></el-icon> 校验</el-button>
          <el-button size="small" type="success" @click="dlgCompare = true"><el-icon><Refresh /></el-icon> ECO 对比</el-button>
          <el-input aria-label="搜索层级号/零件/图号/物料名" v-model="treeFilter" placeholder="搜索层级号/零件/图号/物料名" size="small" style="width: 260px; margin-left: auto" clearable />
        </div>
        <el-alert
          v-if="minimumStructureMissing"
          type="warning"
          show-icon
          :closable="false"
          style="margin-bottom: 10px"
          title="项目结构最低合格要求：必须至少包含 0级项目装备、1级主要部件、2级子部件/零件。"
        />
        <el-row :gutter="12" style="margin-bottom: 12px">
          <el-col :span="6">
            <el-card shadow="hover">
              <div class="health-title">BOM 健康度</div>
              <div class="health-score" :style="{ color: health.score >= 85 ? 'var(--el-color-success)' : health.score >= 60 ? 'var(--el-color-warning)' : 'var(--el-color-danger)' }">{{ health.score || 0 }}</div>
              <div class="health-sub">建议先把 80 分以上再流转采购/工艺</div>
            </el-card>
          </el-col>
          <el-col :span="6">
            <el-card shadow="hover">
              <div class="health-title">校验问题</div>
              <div class="health-metric">{{ health.errors_count || 0 }} 错误 / {{ health.warnings_count || 0 }} 提醒</div>
              <div class="health-sub">结构、层级、一物一码、字段完整性</div>
            </el-card>
          </el-col>
          <el-col :span="6">
            <el-card shadow="hover">
              <div class="health-title">业务缺口</div>
              <div class="health-metric">缺单价 {{ health.checks?.missing_unit_price || 0 }} · 缺工艺 {{ health.checks?.missing_operation_route || 0 }}</div>
              <div class="health-sub">成本与工艺闭环的关键入口</div>
            </el-card>
          </el-col>
          <el-col :span="6">
            <el-card shadow="hover">
              <div class="health-title">治理提醒</div>
              <div class="health-metric">重复 {{ health.checks?.duplicate_material_nodes || 0 }} · 缺图纸 {{ health.checks?.nodes_without_documents || 0 }}</div>
              <div class="health-sub">{{ (health.highlights || []).join('；') || '暂无重点提醒' }}</div>
            </el-card>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="10">
            <el-card>
              <el-tree
                v-if="tree.length"
                :data="filteredTree"
                :props="{ label: 'label', children: 'children' }"
                node-key="id"
                default-expand-all
                draggable
                @node-click="onNodeClick"
                @node-drop="moveNode"
                style="max-height: 700px; overflow: auto"
              >
                <template #default="{ data }">
                  <span class="bom-tree-node">
                    <el-tag size="small" effect="plain">{{ data.level_code || '#' + data.id }}</el-tag>
                    <el-tag v-if="data.tier === 0" size="small" type="danger">整机</el-tag>
                    <el-tag v-else-if="data.tier === 1" size="small" type="warning">主要部件</el-tag>
                    <el-tag v-else-if="data.tier === 2" size="small" type="info">子部件</el-tag>
                    <el-tag v-else size="small">基础件</el-tag>
                    <el-tag v-if="data.node_type" size="small">{{ nodeTypeLabel(data.node_type) }}</el-tag>
                    <el-tag v-if="data.is_phantom" size="small">虚</el-tag>
                    <el-tag v-if="data.is_wear_part" size="small" type="warning">易损</el-tag>
                    <el-tag v-if="data.is_key_component" size="small" type="danger">关键</el-tag>
                    <span style="font-weight: 500">{{ data.material_name || data.part_number || '(未命名)' }}</span>
                    <span style="color: var(--el-color-info); font-size: 12px">×{{ data.quantity }}{{ data.unit }}</span>
                    <el-button size="small" type="primary" link @click.stop="openAddChild(data)">+子</el-button>
                  </span>
                </template>
              </el-tree>
              <el-empty v-else description="该项目装备暂无结构树/BOM 数据" />
            </el-card>
          </el-col>
          <el-col :span="14">
            <el-card style="margin-bottom: 12px">
              <template #header>
                <div style="display: flex; align-items: center; justify-content: space-between">
                  <span><el-icon><Money /></el-icon> 成本汇总 (MRP 自底向上)</span>
                  <el-tag :type="totalCost > 0 ? 'success' : 'info'" size="default">总成本: ¥{{ totalCost.toFixed(2) }}</el-tag>
                </div>
              </template>
              <el-table :data="costs" size="small" max-height="200" empty-text="该 BOM 无 unit_price, 成本全为 0">
                <el-table-column prop="id" label="ID" width="50" />
                <el-table-column label="物料" min-width="160">
                  <template #default="{ row }">{{ row.material_name || '(无)' }} <span style="color: var(--el-color-info); font-size: 11px">{{ row.material_code }}</span></template>
                </el-table-column>
                <el-table-column prop="is_phantom" label="虚项" width="50">
                  <template #default="{ row }"><template v-if="row.is_phantom"><el-icon><Select /></el-icon></template><template v-else></template></template>
                </el-table-column>
                <el-table-column prop="self" label="自身" width="80" :formatter="(r: any) => r.self.toFixed(2)" />
                <el-table-column prop="cost" label="累计" width="80" :formatter="(r: any) => r.cost.toFixed(2)" />
              </el-table>
            </el-card>
            <el-card v-if="selected">
              <template #header>
                <div style="display: flex; align-items: center; justify-content: space-between">
                  <span><el-icon><Search /></el-icon> 节点详情 #{{ selected.id }} ({{ tierLabel(selected.tier) }})</span>
                  <div>
                    <el-button v-if="canEdit" size="small" @click="openEdit">编辑</el-button>
                    <el-button v-if="canEdit" size="small" type="danger" @click="doDelete(selected)">删除</el-button>
                  </div>
                </div>
              </template>
              <el-descriptions :column="2" border size="small">
                <el-descriptions-item label="层级号">{{ selected.level_code || '-' }}</el-descriptions-item>
                <el-descriptions-item label="节点类型">{{ nodeTypeLabel(selected.node_type) }}</el-descriptions-item>
                <el-descriptions-item label="物料">{{ selected.material_name || '-' }} ({{ selected.material_code || '-' }})</el-descriptions-item>
                <el-descriptions-item label="图号/型号">{{ selected.part_number || '-' }}</el-descriptions-item>
                <el-descriptions-item label="数量">{{ selected.quantity }} {{ selected.unit }}</el-descriptions-item>
                <el-descriptions-item label="分类">{{ selected.category || '-' }}</el-descriptions-item>
                <el-descriptions-item label="材质">{{ selected.material_grade || '-' }}</el-descriptions-item>
                <el-descriptions-item label="表面处理">{{ selected.surface_treatment || '-' }}</el-descriptions-item>
                <el-descriptions-item label="品牌">{{ selected.brand_recommend || '-' }} ({{ selected.brand_grade || '-' }})</el-descriptions-item>
                <el-descriptions-item label="损耗">{{ selected.scrap_factor || 1.0 }}</el-descriptions-item>
                <el-descriptions-item label="单价/单重">{{ selected.unit_price || '-' }} 元 / {{ selected.weight || '-' }} kg</el-descriptions-item>
                <el-descriptions-item label="版本">{{ selected.version || '-' }}</el-descriptions-item>
                <el-descriptions-item label="关键/易损/虚项">
                  {{ selected.is_key_component ? '关键 ' : '' }}{{ selected.is_wear_part ? '易损 ' : '' }}{{ selected.is_phantom ? '虚项' : '' }}
                </el-descriptions-item>
                <el-descriptions-item label="替代">{{ selected.is_alternative ? `组 ${selected.alternative_group} 优先 ${selected.alternative_priority}` : '-' }}</el-descriptions-item>
                <el-descriptions-item label="存放位置">{{ selected.storage_location || '-' }}</el-descriptions-item>
                <el-descriptions-item label="ECO">{{ selected.eco_id ? '#' + selected.eco_id : '-' }}</el-descriptions-item>
                <el-descriptions-item label="生效期" :span="2">
                  {{ selected.effective_from || '-' }} → {{ selected.effective_to || '长期' }}
                </el-descriptions-item>
                <el-descriptions-item label="备注" :span="2">{{ selected.notes || '-' }}</el-descriptions-item>
              </el-descriptions>
            </el-card>
            <el-empty v-else description="点击左侧树节点查看详情" />
          </el-col>
        </el-row>
      </el-tab-pane>

      <!-- Tab 2: 0 总装 (1 个根) -->
      <el-tab-pane :label="`总装 (${summary[0] || 0})`" name="l0">
        <LevelTable :rows="rowsOfLevel(0)" :tier="0" :editable="canEdit" @select="onRowSelect" @add="dlgAdd = true; editingNode = null; prefillTier(0)" @delete="doDelete" />
      </el-tab-pane>

      <!-- Tab 3: 1 部件 (装配班组) -->
      <el-tab-pane :label="`部件 (${summary[1] || 0})`" name="l1">
        <LevelTable :rows="rowsOfLevel(1)" :tier="1" :editable="canEdit" @select="onRowSelect" @add="prefillTier(1); dlgAdd = true" @delete="doDelete" @drill="drillPart" />
        <el-card v-if="drillNode" style="margin-top: 12px">
          <template #header>
            <div style="display: flex; align-items: center; justify-content: space-between">
              <span><el-icon><Search /></el-icon> 部件 "{{ drillNode.material_name || drillNode.part_number }}" 下子件 ({{ drillChildren.length }} 项)</span>
              <el-button size="small" @click="drillNode = null">收起</el-button>
            </div>
          </template>
          <LevelTable :rows="drillChildren" :tier="2" :show-actions="false" />
        </el-card>
      </el-tab-pane>

      <!-- Tab 4: 2 零件 (采购/加工) -->
      <el-tab-pane :label="`零件 (${summary[2] || 0})`" name="l2">
        <LevelTable :rows="rowsOfLevel(2)" :tier="2" :editable="canEdit" @select="onRowSelect" @delete="doDelete" />
      </el-tab-pane>

      <!-- Tab 5: 3 毛坯 (生产下料) -->
      <el-tab-pane :label="`毛坯 (${summary[3] || 0})`" name="l3">
        <LevelTable :rows="rowsOfLevel(3)" :tier="3" :editable="canEdit" @select="onRowSelect" @delete="doDelete" />
      </el-tab-pane>

      <BomBusinessTabs
        :business-views="businessViews"
        :flat="flat"
        :bom-docs="bomDocs"
        v-model:doc-filter="docFilter"
        :doc-loading="docLoading"
        :doc-type-label="DOC_TYPE_LABEL"
        @load-docs="loadBomDocs"
        @download-doc="downloadBomDoc"
        @risk-drill="openRiskDrill"
      />
    </el-tabs>
    <el-empty v-else description="请先选择项目装备" />

    <BomDialogs
      v-model:dlg-add="dlgAdd"
      v-model:dlg-import="dlgImport"
      v-model:dlg-validate="dlgValidate"
      v-model:dlg-compare="dlgCompare"
      v-model:dlg-risk-drill="dlgRiskDrill"
      v-model:dlg-risk-action="dlgRiskAction"
      v-model:csv-text="csvText"
      v-model:compare-v1="compareV1"
      v-model:compare-v2="compareV2"
      :editing-node="editingNode"
      v-model:add-form="addForm"
      :all-nodes="allNodes"
      :materials="materials"
      :saving="saving"
      :template-columns="templateColumns"
      :importing="importing"
      :validate-result="validateResult"
      :comparing="comparing"
      :compare-result="compareResult"
      :selected-risk-component="selectedRiskComponent"
      :selected-risk-item="selectedRiskItem"
      :risk-action-mode="riskActionMode"
      v-model:risk-action-form="riskActionForm"
      :risk-owners="riskOwners"
      :risk-action-loading="riskActionLoading"
      @reset-add-form="resetAddForm"
      @parent-change="onParentChange"
      @node-type-change="onNodeTypeChange"
      @save="doSave"
      @fill-template="fillTemplate"
      @fill-sample="fillSample"
      @copy-template="copyTemplate"
      @import-csv="doImport"
      @compare="doCompare"
      @risk-followup="openRiskFollowup"
      @risk-assign="openRiskAssign"
      @risk-eta="openRiskEta"
      @open-purchase="openPurchasePage"
      @open-material-alerts="openMaterialAlerts"
      @submit-risk-action="submitRiskAction"
    />
  </div>
</template>

<script setup lang="ts">
import LevelTable from './bom/LevelTable.vue'
import BomBusinessTabs from './bom/BomBusinessTabs.vue'
import BomDialogs from './bom/BomDialogs.vue'
import { useBomManagement } from './bom/useBomManagement'
import { nodeTypeLabel, tierLabel } from './bom/bomShared'

const {
  instances,
  instanceId,
  summary,
  tree,
  flat,
  costs,
  materials,
  health,
  businessViews,
  treeFilter,
  selected,
  activeLevel,
  mainTab,
  dlgRiskDrill,
  selectedRiskComponent,
  riskOwners,
  dlgRiskAction,
  riskActionMode,
  selectedRiskItem,
  riskActionLoading,
  riskActionForm,
  totalCost,
  allNodes,
  minimumStructureMissing,
  templateColumns,
  docFilter,
  DOC_TYPE_LABEL,
  bomDocs,
  docLoading,
  filteredTree,
  drillNode,
  drillChildren,
  dlgAdd,
  dlgImport,
  dlgValidate,
  dlgCompare,
  saving,
  canEdit,
  importing,
  comparing,
  editingNode,
  addForm,
  csvText,
  validateResult,
  compareV1,
  compareV2,
  compareResult,
  loadBomDocs,
  downloadBomDoc,
  rowsOfLevel,
  loadAll,
  setLevel,
  onNodeClick,
  onRowSelect,
  prefillTier,
  onParentChange,
  onNodeTypeChange,
  drillPart,
  resetAddForm,
  openAddChild,
  openEdit,
  moveNode,
  doSave,
  doDelete,
  doImport,
  initMinimumBom,
  doValidate,
  doCompare,
  loadTemplate,
  fillTemplate,
  fillSample,
  copyTemplate,
  openRiskDrill,
  openRiskFollowup,
  openRiskAssign,
  openRiskEta,
  submitRiskAction,
  openPurchasePage,
  openMaterialAlerts } = useBomManagement()
</script>

<style scoped>
.tab-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.page { padding: 16px; }
.page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.page-title { font-size: 18px; font-weight: 600; }
.level-card { cursor: pointer; text-align: center; transition: all .2s; }
.level-card.active { box-shadow: 0 0 0 2px var(--el-color-primary) inset; }
.level-num { font-size: 28px; font-weight: 600; }
.level-label { font-size: 14px; font-weight: 500; margin-top: 4px; }
.level-tip { font-size: 12px; color: var(--el-color-info); margin-top: 2px; }
.health-title { font-size: 13px; color: var(--el-text-color-regular); margin-bottom: 8px; }
.health-score { font-size: 32px; font-weight: 700; line-height: 1; }
.health-metric { font-size: 18px; font-weight: 600; line-height: 1.4; }
.health-sub { font-size: 12px; color: var(--el-color-info); margin-top: 8px; min-height: 32px; }
:deep(.el-tree-node__content) { height: 32px; }
.bom-tree-node { display: inline-flex; align-items: center; gap: 6px; width: 100%; }
</style>
