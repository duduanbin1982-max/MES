<template>
      <el-tab-pane label="<el-icon><ShoppingCart /></el-icon> 采购视图" name="purchase">
        <el-row :gutter="12" style="margin-bottom: 12px">
          <el-col :span="6"><el-card shadow="hover"><div class="health-title">采购条目</div><div class="health-metric">{{ businessViews.summary?.purchase_line_count || 0 }}</div><div class="health-sub">按物料/型号聚合后的采购清单</div></el-card></el-col>
          <el-col :span="6"><el-card shadow="hover"><div class="health-title">采购估价</div><div class="health-metric">¥{{ fmtMoney(businessViews.purchase?.total_estimated_amount) }}</div><div class="health-sub">作为采购预算与合同对比基线</div></el-card></el-col>
          <el-col :span="6"><el-card shadow="hover"><div class="health-title">总需求量</div><div class="health-metric">{{ businessViews.purchase?.total_quantity || 0 }}</div><div class="health-sub">已合并同物料需求数量</div></el-card></el-col>
          <el-col :span="6"><el-card shadow="hover"><div class="health-title">缺估价</div><div class="health-metric">{{ businessViews.purchase?.missing_price_count || 0 }}</div><div class="health-sub">先补单价，再做合同价差分析</div></el-card></el-col>
        </el-row>
        <el-table :data="businessViews.purchase?.items || []" size="small" max-height="280">
          <el-table-column prop="material_code" label="物料编码" width="140" />
          <el-table-column prop="material_name" label="物料名称" min-width="160">
            <template #default="{ row }">{{ row.material_name || row.part_number || '-' }}</template>
          </el-table-column>
          <el-table-column prop="part_number" label="图号/型号" min-width="120" />
          <el-table-column prop="category" label="分类" width="110" />
          <el-table-column prop="brand_recommend" label="品牌" width="100" />
          <el-table-column prop="quantity" label="数量" width="90" />
          <el-table-column prop="unit" label="单位" width="70" />
          <el-table-column label="估价金额" width="110">
            <template #default="{ row }">¥{{ fmtMoney(row.estimated_amount) }}</template>
          </el-table-column>
          <el-table-column prop="missing_price" label="缺价" width="70" />
          <el-table-column label="BOM引用" width="90">
            <template #default="{ row }">{{ row.bom_refs?.length || 0 }}</template>
          </el-table-column>
        </el-table>

        <el-card style="margin-top: 12px">
          <template #header><span>采购估价 → 实际合同价差异表</span></template>
          <el-row :gutter="12" style="margin-bottom: 12px">
            <el-col :span="6"><el-card shadow="never"><div class="health-title">已签合同</div><div class="health-metric">{{ businessViews.purchase?.contract_diff?.signed_count || 0 }}</div><div class="health-sub">已形成合同价的采购条目</div></el-card></el-col>
            <el-col :span="6"><el-card shadow="never"><div class="health-title">待签合同</div><div class="health-metric">{{ businessViews.purchase?.contract_diff?.pending_count || 0 }}</div><div class="health-sub">仍按 BOM 估价执行的条目</div></el-card></el-col>
            <el-col :span="6"><el-card shadow="never"><div class="health-title">合同总额</div><div class="health-metric">¥{{ fmtMoney(businessViews.purchase?.contract_diff?.total_actual_amount) }}</div><div class="health-sub">按已录入 PO/合同单价折算</div></el-card></el-col>
            <el-col :span="6"><el-card shadow="never"><div class="health-title">总差额</div><div class="health-metric">¥{{ fmtMoney(businessViews.purchase?.contract_diff?.total_diff_amount) }}</div><div class="health-sub">正数超预算，负数表示节约</div></el-card></el-col>
          </el-row>
          <el-table :data="businessViews.purchase?.contract_diff?.items || []" size="small" max-height="360">
            <el-table-column prop="material_code" label="物料编码" width="130" />
            <el-table-column label="物料名称" min-width="150">
              <template #default="{ row }">{{ row.material_name || row.part_number || '-' }}</template>
            </el-table-column>
            <el-table-column prop="quantity" label="BOM数量" width="90" />
            <el-table-column prop="unit" label="单位" width="70" />
            <el-table-column label="估价单价" width="100">
              <template #default="{ row }">{{ row.estimated_unit_price == null ? '-' : `¥${fmtMoney(row.estimated_unit_price)}` }}</template>
            </el-table-column>
            <el-table-column label="合同单价" width="100">
              <template #default="{ row }">{{ row.actual_unit_price == null ? '-' : `¥${fmtMoney(row.actual_unit_price)}` }}</template>
            </el-table-column>
            <el-table-column label="差额" width="110">
              <template #default="{ row }">{{ row.diff_amount == null ? '-' : `¥${fmtMoney(row.diff_amount)}` }}</template>
            </el-table-column>
            <el-table-column label="状态" width="110">
              <template #default="{ row }">
                <el-tag size="small" :type="contractDiffTagType(row.diff_status)">{{ contractDiffLabel(row.diff_status) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="供应商" min-width="140">
              <template #default="{ row }">{{ row.supplier_names?.join(' / ') || '-' }}</template>
            </el-table-column>
            <el-table-column label="PO/合同" min-width="150">
              <template #default="{ row }">{{ row.po_nos?.join(' / ') || '-' }}</template>
            </el-table-column>
            <el-table-column prop="next_expected_date" label="预计到货" width="110" />
          </el-table>
        </el-card>
      </el-tab-pane>

      <el-tab-pane label="<el-icon><Connection /></el-icon> 装配视图" name="assembly">
        <el-row :gutter="12" style="margin-bottom: 12px">
          <el-col :span="6"><el-card shadow="hover"><div class="health-title">部件数量</div><div class="health-metric">{{ businessViews.summary?.component_count || 0 }}</div><div class="health-sub">1级部件/模组装配视角</div></el-card></el-col>
          <el-col :span="6"><el-card shadow="hover"><div class="health-title">完整工艺部件</div><div class="health-metric">{{ businessViews.summary?.complete_process_components || 0 }}</div><div class="health-sub">工位/工时/技能齐全的部件</div></el-card></el-col>
          <el-col :span="6"><el-card shadow="hover"><div class="health-title">部件成本</div><div class="health-metric">¥{{ fmtMoney(businessViews.assembly?.total_cost) }}</div><div class="health-sub">累计部件成本汇总</div></el-card></el-col>
          <el-col :span="6"><el-card shadow="hover"><div class="health-title">缺图纸提醒</div><div class="health-metric">{{ assemblyMissingDocs }}</div><div class="health-sub">优先补齐装配文档与工艺卡</div></el-card></el-col>
        </el-row>
        <el-table :data="businessViews.assembly?.components || []" size="small" max-height="280">
          <el-table-column prop="component_name" label="部件/模组" min-width="180" />
          <el-table-column prop="part_number" label="图号" width="120" />
          <el-table-column prop="child_count" label="子项" width="70" />
          <el-table-column prop="leaf_count" label="叶子" width="70" />
          <el-table-column prop="purchased_count" label="外购件" width="80" />
          <el-table-column prop="self_made_count" label="自制件" width="80" />
          <el-table-column prop="raw_count" label="毛坯" width="70" />
          <el-table-column label="工艺状态" width="110">
            <template #default="{ row }"><el-tag size="small" :type="processTagType(row.process_status)">{{ processLabel(row.process_status) }}</el-tag></template>
          </el-table-column>
          <el-table-column prop="doc_count" label="文档数" width="80" />
          <el-table-column label="累计成本" width="110">
            <template #default="{ row }">¥{{ fmtMoney(row.total_cost) }}</template>
          </el-table-column>
          <el-table-column label="齐套状态" width="110">
            <template #default="{ row }"><el-tag size="small" :type="kitRiskTagType(row.kit_status)">{{ kitRiskLabel(row.kit_status) }}</el-tag></template>
          </el-table-column>
          <el-table-column prop="kit_shortage_count" label="缺件行" width="80" />
          <el-table-column label="缺口" min-width="180">
            <template #default="{ row }">{{ row.process_missing?.join('；') || '-' }}</template>
          </el-table-column>
        </el-table>

        <el-card style="margin-top: 12px">
          <template #header><span>装配齐套 / 缺件风险视图</span></template>
          <el-row :gutter="12" style="margin-bottom: 12px">
            <el-col :span="6"><el-card shadow="never"><div class="health-title">已齐套部件</div><div class="health-metric">{{ businessViews.assembly?.kit_summary?.ready_count || 0 }}</div><div class="health-sub">库存满足装配需求</div></el-card></el-col>
            <el-col :span="6"><el-card shadow="never"><div class="health-title">待到货部件</div><div class="health-metric">{{ businessViews.assembly?.kit_summary?.incoming_count || 0 }}</div><div class="health-sub">有在途采购可覆盖缺口</div></el-card></el-col>
            <el-col :span="6"><el-card shadow="never"><div class="health-title">阻塞部件</div><div class="health-metric">{{ businessViews.assembly?.kit_summary?.blocked_count || 0 }}</div><div class="health-sub">现有库存+在途仍不足</div></el-card></el-col>
            <el-col :span="6"><el-card shadow="never"><div class="health-title">风险缺件行</div><div class="health-metric">{{ businessViews.assembly?.kit_summary?.shortage_line_count || 0 }}</div><div class="health-sub">需要采购/催交的物料项</div></el-card></el-col>
          </el-row>
          <el-table :data="businessViews.assembly?.kit_risks || []" size="small" max-height="360">
            <el-table-column prop="component_name" label="部件/模组" min-width="180" />
            <el-table-column prop="part_number" label="图号" width="120" />
            <el-table-column label="风险状态" width="110">
              <template #default="{ row }"><el-tag size="small" :type="kitRiskTagType(row.kit_status)">{{ kitRiskLabel(row.kit_status) }}</el-tag></template>
            </el-table-column>
            <el-table-column prop="blocked_material_count" label="阻塞料" width="80" />
            <el-table-column prop="incoming_material_count" label="在途料" width="80" />
            <el-table-column prop="shortage_line_count" label="风险行" width="80" />
            <el-table-column label="缺口金额" width="110">
              <template #default="{ row }">¥{{ fmtMoney(row.shortage_amount) }}</template>
            </el-table-column>
            <el-table-column prop="next_expected_date" label="最早到货" width="110" />
            <el-table-column label="责任人" min-width="120">
              <template #default="{ row }">{{ row.owners?.join(' / ') || '-' }}</template>
            </el-table-column>
            <el-table-column prop="purchase_order_count" label="PO数" width="70" />
            <el-table-column label="缺件明细" min-width="260">
              <template #default="{ row }">
                {{ row.items?.slice(0, 3).map(it => `${it.material_code || it.material_name || it.part_number || '物料'}:${it.projected_shortage_qty || it.shortage_qty}${it.next_expected_date ? `(${it.next_expected_date})` : ''}`).join('；') || '-' }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="90" fixed="right">
              <template #default="{ row }">
                <el-button size="small" type="primary" link @click="emit('risk-drill', row)">钻取</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <el-tab-pane label="<el-icon><Histogram /></el-icon> 毛坯视图" name="raw-view">
        <el-row :gutter="12" style="margin-bottom: 12px">
          <el-col :span="8"><el-card shadow="hover"><div class="health-title">毛坯条目</div><div class="health-metric">{{ businessViews.summary?.raw_line_count || 0 }}</div><div class="health-sub">生产下料/材料准备视角</div></el-card></el-col>
          <el-col :span="8"><el-card shadow="hover"><div class="health-title">毛坯估价</div><div class="health-metric">¥{{ fmtMoney(businessViews.raw?.total_estimated_amount) }}</div><div class="health-sub">原材料毛坯成本基础</div></el-card></el-col>
          <el-col :span="8"><el-card shadow="hover"><div class="health-title">总重量</div><div class="health-metric">{{ businessViews.raw?.total_weight || 0 }} kg</div><div class="health-sub">按已维护重量字段汇总</div></el-card></el-col>
        </el-row>
        <el-table :data="businessViews.raw?.items || []" size="small" max-height="520">
          <el-table-column prop="material_code" label="物料编码" width="140" />
          <el-table-column prop="material_name" label="名称" min-width="160">
            <template #default="{ row }">{{ row.material_name || row.part_number || '-' }}</template>
          </el-table-column>
          <el-table-column prop="part_number" label="图号/型号" min-width="120" />
          <el-table-column prop="material_grade" label="材质" width="100" />
          <el-table-column prop="surface_treatment" label="表处" min-width="110" />
          <el-table-column prop="quantity" label="数量" width="80" />
          <el-table-column prop="unit" label="单位" width="70" />
          <el-table-column prop="weight" label="重量kg" width="90" />
          <el-table-column label="估价金额" width="110">
            <template #default="{ row }">¥{{ fmtMoney(row.estimated_amount) }}</template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="<el-icon><Money /></el-icon> 成本视图" name="cost-view">
        <el-row :gutter="12" style="margin-bottom: 12px">
          <el-col :span="8"><el-card shadow="hover"><div class="health-title">整机总成本</div><div class="health-metric">¥{{ fmtMoney(businessViews.cost?.total_cost) }}</div><div class="health-sub">以0级根节点累计成本为准</div></el-card></el-col>
          <el-col :span="8"><el-card shadow="hover"><div class="health-title">缺估价节点</div><div class="health-metric">{{ businessViews.summary?.missing_price_count || 0 }}</div><div class="health-sub">补齐后才能做更准确归集</div></el-card></el-col>
          <el-col :span="8"><el-card shadow="hover"><div class="health-title">成本分类数</div><div class="health-metric">{{ (businessViews.cost?.by_category || []).length }}</div><div class="health-sub">按物料分类归集成本</div></el-card></el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-card>
              <template #header><span>按分类成本</span></template>
              <el-table :data="businessViews.cost?.by_category || []" size="small" max-height="420">
                <el-table-column prop="category" label="分类" min-width="120" />
                <el-table-column prop="node_count" label="节点数" width="80" />
                <el-table-column prop="missing_price" label="缺价" width="70" />
                <el-table-column label="估价金额" width="120">
                  <template #default="{ row }">¥{{ fmtMoney(row.estimated_amount) }}</template>
                </el-table-column>
              </el-table>
            </el-card>
          </el-col>
          <el-col :span="12">
            <el-card>
              <template #header><span>高成本节点 TOP20</span></template>
              <el-table :data="businessViews.cost?.top_items || []" size="small" max-height="420">
                <el-table-column prop="material_code" label="编码" width="120" />
                <el-table-column label="名称" min-width="160">
                  <template #default="{ row }">{{ row.material_name || row.part_number || '-' }}</template>
                </el-table-column>
                <el-table-column prop="category" label="分类" width="100" />
                <el-table-column label="自身成本" width="110">
                  <template #default="{ row }">¥{{ fmtMoney(row.self_cost) }}</template>
                </el-table-column>
              </el-table>
            </el-card>
          </el-col>
        </el-row>
      </el-tab-pane>

      <el-tab-pane label="<el-icon><Tools /></el-icon> 工艺完整性" name="process-view">
        <el-row :gutter="12" style="margin-bottom: 12px">
          <el-col :span="6"><el-card shadow="hover"><div class="health-title">部件数</div><div class="health-metric">{{ businessViews.process?.summary?.component_count || 0 }}</div><div class="health-sub">按1级部件检查工艺闭环</div></el-card></el-col>
          <el-col :span="6"><el-card shadow="hover"><div class="health-title">完整数</div><div class="health-metric">{{ businessViews.process?.summary?.complete_count || 0 }}</div><div class="health-sub">有工序/工位/技能/工时</div></el-card></el-col>
          <el-col :span="6"><el-card shadow="hover"><div class="health-title">缺工序</div><div class="health-metric">{{ businessViews.process?.summary?.missing_route_count || 0 }}</div><div class="health-sub">尚未建立工艺路线的部件</div></el-card></el-col>
          <el-col :span="6"><el-card shadow="hover"><div class="health-title">缺工位</div><div class="health-metric">{{ businessViews.process?.summary?.missing_workstation_count || 0 }}</div><div class="health-sub">需要工位绑定才能排产</div></el-card></el-col>
        </el-row>
        <el-table :data="businessViews.process?.components || []" size="small" max-height="520">
          <el-table-column prop="component_name" label="部件/模组" min-width="180" />
          <el-table-column prop="part_number" label="图号" width="120" />
          <el-table-column label="状态" width="110">
            <template #default="{ row }"><el-tag size="small" :type="processTagType(row.process_status)">{{ processLabel(row.process_status) }}</el-tag></template>
          </el-table-column>
          <el-table-column prop="operation_count" label="工序数" width="80" />
          <el-table-column prop="estimated_hours" label="标准工时" width="90" />
          <el-table-column prop="standard_man_hours" label="标准工时(人时)" width="120" />
          <el-table-column prop="workstation_count" label="工位数" width="80" />
          <el-table-column prop="bom_operation_bound_count" label="BOM绑定工序" width="110" />
          <el-table-column label="缺口" min-width="220">
            <template #default="{ row }">{{ row.missing?.join('；') || '-' }}</template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- MESA #4: 图纸/文档 Tab -->
      <el-tab-pane label="<el-icon><Files /></el-icon> 图纸/文档" name="documents">
        <div style="display:flex; gap:8px; margin-bottom:12px; align-items:center">
          <el-select v-model="docFilter.bom_node_id" placeholder="全部 BOM 节点" clearable filterable size="small" style="width:220px">
            <el-option v-for="n in flat" :key="n.id" :label="n.part_number + ' ' + (n.material_name || '')" :value="n.id" />
          </el-select>
          <el-select v-model="docFilter.doc_type" placeholder="全部类型" clearable size="small" style="width:140px">
            <el-option label="<el-icon><TrendCharts /></el-icon> 图纸" value="drawing" />
            <el-option label="<el-icon><Document /></el-icon> SOP" value="sop" />
            <el-option label="<el-icon><Setting /></el-icon> 工艺" value="process" />
            <el-option label="<el-icon><Search /></el-icon> 检验标准" value="qc_std" />
            <el-option label="<el-icon><Edit /></el-icon> 其他" value="other" />
          </el-select>
          <el-button size="small" @click="emit('load-docs')" :loading="docLoading">刷新</el-button>
        </div>
        <el-table :data="bomDocs" size="small" max-height="360" empty-text="该设备暂无关联文档">
          <el-table-column prop="doc_code" label="编码" width="120" />
          <el-table-column prop="title" label="文档名称" min-width="180" />
          <el-table-column prop="doc_type" label="类型" width="80">
            <template #default="{ row }">
              <el-tag size="small">{{ docTypeLabel[row.doc_type] || row.doc_type }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="version" label="版本" width="60" />
          <el-table-column prop="bom_part_number" label="关联 BOM" width="120" />
          <el-table-column prop="status" label="状态" width="80">
            <template #default="{ row }">
              <el-tag size="small" :type="row.status === 'issued' ? 'success' : row.status === 'revoked' ? 'warning' : 'info'">{{ row.status }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="100">
            <template #default="{ row }">
              <el-button size="small" link @click="emit('download-doc', row)">下载</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  businessViews: any
  flat: any[]
  bomDocs: any[]
  docFilter: { bom_node_id: number | null; doc_type: string }
  docLoading: boolean
  docTypeLabel: Record<string, string>
}>()

const emit = defineEmits<{
  (event: 'load-docs'): void
  (event: 'download-doc', row: any): void
  (event: 'risk-drill', row: any): void
}>()

const assemblyMissingDocs = computed(() =>
  (props.businessViews.assembly?.components || []).reduce((sum: number, row: any) => sum + Number(row.missing_doc_count || 0), 0)
)

function fmtMoney(value: any) {
  return Number(value || 0).toFixed(2)
}

function processTagType(status: string) {
  if (status === 'success') return 'success'
  if (status === 'danger') return 'danger'
  return 'warning'
}

function processLabel(status: string) {
  if (status === 'success') return '完整'
  if (status === 'danger') return '缺工序'
  return '待完善'
}

function contractDiffTagType(status: string) {
  if (status === 'on_or_under_budget') return 'success'
  if (status === 'over_20pct') return 'danger'
  if (status === 'over_budget') return 'warning'
  return 'info'
}

function contractDiffLabel(status: string) {
  if (status === 'on_or_under_budget') return '预算内'
  if (status === 'over_20pct') return '超 20%'
  if (status === 'over_budget') return '超预算'
  return '待签合同'
}

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
</script>

<style scoped>
.health-title { font-size: 13px; color: var(--el-text-color-regular); margin-bottom: 8px; }
.health-metric { font-size: 18px; font-weight: 600; line-height: 1.4; }
.health-sub { font-size: 12px; color: var(--el-color-info); margin-top: 8px; min-height: 32px; }
</style>
