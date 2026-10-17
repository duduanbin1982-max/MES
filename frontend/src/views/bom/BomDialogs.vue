<template>
  <div>
    <BomAddEditDialog
      v-model:dlg-add="dlgAddModel"
      :editing-node="editingNode"
      v-model:add-form="addForm"
      :all-nodes="allNodes"
      :materials="materials"
      :saving="saving"
      @reset-add-form="emit('reset-add-form')"
      @parent-change="emit('parent-change', $event)"
      @node-type-change="emit('node-type-change', $event)"
      @save="emit('save')"
    />
    <BomImportDialog
      v-model:dlg-import="dlgImportModel"
      v-model:csv-text="csvTextModel"
      :template-columns="templateColumns"
      :importing="importing"
      @fill-template="emit('fill-template')"
      @fill-sample="emit('fill-sample')"
      @copy-template="emit('copy-template')"
      @import-csv="emit('import-csv')"
    />
    <BomValidateDialog v-model:dlg-validate="dlgValidateModel" :validate-result="validateResult" />
    <BomCompareDialog
      v-model:dlg-compare="dlgCompareModel"
      v-model:compare-v1="compareV1Model"
      v-model:compare-v2="compareV2Model"
      :comparing="comparing"
      :compare-result="compareResult"
      @compare="emit('compare')"
    />
    <BomRiskDialogs
      v-model:dlg-risk-drill="dlgRiskDrillModel"
      v-model:dlg-risk-action="dlgRiskActionModel"
      :selected-risk-component="selectedRiskComponent"
      :selected-risk-item="selectedRiskItem"
      :risk-action-mode="riskActionMode"
      v-model:risk-action-form="riskActionForm"
      :risk-owners="riskOwners"
      :risk-action-loading="riskActionLoading"
      @risk-followup="emit('risk-followup', $event)"
      @risk-assign="emit('risk-assign', $event)"
      @risk-eta="emit('risk-eta', $event)"
      @open-purchase="emit('open-purchase', $event)"
      @open-material-alerts="emit('open-material-alerts', $event)"
      @submit-risk-action="emit('submit-risk-action')"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import BomAddEditDialog from './BomAddEditDialog.vue'
import BomImportDialog from './BomImportDialog.vue'
import BomValidateDialog from './BomValidateDialog.vue'
import BomCompareDialog from './BomCompareDialog.vue'
import BomRiskDialogs from './BomRiskDialogs.vue'

type RiskActionMode = 'followup' | 'assign' | 'eta'

const props = defineProps<{
  dlgAdd: boolean
  dlgImport: boolean
  dlgValidate: boolean
  dlgCompare: boolean
  dlgRiskDrill: boolean
  dlgRiskAction: boolean
  csvText: string
  compareV1: string
  compareV2: string
  editingNode: any
  addForm: any
  allNodes: any[]
  materials: any[]
  saving: boolean
  templateColumns: any[]
  importing: boolean
  validateResult: any
  comparing: boolean
  compareResult: any
  selectedRiskComponent: any
  selectedRiskItem: any
  riskActionMode: RiskActionMode
  riskActionForm: any
  riskOwners: any[]
  riskActionLoading: boolean
}>()

const emit = defineEmits<{
  (event: 'update:dlgAdd', value: boolean): void
  (event: 'update:dlgImport', value: boolean): void
  (event: 'update:dlgValidate', value: boolean): void
  (event: 'update:dlgCompare', value: boolean): void
  (event: 'update:dlgRiskDrill', value: boolean): void
  (event: 'update:dlgRiskAction', value: boolean): void
  (event: 'update:csvText', value: string): void
  (event: 'update:compareV1', value: string): void
  (event: 'update:compareV2', value: string): void
  (event: 'reset-add-form'): void
  (event: 'parent-change', parentId: number | null): void
  (event: 'node-type-change', nodeType: string): void
  (event: 'save'): void
  (event: 'fill-template'): void
  (event: 'fill-sample'): void
  (event: 'copy-template'): void
  (event: 'import-csv'): void
  (event: 'compare'): void
  (event: 'risk-followup', row: any): void
  (event: 'risk-assign', row: any): void
  (event: 'risk-eta', row: any): void
  (event: 'open-purchase', row: any): void
  (event: 'open-material-alerts', row: any): void
  (event: 'submit-risk-action'): void
}>()

const dlgAddModel = computed({ get: () => props.dlgAdd, set: (value: boolean) => emit('update:dlgAdd', value) })
const dlgImportModel = computed({ get: () => props.dlgImport, set: (value: boolean) => emit('update:dlgImport', value) })
const dlgValidateModel = computed({ get: () => props.dlgValidate, set: (value: boolean) => emit('update:dlgValidate', value) })
const dlgCompareModel = computed({ get: () => props.dlgCompare, set: (value: boolean) => emit('update:dlgCompare', value) })
const dlgRiskDrillModel = computed({ get: () => props.dlgRiskDrill, set: (value: boolean) => emit('update:dlgRiskDrill', value) })
const dlgRiskActionModel = computed({ get: () => props.dlgRiskAction, set: (value: boolean) => emit('update:dlgRiskAction', value) })
const csvTextModel = computed({ get: () => props.csvText, set: (value: string) => emit('update:csvText', value) })
const compareV1Model = computed({ get: () => props.compareV1, set: (value: string) => emit('update:compareV1', value) })
const compareV2Model = computed({ get: () => props.compareV2, set: (value: string) => emit('update:compareV2', value) })
</script>
