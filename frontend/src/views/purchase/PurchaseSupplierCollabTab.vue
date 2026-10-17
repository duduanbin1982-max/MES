<template>
      <!-- ===== Tab 4: 供应商协同 ===== -->
      <el-tab-pane label="供应商协同" name="collab">
        <el-row :gutter="12" style="margin-bottom: 12px">
          <el-col :span="8">
            <el-card shadow="never">
              <el-statistic title="来料检验" :value="collabOverview.incoming?.total || 0">
                <template #suffix><el-tag :type="(collabOverview.incoming?.failed || 0) > 0 ? 'danger' : 'success'" size="small">不良 {{ collabOverview.incoming?.failed || 0 }}</el-tag></template>
              </el-statistic>
            </el-card>
          </el-col>
          <el-col :span="8">
            <el-card shadow="never">
              <el-statistic title="外协订单" :value="collabOverview.outsourcing?.total || 0">
                <template #suffix><el-tag type="warning" size="small">未完成 {{ collabOverview.outsourcing?.open || 0 }}</el-tag></template>
              </el-statistic>
            </el-card>
          </el-col>
          <el-col :span="8">
            <el-card shadow="never">
              <el-statistic title="低分供应商" :value="collabOverview.weakest_suppliers?.length || 0">
                <template #suffix><el-tag type="info" size="small">自动评分</el-tag></template>
              </el-statistic>
            </el-card>
          </el-col>
        </el-row>

        <el-card shadow="never" style="margin-bottom: 12px">
          <template #header><strong>来料检验闭环</strong></template>
          <el-form :inline="true" :model="incomingForm">
            <el-form-item label="待检收货">
              <el-select v-model="incomingForm.receiving_id" filterable placeholder="选择采购收货批次" style="width: 360px" @change="selectReceiving">
                <el-option v-for="row in pendingReceipts" :key="row.receiving_id" :label="`${row.po_no} / ${row.material_code} ${row.material_name} / ${row.lot_no}`" :value="row.receiving_id" />
              </el-select>
            </el-form-item>
            <el-form-item label="供应商"><el-input :model-value="selectedReceipt?.supplier_name || '-'" disabled style="width: 180px" /></el-form-item>
            <el-form-item label="物料"><el-input :model-value="selectedReceipt ? `${selectedReceipt.material_code} ${selectedReceipt.material_name}` : '-'" disabled style="width: 220px" /></el-form-item>
            <el-form-item label="批次"><el-input :model-value="selectedReceipt?.lot_no || '-'" disabled style="width: 130px" /></el-form-item>
            <el-form-item label="结果">
              <el-select v-model="incomingForm.result" style="width: 100px">
                <el-option label="合格" value="pass" />
                <el-option label="不合格" value="fail" />
              </el-select>
            </el-form-item>
            <el-form-item label="抽检"><el-input-number v-model="incomingForm.sample_qty" :min="0" style="width: 100px" /></el-form-item>
            <el-form-item label="不良"><el-input-number v-model="incomingForm.defect_qty" :min="0" style="width: 100px" /></el-form-item>
            <el-form-item label="缺陷"><el-input v-model="incomingForm.defect_desc" placeholder="不合格说明" style="width: 180px" /></el-form-item>
            <el-form-item><el-button type="primary" :loading="collabLoading" @click="emit('save-incoming-inspection')">登记检验</el-button></el-form-item>
          </el-form>
          <el-table :data="incomingInspections" size="small" max-height="240" stripe>
            <el-table-column prop="inspection_no" label="检验单" width="140" />
            <el-table-column prop="supplier_name" label="供应商" min-width="150" />
            <el-table-column label="物料" min-width="180"><template #default="{ row }">{{ row.material_code }} {{ row.material_name }}</template></el-table-column>
            <el-table-column prop="lot_no" label="批次" width="120" />
            <el-table-column label="结果" width="90"><template #default="{ row }"><el-tag :type="row.result === 'fail' ? 'danger' : 'success'" size="small">{{ row.result === 'fail' ? '不合格' : '合格' }}</el-tag></template></el-table-column>
            <el-table-column prop="defect_qty" label="不良数" width="80" />
            <el-table-column label="NCR" width="90"><template #default="{ row }"><el-tag v-if="row.ncr_id" type="danger" size="small">#{{ row.ncr_id }}</el-tag><span v-else>-</span></template></el-table-column>
          </el-table>
        </el-card>

        <el-card shadow="never" style="margin-bottom: 12px">
          <template #header><strong>外协进度</strong></template>
          <el-form :inline="true" :model="outsourceForm">
            <el-form-item label="供应商">
              <el-select v-model="outsourceForm.supplier_id" filterable placeholder="供应商" style="width: 180px">
                <el-option v-for="s in suppliers" :key="s.id" :label="supplierName(s)" :value="s.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="外协件"><el-input v-model="outsourceForm.item_name" placeholder="零件/组件名称" style="width: 180px" /></el-form-item>
            <el-form-item label="工序"><el-input v-model="outsourceForm.process_name" placeholder="加工/热处理/喷涂" style="width: 150px" /></el-form-item>
            <el-form-item label="计划完成"><el-date-picker v-model="outsourceForm.planned_finish" type="date" value-format="YYYY-MM-DD" style="width: 140px" /></el-form-item>
            <el-form-item label="金额"><el-input-number v-model="outsourceForm.contract_amount" :min="0" :precision="2" style="width: 130px" /></el-form-item>
            <el-form-item><el-button type="primary" :loading="collabLoading" @click="emit('save-outsource-order')">新增外协</el-button></el-form-item>
          </el-form>
          <el-table :data="outsourcingOrders" size="small" max-height="240" stripe>
            <el-table-column prop="outsource_no" label="外协单" width="140" />
            <el-table-column prop="supplier_name" label="供应商" min-width="150" />
            <el-table-column prop="item_name" label="外协件" min-width="160" />
            <el-table-column prop="process_name" label="工序" width="120" />
            <el-table-column prop="planned_finish" label="计划完成" width="110" />
            <el-table-column label="进度" width="160"><template #default="{ row }"><el-progress :percentage="Number(row.progress_pct || 0)" /></template></el-table-column>
            <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="outsourceStatusTag(row.status)" size="small">{{ outsourceStatusLabel(row.status) }}</el-tag></template></el-table-column>
            <el-table-column label="质量" width="90"><template #default="{ row }"><el-tag :type="row.quality_status === 'fail' ? 'danger' : row.quality_status === 'pass' ? 'success' : 'info'" size="small">{{ row.quality_status || 'pending' }}</el-tag></template></el-table-column>
            <el-table-column label="操作" width="180" fixed="right"><template #default="{ row }">
              <el-button size="small" @click="emit('update-outsource', row, { progress_pct: Math.min(100, Number(row.progress_pct || 0) + 25), status: Number(row.progress_pct || 0) + 25 >= 100 ? 'completed' : 'processing' })">推进</el-button>
              <el-button size="small" type="success" @click="emit('update-outsource', row, { progress_pct: 100, status: 'completed', quality_status: 'pass' })">完成</el-button>
              <el-button size="small" type="danger" @click="emit('update-outsource', row, { quality_status: 'fail' })">不良</el-button>
            </template></el-table-column>
          </el-table>
        </el-card>

        <el-card shadow="never">
          <template #header><strong>供应商质量评分卡</strong></template>
          <el-table :data="scorecards" size="small" max-height="300" stripe>
            <el-table-column prop="supplier_name" label="供应商" min-width="160" />
            <el-table-column prop="period" label="期间" width="90" />
            <el-table-column label="等级" width="80"><template #default="{ row }"><el-tag :type="scoreGradeTag(row.grade)" size="small">{{ row.grade }}</el-tag></template></el-table-column>
            <el-table-column prop="total_score" label="总分" width="80" />
            <el-table-column prop="delivery_score" label="交付" width="80" />
            <el-table-column prop="quality_score" label="质量" width="80" />
            <el-table-column prop="service_score" label="服务" width="80" />
            <el-table-column label="指标" min-width="260"><template #default="{ row }">
              <span>PO {{ row.metrics?.po?.total_po || 0 }}，来料检验 {{ row.metrics?.incoming?.total_inspections || 0 }}，外协 {{ row.metrics?.outsource?.total_outsource || 0 }}</span>
            </template></el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  collabOverview: any
  pendingReceipts: any[]
  suppliers: any[]
  supplierName: (row: any) => string
  materials: any[]
  collabLoading: boolean
  incomingInspections: any[]
  outsourcingOrders: any[]
  scorecards: any[]
  outsourceStatusTag: (value: string) => string
  outsourceStatusLabel: (value: string) => string
  scoreGradeTag: (value: string) => string
}>()
// 2026-10-17（前端 eslint 棘轮）：被模板改写的对象 prop 改为 defineModel，
// 父组件用 v-model:xxx 绑定；改的仍是父组件同一对象，行为不变。
const incomingForm = defineModel<any>('incomingForm', { required: true })
const outsourceForm = defineModel<any>('outsourceForm', { required: true })


const selectedReceipt = computed(() => props.pendingReceipts.find((row) => Number(row.receiving_id) === Number(incomingForm.value.receiving_id)))

function selectReceiving(receivingId: number) {
  const receipt = props.pendingReceipts.find((row) => Number(row.receiving_id) === Number(receivingId))
  if (!receipt) return
  Object.assign(incomingForm.value, {
    purchase_order_id: receipt.purchase_order_id,
    supplier_id: receipt.supplier_id,
    material_id: receipt.material_id,
    lot_no: receipt.lot_no,
  })
}

const emit = defineEmits<{
  (event: 'save-incoming-inspection'): void
  (event: 'save-outsource-order'): void
  (event: 'update-outsource', row: any, patch: any): void
}>()
</script>
