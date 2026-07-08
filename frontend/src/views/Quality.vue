<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title">🔍 质检管理</div>
    </div>

    <el-tabs v-model="activeTab" type="border-card">
      <el-tab-pane label="检验记录" name="inspections">
        <QualityInspectionsTab
          :stats="stats"
          :filters="filters"
          :instances="instances"
          :types="types"
          :rows="rows"
          :loading="loading"
          :type-label="typeLabel"
          :type-color="typeColor"
          @load="load"
          @create="showCreate = true"
        />
      </el-tab-pane>

      <el-tab-pane label="不合格品 (NCR)" name="ncr">
        <QualityNcrTab
          :filters="ncrFilters"
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
          :filters="capaFilters"
          :users="users"
          :rows="capaRows"
          :loading="capaLoading"
          :row-class="capaRowClass"
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

      <el-tab-pane label="📊 质量仪表板" name="dashboard">
        <QualityDashboardTab :dash="dash" :spc-dash="spcDash" />
      </el-tab-pane>
    </el-tabs>

    <QualityDialogs
      v-model:show-create="showCreate"
      v-model:show-ncr-create="showNcrCreate"
      v-model:show-disposition="showDisposition"
      v-model:show-capa-dialog="showCapaDialog"
      v-model:show-closure-dialog="showClosureDialog"
      v-model:show-template-create="showTemplateCreate"
      v-model:show-template-items="showTemplateItems"
      v-model:close-note="closeNote"
      :form="form"
      :ncr-form="ncrForm"
      :disposition-form="dispositionForm"
      :capa-add-form="capaAddForm"
      :recheck-form="recheckForm"
      :template-form="templateForm"
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
import QualityInspectionsTab from './quality/QualityInspectionsTab.vue'
import QualityNcrTab from './quality/QualityNcrTab.vue'
import QualityCapaTab from './quality/QualityCapaTab.vue'
import QualityTemplatesTab from './quality/QualityTemplatesTab.vue'
import QualityDashboardTab from './quality/QualityDashboardTab.vue'
import QualityDialogs from './quality/QualityDialogs.vue'
import { useQualityManagement } from './quality/useQualityManagement'

const {
  activeTab,
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
  capaRowClass,
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
</script>

<style scoped>
.page{padding:16px 24px}
.page-header{margin-bottom:16px}
.page-title{font-size:20px;font-weight:600}
</style>
