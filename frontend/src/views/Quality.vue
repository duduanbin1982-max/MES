<template>
  <div class="page">
    <PageToolbar :title="pageTitle" :subtitle="pageSubtitle" aria-label="质量管理工具栏">
      <template #icon><el-icon><Search /></el-icon></template>
      <template #actions>
        <el-button :loading="loading" @click="load">刷新检验记录</el-button>
      </template>
    </PageToolbar>

    <PageState
      v-if="loading && activeTab === 'inspections'"
      state="loading"
      compact
      title="正在加载质量数据"
      description="正在读取检验记录、NCR 和质量指标。"
    />

    <el-tabs v-else v-model="activeTab" type="border-card">
      <el-tab-pane label="检验记录" name="inspections">
        <QualityInspectionsTab
          :stats="stats"
          v-model:filters="filters"
          :instances="instances"
          :types="types"
          :rows="rows"
          :loading="loading"
          :type-label="typeLabel"
          :type-color="typeColor"
          :inspection-entry="inspectionEntry"
          :is-scoped="isInspectionTypeScoped"
          @load="load"
          @create="openCreateInspection"
          @clear-scope="clearInspectionRouteScope"
        />
      </el-tab-pane>

      <el-tab-pane label="不合格品 (NCR)" name="ncr">
        <QualityNcrTab
          v-model:filters="ncrFilters"
          :rows="ncrRows"
          :loading="ncrLoading"
          :severity-label="severityLabel"
          :severity-color="severityColor"
          :disposition-label="dispositionLabel"
          :disposition-color="dispositionColor"
          :ncr-status-label="ncrStatusLabel"
          :ncr-status-color="ncrStatusColor"
          @load="loadNcr"
          @create="showNcrCreate = true"
          @disposition="openDisposition"
          @capa="openCapa"
          @closure="openClosure"
        />
      </el-tab-pane>

      <el-tab-pane label="纠正预防 (CAPA)" name="capa">
        <QualityCapaTab
          v-model:filters="capaFilters"
          :users="users"
          :rows="capaRows"
          :loading="capaLoading"
          @load="loadCapa"
          @complete="completeCapa"
        />
      </el-tab-pane>

      <el-tab-pane label="检验模板" name="templates">
        <QualityTemplatesTab
          :rows="templateRows"
          :loading="templateLoading"
          @create="showTemplateCreate = true"
          @view-items="viewTemplateItems"
        />
      </el-tab-pane>

      <el-tab-pane name="dashboard">
        <template #label><span class="tab-label"><el-icon><DataAnalysis /></el-icon>质量仪表板</span></template>
        <QualityDashboardTab :dash="dash" :spc-dash="spcDash" />
      </el-tab-pane>
    </el-tabs>

    <el-alert
      type="info"
      :closable="false"
      show-icon
      class="quality-scope-note"
      title="口径说明：概览指标（通过率/缺陷 TOP/NCR 概览）为近 30 天；检验记录与 NCR/CAPA 列表为历史累计（可用筛选缩小范围）。"
    />


    <QualityDialogs
      v-model:show-create="showCreate"
      v-model:show-ncr-create="showNcrCreate"
      v-model:show-disposition="showDisposition"
      v-model:show-capa-dialog="showCapaDialog"
      v-model:show-closure-dialog="showClosureDialog"
      v-model:show-template-create="showTemplateCreate"
      v-model:show-template-items="showTemplateItems"
      v-model:close-note="closeNote"
      v-model:form="form"
      v-model:ncr-form="ncrForm"
      v-model:disposition-form="dispositionForm"
      v-model:capa-add-form="capaAddForm"
      v-model:recheck-form="recheckForm"
      v-model:template-form="templateForm"
      :instances="instances"
      :work-orders="workOrders"
      :users="users"
      :types="types"
      :equipment-types="equipmentTypes"
      :submitting="submitting"
      :ncr-submitting="ncrSubmitting"
      :disp-submitting="dispSubmitting"
      :disposition-ncr="dispositionNcr"
      :capa-ncr="capaNcr"
      :capa-items="capaItems"
      :capa-adding="capaAdding"
      :closure="closure"
      :closure-step="closureStep"
      :closure-loading="closureLoading"
      :template-submitting="templateSubmitting"
      :template-items-template="templateItemsTemplate"
      :template-items-list="templateItemsList"
      :disposition-label="dispositionLabel"
      @submit="submit"
      @submit-ncr="submitNcr"
      @submit-disposition="submitDisposition"
      @add-capa-item="addCapaItem"
      @submit-recheck="submitRecheck"
      @close-ncr="closeNcr"
      @submit-template="submitTemplate"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import PageState from '../components/PageState.vue'
import PageToolbar from '../components/PageToolbar.vue'
import QualityInspectionsTab from './quality/QualityInspectionsTab.vue'
import QualityNcrTab from './quality/QualityNcrTab.vue'
import QualityCapaTab from './quality/QualityCapaTab.vue'
import QualityTemplatesTab from './quality/QualityTemplatesTab.vue'
import QualityDashboardTab from './quality/QualityDashboardTab.vue'
import QualityDialogs from './quality/QualityDialogs.vue'
import { useQualityManagement } from './quality/useQualityManagement'

const {
  activeTab,
  clearInspectionRouteScope,
  filters,
  rows,
  stats,
  instances,
  workOrders,
  users,
  loading,
  showCreate,
  submitting,
  form,
  types,
  inspectionEntry,
  isInspectionTypeScoped,
  openCreateInspection,
  typeLabel,
  typeColor,
  load,
  submit,
  dash,
  spcDash,
  ncrFilters,
  ncrRows,
  ncrLoading,
  showNcrCreate,
  ncrSubmitting,
  ncrForm,
  severityLabel,
  severityColor,
  dispositionLabel,
  dispositionColor,
  ncrStatusLabel,
  ncrStatusColor,
  loadNcr,
  submitNcr,
  showDisposition,
  dispositionNcr,
  dispSubmitting,
  dispositionForm,
  openDisposition,
  submitDisposition,
  showCapaDialog,
  capaNcr,
  capaItems,
  capaAdding,
  capaAddForm,
  openCapa,
  addCapaItem,
  capaFilters,
  capaRows,
  capaLoading,
  loadCapa,
  completeCapa,
  showClosureDialog,
  closureLoading,
  closure,
  closeNote,
  recheckForm,
  closureStep,
  openClosure,
  submitRecheck,
  closeNcr,
  templateRows,
  templateLoading,
  showTemplateCreate,
  templateSubmitting,
  templateForm,
  equipmentTypes,
  showTemplateItems,
  templateItemsTemplate,
  templateItemsList,
  submitTemplate,
  viewTemplateItems,
} = useQualityManagement()

const pageTitle = computed(() => activeTab.value === 'inspections' ? inspectionEntry.value.title : '质检管理')
const pageSubtitle = computed(() => (
  activeTab.value === 'inspections'
    ? inspectionEntry.value.subtitle
    : 'NCR、CAPA、检验模板与质量看板统一管理'
))
</script>

<style scoped>
.tab-label { display: inline-flex; align-items: center; gap: 6px; }
</style>

<style scoped>
.page{padding:16px 24px}
.page-header{margin-bottom:16px}
.page-title{display:flex;align-items:center;gap:8px;font-size:20px;font-weight:600;color:var(--mes-text-primary, #1f2937)}
.page-subtitle{margin-top:6px;color:var(--mes-text-secondary, #6b7280);font-size:13px}
</style>
