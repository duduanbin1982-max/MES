<template>
  <div>
    <!-- 新增/编辑对话框 (同前, 略) -->
    <el-dialog v-model="dlgAddModel" :title="editingNode ? `编辑节点 #${editingNode.id}` : '新增 BOM 节点'" width="700px" @closed="emit('reset-add-form')">
      <el-form :model="addForm" label-width="100px" size="small">
        <el-row :gutter="12">
          <el-col :span="8">
            <el-form-item label="层级" required>
              <el-select v-model="addForm.tier" @change="emit('tier-change', $event)">
                <el-option label="0 总装" :value="0" />
                <el-option label="1 部件" :value="1" />
                <el-option label="2 零件" :value="2" />
                <el-option label="3 毛坯" :value="3" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="父节点">
              <el-select v-model="addForm.parent_id" filterable clearable style="width: 100%">
                <el-option v-for="p in allNodes" :key="p.id" :label="`#${p.id} ${p.material_name || ''} (tier ${p.tier})`" :value="p.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="物料" v-if="addForm.tier > 0">
              <el-select v-model="addForm.material_id" filterable clearable style="width: 100%">
                <el-option v-for="m in materials" :key="m.id" :label="`${m.material_code} · ${m.material_name}`" :value="m.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8"><el-form-item label="数量" required><el-input-number v-model="addForm.quantity" :min="0.0001" :step="1" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="单位" required><el-select v-model="addForm.unit"><el-option v-for="u in ['件','个','米','千克','套','台','根','条','升']" :key="u" :label="u" :value="u" /></el-select></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="分类" required><el-select v-model="addForm.category"><el-option v-for="c in ['自制机加件','自制钣金件','标准紧固件','气动元件','电气元件','外购成品','辅助材料','成品','自制部件']" :key="c" :label="c" :value="c" /></el-select></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="图号/型号"><el-input v-model="addForm.part_number" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="材质"><el-input v-model="addForm.material_grade" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="表面处理"><el-input v-model="addForm.surface_treatment" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="品牌/等级"><el-input v-model="addForm.brand_recommend" v-if="addForm.brand_grade === '不可替代'" placeholder="不可替代" disabled /><el-input v-model="addForm.brand_recommend" v-else placeholder="东明" /><el-select v-model="addForm.brand_grade" size="small" style="width: 90px; margin-left: 4px"><el-option label="A" value="A" /><el-option label="B" value="B" /><el-option label="不可" value="不可替代" /></el-select></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="损耗"><el-input-number v-model="addForm.scrap_factor" :min="1.0" :max="2.0" :step="0.05" :precision="2" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="单价"><el-input-number v-model="addForm.unit_price" :min="0" :precision="2" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="存放"><el-input v-model="addForm.storage_location" /></el-form-item></el-col>
          <el-col :span="24"><el-form-item label="标识"><el-checkbox v-model="addForm.is_phantom">虚项</el-checkbox><el-checkbox v-model="addForm.is_key_component">关键</el-checkbox><el-checkbox v-model="addForm.is_wear_part">易损</el-checkbox></el-form-item></el-col>
          <el-col :span="24"><el-form-item label="备注"><el-input v-model="addForm.notes" type="textarea" :rows="2" /></el-form-item></el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="dlgAddModel = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="emit('save')">保存</el-button>
      </template>
    </el-dialog>

    <!-- CSV 导入对话框 -->
    <el-dialog v-model="dlgImportModel" title="CSV 导入" width="700px">
      <el-alert type="info" :closable="false" style="margin-bottom: 12px">
        推荐工业模板列：node_ref, parent_ref, tier, material_id/material_code, part_number, quantity, unit, category<br>
        自制件强制补齐：material_grade, surface_treatment；外购件建议补齐：brand_recommend, brand_grade
      </el-alert>
      <el-space wrap style="margin-bottom: 12px">
        <el-button size="small" @click="emit('fill-template')">载入标准模板</el-button>
        <el-button size="small" @click="emit('fill-sample')">载入示例数据</el-button>
        <el-button size="small" @click="emit('copy-template')">复制模板到剪贴板</el-button>
      </el-space>
      <el-table :data="templateColumns" size="small" max-height="180" style="margin-bottom: 12px">
        <el-table-column prop="name" label="列名" width="160" />
        <el-table-column prop="required" label="建议" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="row.required ? 'danger' : 'info'">{{ row.required ? '核心' : '可选' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="desc" label="说明" min-width="280" />
      </el-table>
      <el-input v-model="csvTextModel" type="textarea" :rows="10" placeholder="tier,parent_id,material_id,quantity,unit,category,material_grade,scrap_factor" />
      <template #footer>
        <el-button @click="dlgImportModel = false">取消</el-button>
        <el-button type="primary" :loading="importing" @click="emit('import-csv')">导入</el-button>
      </template>
    </el-dialog>

    <!-- 校验对话框 -->
    <el-dialog v-model="dlgValidateModel" title="校验结果" width="700px">
      <el-alert v-if="validateResult?.ok" type="success" :closable="false"><el-icon><CircleCheck /></el-icon> 校验通过 ({{ validateResult?.total || 0 }} 节点)</el-alert>
      <el-alert v-else type="error" :closable="false">{{ (validateResult?.errors || []).length }} 项错误</el-alert>
      <el-row :gutter="12" style="margin-top: 12px">
        <el-col :span="8"><el-statistic title="健康度" :value="validateResult?.health?.score || 0" /></el-col>
        <el-col :span="8"><el-statistic title="错误" :value="(validateResult?.errors || []).length" /></el-col>
        <el-col :span="8"><el-statistic title="提醒" :value="(validateResult?.warnings || []).length" /></el-col>
      </el-row>
      <el-descriptions v-if="validateResult?.tier_summary" :column="4" border size="small" style="margin-top: 12px">
        <el-descriptions-item label="0级整机">{{ validateResult.tier_summary[0] || 0 }}</el-descriptions-item>
        <el-descriptions-item label="1级部件">{{ validateResult.tier_summary[1] || 0 }}</el-descriptions-item>
        <el-descriptions-item label="2级零件/外购件">{{ validateResult.tier_summary[2] || 0 }}</el-descriptions-item>
        <el-descriptions-item label="3级毛坯">{{ validateResult.tier_summary[3] || 0 }}</el-descriptions-item>
      </el-descriptions>
      <el-alert v-if="validateResult?.warnings?.length" type="warning" :closable="false" style="margin-top: 12px">
        <ul><li v-for="(w, i) in validateResult.warnings" :key="'w'+i">{{ w }}</li></ul>
      </el-alert>
      <ul style="margin-top: 12px"><li v-for="(e, i) in validateResult?.errors || []" :key="i">{{ e }}</li></ul>
    </el-dialog>

    <!-- ECO 对比对话框 -->
    <el-dialog v-model="dlgCompareModel" title="ECO 版本对比" width="600px">
      <el-form label-width="80px" size="small">
        <el-form-item label="旧版本"><el-input v-model="compareV1Model" /></el-form-item>
        <el-form-item label="新版本"><el-input v-model="compareV2Model" /></el-form-item>
        <el-button type="primary" @click="emit('compare')" :loading="comparing">对比</el-button>
      </el-form>
      <el-row :gutter="12" v-if="compareResult" style="margin-top: 16px">
        <el-col :span="8"><el-statistic title="新增" :value="compareResult.added.length" :value-style="{ color: 'var(--el-color-success)' }" /></el-col>
        <el-col :span="8"><el-statistic title="删除" :value="compareResult.removed.length" :value-style="{ color: 'var(--el-color-danger)' }" /></el-col>
        <el-col :span="8"><el-statistic title="修改" :value="compareResult.changed.length" :value-style="{ color: 'var(--el-color-warning)' }" /></el-col>
      </el-row>
    </el-dialog>

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
              {{ row.purchase_orders?.map(po => `${po.po_no}${po.expected_date ? `(${po.expected_date})` : ''}`).join('；') || '-' }}
            </template>
          </el-table-column>
          <el-table-column label="缺料单" min-width="220">
            <template #default="{ row }">
              {{ row.shortage_cases?.map(sc => `#${sc.id}${sc.owner_name ? `/${sc.owner_name}` : ''}${sc.expected_date ? `/${sc.expected_date}` : ''}`).join('；') || '-' }}
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
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

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
  (event: 'tier-change', tier: number): void
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

function kitRiskTagType(status: string) {
  if (status === 'ready') return 'success'
  if (status === 'blocked') return 'danger'
  return 'warning'
}

function kitRiskLabel(status: string) {
  if (status === 'ready') return '已齐套'
  if (status === 'blocked') return '阻塞'
  return '待到货'
}

function riskOwnerLabel(row: any) {
  return row?.full_name || row?.username || `用户#${row?.id}`
}
</script>

<style scoped>
.health-title { font-size: 13px; color: var(--el-text-color-regular); margin-bottom: 8px; }
.health-metric { font-size: 18px; font-weight: 600; line-height: 1.4; }
.health-sub { font-size: 12px; color: var(--el-color-info); margin-top: 8px; min-height: 32px; }
</style>
