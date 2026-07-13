<template>
  <div class="page">
    <div class="page-header">
      <div>
        <div class="page-title">设计变更 ECO</div>
        <div class="page-subtitle">变更申请、审批流转与影响分析</div>
      </div>
      <el-button :icon="Refresh" size="small" :loading="loading" @click="loadAll">刷新</el-button>
    </div>

    <el-card>
      <template #header>
        <div class="toolbar">
          <span>ECO 清单</span>
          <el-select v-model="instanceId" placeholder="选择装备实例" size="small" style="width: 260px" @change="loadAll">
            <el-option v-for="i in instances" :key="i.id" :label="`${i.instance_code} ${i.instance_name}`" :value="i.id" />
          </el-select>
        </div>
      </template>
      <el-table :data="ecos" size="small" height="650">
        <el-table-column prop="eco_no" label="ECO 编号" width="150" />
        <el-table-column prop="title" label="标题" min-width="220" show-overflow-tooltip />
        <el-table-column prop="reason" label="原因" min-width="220" show-overflow-tooltip />
        <el-table-column prop="affected_scope" label="影响范围" min-width="180" show-overflow-tooltip />
        <el-table-column label="状态" width="100">
          <template #default="{ row }"><el-tag size="small">{{ row.status || 'open' }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="effective_date" label="生效日期" width="120">
          <template #default="{ row }">{{ shortDate(row.effective_date) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="210" fixed="right">
          <template #default="{ row }">
            <el-button link size="small" @click="openImpact(row)">影响分析</el-button>
            <el-button link size="small" @click="transit(row, 'approve')">审批</el-button>
            <el-button link size="small" @click="transit(row, 'close')">关闭</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-drawer v-model="impactVisible" title="ECO 影响分析" size="70%">
      <template v-if="impact">
        <el-descriptions :column="3" border size="small">
          <el-descriptions-item label="ECO">{{ impact.eco.eco_no }}</el-descriptions-item>
          <el-descriptions-item label="标题">{{ impact.eco.title }}</el-descriptions-item>
          <el-descriptions-item label="风险">
            <el-tag :type="severityTag(impact.summary.severity)" size="small">{{ severityLabel(impact.summary.severity) }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="影响范围" :span="3">{{ impact.eco.affected_scope || '-' }}</el-descriptions-item>
        </el-descriptions>

        <el-row :gutter="12" class="impact-kpis">
          <el-col v-for="k in kpis" :key="k.key" :span="3">
            <el-card class="mini-card">
              <div class="mini-label">{{ k.label }}</div>
              <div class="mini-value">{{ impact.summary[k.key] || 0 }}</div>
            </el-card>
          </el-col>
        </el-row>

        <el-alert v-for="r in impact.risks" :key="r.message" :title="r.message" :type="severityTag(r.severity)" show-icon :closable="false" class="risk-alert" />

        <el-card class="recommend-card">
          <template #header>处理建议</template>
          <ol class="recommend-list">
            <li v-for="r in impact.recommendations" :key="r">{{ r }}</li>
          </ol>
        </el-card>

        <el-tabs>
          <el-tab-pane label="BOM">
            <el-table :data="impact.impact.bom" size="small" height="320">
              <el-table-column prop="part_number" label="图号/物料" min-width="180" />
              <el-table-column prop="quantity" label="数量" width="90" />
              <el-table-column prop="version" label="版本" width="90" />
              <el-table-column prop="category" label="分类" width="120" />
              <el-table-column label="关键件" width="90"><template #default="{ row }">{{ row.is_key_component ? '是' : '否' }}</template></el-table-column>
            </el-table>
          </el-tab-pane>
          <el-tab-pane label="图纸">
            <el-table :data="impact.impact.documents" size="small" height="320">
              <el-table-column prop="doc_code" label="编码" width="150" />
              <el-table-column prop="title" label="标题" min-width="220" />
              <el-table-column prop="version" label="版本" width="90" />
              <el-table-column prop="status" label="状态" width="100" />
            </el-table>
          </el-tab-pane>
          <el-tab-pane label="采购">
            <el-table :data="impact.impact.purchase_orders" size="small" height="320">
              <el-table-column prop="po_no" label="采购单" width="150" />
              <el-table-column prop="status" label="状态" width="100" />
              <el-table-column prop="expected_date" label="预计到货" width="130" />
              <el-table-column prop="total_amount" label="金额" width="120" />
            </el-table>
          </el-tab-pane>
          <el-tab-pane label="工单">
            <el-table :data="impact.impact.work_orders" size="small" height="320">
              <el-table-column prop="wo_code" label="工单" width="160" />
              <el-table-column prop="title" label="标题" min-width="220" />
              <el-table-column prop="status" label="状态" width="100" />
              <el-table-column prop="planned_end" label="计划完成" width="130" />
            </el-table>
          </el-tab-pane>
          <el-tab-pane label="库存/质量/成本">
            <el-row :gutter="12">
              <el-col :span="8"><el-table :data="impact.impact.inventory" size="small" height="300"><el-table-column prop="material_code" label="物料" /><el-table-column prop="quantity" label="库存" width="90" /></el-table></el-col>
              <el-col :span="8"><el-table :data="impact.impact.quality" size="small" height="300"><el-table-column prop="wo_code" label="工单" /><el-table-column prop="result" label="结果" width="90" /></el-table></el-col>
              <el-col :span="8"><el-table :data="impact.impact.costs" size="small" height="300"><el-table-column prop="entry_no" label="凭证" /><el-table-column prop="debit_amount" label="借方" width="90" /></el-table></el-col>
            </el-row>
          </el-tab-pane>
        </el-tabs>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { Api } from '../api'

const loading = ref(false)
const impactLoading = ref(false)
const impactVisible = ref(false)
const instances = ref<any[]>([])
const instanceId = ref<number | null>(null)
const ecos = ref<any[]>([])
const impact = ref<any | null>(null)
const kpis = [
  { key: 'bom', label: 'BOM' },
  { key: 'documents', label: '图纸' },
  { key: 'purchase_orders', label: '采购' },
  { key: 'inventory', label: '库存' },
  { key: 'work_orders', label: '工单' },
  { key: 'quality', label: '质检' },
  { key: 'costs', label: '成本' },
  { key: 'risks', label: '风险' }
]

function shortDate(v?: string) { return v ? String(v).slice(0, 10) : '-' }
function severityTag(s: string) { return s === 'critical' || s === 'high' ? 'error' : s === 'warning' ? 'warning' : 'info' }
function severityLabel(s: string) { return ({ critical: '严重', high: '高', warning: '中', info: '低' } as any)[s] || s }

async function loadAll() {
  loading.value = true
  try {
    const list: any = await Api.instances()
    instances.value = list.items || list.rows || list || []
    if (!instanceId.value && instances.value.length) instanceId.value = instances.value[0].id
    if (instanceId.value) {
      ecos.value = await Api.get(`/equipment_instances/${instanceId.value}/eco`) as any[]
    }
  } finally {
    loading.value = false
  }
}

async function openImpact(row: any) {
  impactVisible.value = true
  impactLoading.value = true
  try {
    impact.value = await Api.ecoImpact(row.id)
  } finally {
    impactLoading.value = false
  }
}

async function transit(row: any, action: string) {
  try {
    await Api.post(`/instance_eco/${row.id}/transit`, { action, comment: `ECO ${action}` })
    ElMessage.success('状态已更新')
    await loadAll()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e?.message || '状态更新失败')
  }
}

onMounted(loadAll)
</script>

<style scoped>
.page-subtitle { color: var(--el-text-color-secondary); font-size: 13px; margin-top: 4px; }
.toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.impact-kpis { margin: 16px 0; }
.mini-card { min-height: 78px; }
.mini-label { color: var(--el-text-color-secondary); font-size: 12px; }
.mini-value { font-size: 24px; font-weight: 700; margin-top: 8px; }
.risk-alert { margin-bottom: 8px; }
.recommend-card { margin: 14px 0; }
.recommend-list { margin: 0; padding-left: 18px; line-height: 1.9; }
</style>
