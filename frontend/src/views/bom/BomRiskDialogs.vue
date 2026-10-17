<template>
  <el-dialog v-model="dlgRiskDrillModel" :title="selectedRiskComponent ? `风险钻取 · ${selectedRiskComponent.component_name}` : '风险钻取'" width="1100px">
    <template v-if="selectedRiskComponent">
      <el-row :gutter="12" style="margin-bottom: 12px">
        <el-col :span="6"><el-card shadow="never"><div class="health-title">风险状态</div><div class="health-metric">{{ kitRiskLabel(selectedRiskComponent.kit_status) }}</div><div class="health-sub">阻塞优先，其次在途待料</div></el-card></el-col>
        <el-col :span="6"><el-card shadow="never"><div class="health-title">风险物料行</div><div class="health-metric">{{ selectedRiskComponent.shortage_line_count || 0 }}</div><div class="health-sub">该部件当前缺件物料数</div></el-card></el-col>
        <el-col :span="6"><el-card shadow="never"><div class="health-title">最早到货</div><div class="health-metric">{{ selectedRiskComponent.next_expected_date || '-' }}</div><div class="health-sub">取采购单与缺料单计划的最早日期</div></el-card></el-col>
        <el-col :span="6"><el-card shadow="never"><div class="health-title">责任人</div><div class="health-metric" style="font-size:16px">{{ selectedRiskComponent.owners?.join(' / ') || '-' }}</div><div class="health-sub">优先取缺料单 owner，其次采购经办/审批</div></el-card></el-col>
      </el-row>

      <el-table :data="selectedRiskComponent.items || []" size="small" max-height="520">
        <el-table-column prop="material_code" label="物料编码" width="130" />
        <el-table-column label="物料名称" min-width="160">
          <template #default="{ row }">{{ row.material_name || row.part_number || '-' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }"><el-tag size="small" :type="kitRiskTagType(row.risk_status)">{{ kitRiskLabel(row.risk_status) }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="required_qty" label="需求" width="80" />
        <el-table-column prop="available_qty" label="库存" width="80" />
        <el-table-column prop="inbound_qty" label="在途" width="80" />
        <el-table-column prop="projected_shortage_qty" label="缺口" width="80" />
        <el-table-column prop="next_expected_date" label="到货计划" width="110" />
        <el-table-column label="责任人" width="120">
          <template #default="{ row }">{{ row.primary_owner || row.owners?.[0] || '-' }}</template>
        </el-table-column>
        <el-table-column label="采购申请" min-width="120">
          <template #default="{ row }">{{ row.purchase_request_nos?.join(' / ') || '-' }}</template>
        </el-table-column>
        <el-table-column label="采购单" min-width="200">
          <template #default="{ row }">
            {{ row.purchase_orders?.map((po: any) => `${po.po_no}${po.expected_date ? `(${po.expected_date})` : ''}`).join('；') || '-' }}
          </template>
        </el-table-column>
        <el-table-column label="缺料单" min-width="220">
          <template #default="{ row }">
            {{ row.shortage_cases?.map((shortageCase: any) => `#${shortageCase.id}${shortageCase.owner_name ? `/${shortageCase.owner_name}` : ''}${shortageCase.expected_date ? `/${shortageCase.expected_date}` : ''}`).join('；') || '-' }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="260" fixed="right">
          <template #default="{ row }">
            <el-button size="small" link type="warning" @click="emit('risk-followup', row)">催办</el-button>
            <el-button size="small" link type="success" @click="emit('risk-assign', row)">分派</el-button>
            <el-button size="small" link @click="emit('risk-eta', row)">ETA</el-button>
            <el-button size="small" link type="primary" @click="emit('open-purchase', row)">采购页</el-button>
            <el-button size="small" link @click="emit('open-material-alerts', row)">预警页</el-button>
          </template>
        </el-table-column>
      </el-table>
    </template>
    <template #footer>
      <el-button @click="dlgRiskDrillModel = false">关闭</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="dlgRiskActionModel" :title="riskActionMode === 'followup' ? '一键生成采购催办' : riskActionMode === 'assign' ? '分派缺料责任人' : '回写预计到货日期'" width="520px">
    <el-form label-width="100px" size="small">
      <el-form-item label="物料">
        <div>{{ selectedRiskItem?.material_code || selectedRiskItem?.material_name || selectedRiskItem?.part_number || '-' }}</div>
      </el-form-item>
      <el-form-item label="缺口">
        <div>{{ selectedRiskItem?.projected_shortage_qty || selectedRiskItem?.shortage_qty || 0 }}</div>
      </el-form-item>
      <el-form-item v-if="riskActionMode !== 'eta'" label="责任人">
        <el-select v-model="riskActionForm.owner_id" clearable filterable placeholder="选择责任人" style="width:100%">
          <el-option v-for="u in riskOwners" :key="u.id" :label="riskOwnerLabel(u)" :value="u.id" />
        </el-select>
      </el-form-item>
      <el-form-item v-if="riskActionMode !== 'assign'" label="预计到货">
        <el-input v-model="riskActionForm.expected_date" placeholder="2026-07-15" />
      </el-form-item>
      <el-form-item v-if="riskActionMode === 'followup'" label="催办说明">
        <el-input v-model="riskActionForm.note" type="textarea" :rows="3" placeholder="默认会生成采购催办说明" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dlgRiskActionModel = false">取消</el-button>
      <el-button type="primary" :loading="riskActionLoading" @click="emit('submit-risk-action')">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { kitRiskLabel, kitRiskTagType, riskOwnerLabel } from './bomShared'

type RiskActionMode = 'followup' | 'assign' | 'eta'

const props = defineProps<{
  dlgRiskDrill: boolean
  dlgRiskAction: boolean
  selectedRiskComponent: any
  selectedRiskItem: any
  riskActionMode: RiskActionMode
  riskOwners: any[]
  riskActionLoading: boolean
}>()
// 2026-10-17（前端 eslint 棘轮）：被模板改写的对象 prop 改为 defineModel，
// 父组件用 v-model:xxx 绑定；改的仍是父组件同一对象，行为不变。
const riskActionForm = defineModel<any>('riskActionForm', { required: true })


const emit = defineEmits<{
  (event: 'update:dlgRiskDrill', value: boolean): void
  (event: 'update:dlgRiskAction', value: boolean): void
  (event: 'risk-followup', row: any): void
  (event: 'risk-assign', row: any): void
  (event: 'risk-eta', row: any): void
  (event: 'open-purchase', row: any): void
  (event: 'open-material-alerts', row: any): void
  (event: 'submit-risk-action'): void
}>()

const dlgRiskDrillModel = computed({ get: () => props.dlgRiskDrill, set: (value: boolean) => emit('update:dlgRiskDrill', value) })
const dlgRiskActionModel = computed({ get: () => props.dlgRiskAction, set: (value: boolean) => emit('update:dlgRiskAction', value) })
</script>
