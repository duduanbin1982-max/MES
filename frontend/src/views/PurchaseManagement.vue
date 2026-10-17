<template>
  <div class="page">
    <PageToolbar title="采购管理" subtitle="供应商、采购订单、跟催与来料协同统一处理" aria-label="采购管理工具栏">
      <template #icon><el-icon><Document /></el-icon></template>
    </PageToolbar>

    <el-tabs v-model="tab">
      <PurchaseSuppliersTab
        :supplier-setup="supplierSetup"
        :missing-templates="missingTemplates"
        v-model:supplier-filter="supplierFilter"
        :supplier-categories="supplierCategories"
        :suppliers="suppliers"
        :s-loading="sLoading"
        v-model:supplier-dlg="supplierDlg"
        v-model:supplier-form="supplierForm"
        :saving="saving"
        :supplier-name="supplierName"
        :supplier-category-label="supplierCategoryLabel"
        :supplier-category-tag="supplierCategoryTag"
        :supplier-setup-count="supplierSetupCount"
        @load-suppliers="loadSuppliers"
        @bootstrap-defaults="bootstrapSupplierDefaults"
        @open-template="openSupplierTemplate"
        @open-dialog="openSupplierDialog"
        @delete-supplier="deleteSupplier"
        @reset-form="resetSupplierForm"
        @sync-category="syncSupplierCategory"
        @save-supplier="saveSupplier"
      />

      <PurchaseOrdersTab
        v-model:order-filter="orderFilter"
        :po-statuses="poStatuses"
        :po-status-label="poStatusLabel"
        :po-status-tag="poStatusTag"
        :orders="orders"
        :o-loading="oLoading"
        :order-error="orderError"
        v-model:order-dlg="orderDlg"
        v-model:order-form="orderForm"
        :suppliers="suppliers"
        :supplier-name="supplierName"
        :materials="materials"
        :order-total="orderTotal"
        :saving="saving"
        v-model:detail-dlg="detailDlg"
        :detail-po="detailPo"
        v-model:receive-dlg="receiveDlg"
        :receive-po="receivePo"
        :receive-items="receiveItems"
        @load-orders="loadOrders"
        @open-order-dialog="openOrderDialog"
        @show-order-detail="showOrderDetail"
        @approve-order="approveOrder"
        @open-receive-dialog="openReceiveDialog"
        @reset-order-form="resetOrderForm"
        @save-order="saveOrder"
        @do-receive="doReceive"
      />

      <PurchaseFollowupTab
        :follow-up-summary="followUpSummary"
        v-model:follow-up-filter="followUpFilter"
        :filtered-follow-ups="filteredFollowUps"
        :follow-up-loading="followUpLoading"
        :follow-up-status-tag="followUpStatusTag"
        :follow-up-status-label="followUpStatusLabel"
        v-model:follow-up-dlg="followUpDlg"
        :current-follow-up="currentFollowUp"
        v-model:follow-up-form="followUpForm"
        :saving="saving"
        @load-purchase-follow-up="loadPurchaseFollowUp"
        @open-follow-up-dialog="openFollowUpDialog"
        @go-kit-from-follow-up="goKitFromFollowUp"
        @show-order-detail="showOrderDetail"
        @save-follow-up="saveFollowUp"
      />

      <PurchaseQuoteTab
        v-model:quote-form="quoteForm"
        :suppliers="suppliers"
        :supplier-name="supplierName"
        :materials="materials"
        :quote-loading="quoteLoading"
        :quote-results="quoteResults"
        :quote-suppliers="quoteSuppliers"
        :quote-loaded="quoteLoaded"
        @compare-quotes="compareQuotes"
      />

      <PurchaseSupplierCollabTab
        :collab-overview="collabOverview"
        v-model:incoming-form="incomingForm"
        :pending-receipts="pendingReceipts"
        :suppliers="suppliers"
        :supplier-name="supplierName"
        :materials="materials"
        :collab-loading="collabLoading"
        :incoming-inspections="incomingInspections"
        v-model:outsource-form="outsourceForm"
        :outsourcing-orders="outsourcingOrders"
        :scorecards="scorecards"
        :outsource-status-tag="outsourceStatusTag"
        :outsource-status-label="outsourceStatusLabel"
        :score-grade-tag="scoreGradeTag"
        @save-incoming-inspection="saveIncomingInspection"
        @save-outsource-order="saveOutsourceOrder"
        @update-outsource="updateOutsource"
      />

    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import PurchaseSuppliersTab from './purchase/PurchaseSuppliersTab.vue'
import PurchaseOrdersTab from './purchase/PurchaseOrdersTab.vue'
import PurchaseFollowupTab from './purchase/PurchaseFollowupTab.vue'
import PurchaseQuoteTab from './purchase/PurchaseQuoteTab.vue'
import PurchaseSupplierCollabTab from './purchase/PurchaseSupplierCollabTab.vue'
import { usePurchaseManagement } from './purchase/usePurchaseManagement'
import PageToolbar from '../components/PageToolbar.vue'

const {
  tab,
  saving,
  suppliers,
  materials,
  supplierCategories,
  supplierFilter,
  supplierSetup,
  missingTemplates,
  followUpLoading,
  followUpSummary,
  followUpFilter,
  filteredFollowUps,
  followUpDlg,
  currentFollowUp,
  followUpForm,
  sLoading,
  supplierDlg,
  supplierForm,
  loadSuppliers,
  bootstrapSupplierDefaults,
  openSupplierTemplate,
  openSupplierDialog,
  deleteSupplier,
  resetSupplierForm,
  syncSupplierCategory,
  saveSupplier,
  supplierName,
  supplierCategoryLabel,
  supplierCategoryTag,
  supplierSetupCount,
  poStatuses,
  poStatusLabel,
  poStatusTag,
  orders,
  oLoading,
  orderError,
  orderFilter,
  orderDlg,
  orderForm,
  orderTotal,
  detailDlg,
  detailPo,
  receiveDlg,
  receivePo,
  receiveItems,
  loadOrders,
  openOrderDialog,
  resetOrderForm,
  saveOrder,
  showOrderDetail,
  approveOrder,
  openReceiveDialog,
  doReceive,
  followUpStatusLabel,
  followUpStatusTag,
  loadPurchaseFollowUp,
  openFollowUpDialog,
  saveFollowUp,
  goKitFromFollowUp,
  quoteForm,
  quoteResults,
  quoteSuppliers,
  quoteLoading,
  quoteLoaded,
  compareQuotes,
  collabLoading,
  collabOverview,
  pendingReceipts,
  incomingInspections,
  outsourcingOrders,
  scorecards,
  outsourceStatusLabel,
  outsourceStatusTag,
  scoreGradeTag,
  incomingForm,
  outsourceForm,
  loadSupplierCollab,
  saveIncomingInspection,
  saveOutsourceOrder,
  updateOutsource,
} = usePurchaseManagement()
</script>

<style scoped>
.page { padding: 16px 24px; }
.page-header { margin-bottom: 16px; }
.page-title { font-size: 20px; font-weight: 600; }
.tb { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
.setup-row { margin-bottom: 12px; }
.setup-card { min-height: 96px; }
.setup-label { color: var(--el-text-color-secondary); font-size: 12px; }
.setup-value { font-size: 28px; font-weight: 700; margin-top: 8px; }
.setup-sub { color: var(--el-text-color-secondary); font-size: 12px; margin-top: 6px; }
.supplier-alert { margin-bottom: 12px; }
.template-card { margin-bottom: 12px; }
.template-head { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
.template-sub { color: var(--el-text-color-secondary); font-size: 12px; }
.template-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.template-item { border: 1px solid var(--el-border-color-lighter); border-radius: 10px; padding: 12px; background: var(--el-fill-color-blank); }
.template-title { font-weight: 700; margin-bottom: 6px; }
.template-desc { color: var(--el-text-color-secondary); font-size: 12px; min-height: 40px; line-height: 1.5; }
.template-status { margin: 10px 0; }
.followup-row { margin-bottom: 12px; }
.followup-card { min-height: 96px; }
.followup-label { color: var(--el-text-color-secondary); font-size: 12px; }
.followup-value { font-size: 28px; font-weight: 700; margin-top: 8px; }
.followup-value.danger { color: var(--el-color-danger); }
.followup-value.warning { color: var(--el-color-warning); }
.followup-sub { color: var(--el-text-color-secondary); font-size: 12px; margin-top: 6px; }
</style>
