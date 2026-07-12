<template>
  <div class="page">
    <div class="page-header">
      <div>
        <div class="page-title"><el-icon><Avatar /></el-icon> 供应商协同</div>
        <div class="page-subtitle">评分 · 采购跟催 · 来料检验 · 外协进度</div>
      </div>
      <el-button @click="loadAll" :loading="loading">刷新</el-button>
    </div>

    <el-row :gutter="12" style="margin-bottom:12px">
      <el-col :span="4"><el-card shadow="hover" class="stat-card"><div class="stat-num">{{ data.overview.total_suppliers }}</div><div class="stat-label">供应商</div></el-card></el-col>
      <el-col :span="4"><el-card shadow="hover" class="stat-card"><div class="stat-num" style="color:var(--el-color-success)">{{ data.overview.a_grade }}</div><div class="stat-label">A 级</div></el-card></el-col>
      <el-col :span="4"><el-card shadow="hover" class="stat-card"><div class="stat-num" :style="{color: data.overview.active_tracking?'var(--el-color-warning)':''}">{{ data.overview.active_tracking }}</div><div class="stat-label">跟催中</div></el-card></el-col>
      <el-col :span="4"><el-card shadow="hover" class="stat-card"><div class="stat-num" :style="{color: data.overview.overdue_tracking?'var(--el-color-danger)':''}">{{ data.overview.overdue_tracking }}</div><div class="stat-label">已延期</div></el-card></el-col>
      <el-col :span="4"><el-card shadow="hover" class="stat-card"><div class="stat-num" :style="{color: data.overview.fail_inspections?'var(--el-color-danger)':''}">{{ data.overview.fail_inspections }}</div><div class="stat-label">来料不合格</div></el-card></el-col>
      <el-col :span="4"><el-card shadow="hover" class="stat-card"><div class="stat-num">{{ data.overview.active_outsource }}</div><div class="stat-label">外协进行中</div></el-card></el-col>
    </el-row>

    <el-tabs v-model="tab" type="border-card">
      <!-- Supplier List + Scores -->
      <el-tab-pane name="suppliers">
        <template #label>⭐ 供应商评分</template>
        <el-table :data="data.suppliers" size="small" stripe max-height="450">
          <el-table-column prop="supplier_name" label="供应商" min-width="160" />
          <el-table-column prop="contact_person" label="联系人" width="90" />
          <el-table-column prop="payment_terms" label="付款条件" width="100" />
          <el-table-column label="评分" width="200">
            <template #default="{row}">
              <span style="font-weight:700;font-size:16px;margin-right:8px" :style="{color: scoreColor(row.latest_score)}">{{ row.latest_score||'-' }}</span>
              <el-tag :type="gradeType(row.latest_grade)" size="small">{{ row.latest_grade||'-' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="订单/检验/外协" width="130">
            <template #default="{row}"><span style="font-size:12px;color:var(--el-color-info)">{{ row.po_count }} 单 / {{ row.inspection_count }} 检 / {{ row.outsource_count }} 外协</span></template>
          </el-table-column>
          <el-table-column prop="rating" label="等级" width="70"><template #default="{row}"><el-tag :type="gradeType(row.rating)" size="small">{{ row.rating }}</el-tag></template></el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- Score History -->
      <el-tab-pane name="scores">
        <template #label><el-icon><DataAnalysis /></el-icon> 评分历史</template>
        <el-table :data="data.scores" size="small" stripe max-height="450">
          <el-table-column prop="supplier_name" label="供应商" width="150" />
          <el-table-column prop="period" label="周期" width="100" />
          <el-table-column prop="delivery_score" label="交付" width="80" align="center"><template #default="{row}"><span :style="{color: row.delivery_score>=90?'var(--el-color-success)':row.delivery_score>=75?'var(--el-color-warning)':'var(--el-color-danger)'}">{{ row.delivery_score }}</span></template></el-table-column>
          <el-table-column prop="quality_score" label="质量" width="80" align="center"><template #default="{row}"><span :style="{color: row.quality_score>=90?'var(--el-color-success)':row.quality_score>=75?'var(--el-color-warning)':'var(--el-color-danger)'}">{{ row.quality_score }}</span></template></el-table-column>
          <el-table-column prop="service_score" label="服务" width="80" align="center" />
          <el-table-column prop="total_score" label="总分" width="80" align="center"><template #default="{row}"><b :style="{color: row.total_score>=90?'var(--el-color-success)':row.total_score>=75?'var(--el-color-warning)':'var(--el-color-danger)'}">{{ row.total_score }}</b></template></el-table-column>
          <el-table-column prop="grade" label="等级" width="70"><template #default="{row}"><el-tag :type="gradeType(row.grade)" size="small">{{ row.grade }}</el-tag></template></el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- Purchase Tracking -->
      <el-tab-pane name="tracking">
        <template #label><el-icon><Box /></el-icon> 采购跟催 <el-badge v-if="data.overview.active_tracking" :value="data.overview.active_tracking" type="warning" /></template>
        <el-table :data="data.tracking" size="small" stripe max-height="450">
          <el-table-column prop="item_name" label="物料" min-width="180" />
          <el-table-column prop="supplier" label="供应商" width="120" />
          <el-table-column prop="planned_delivery" label="计划到货" width="110" sortable />
          <el-table-column prop="delay_days" label="延期(天)" width="85"><template #default="{row}"><el-tag v-if="row.delay_days>0" type="danger" size="small">{{ row.delay_days }}天</el-tag><span v-else style="color:var(--el-color-success)">正常</span></template></el-table-column>
          <el-table-column prop="status" label="状态" width="90"><template #default="{row}"><el-tag :type="row.status==='following'?'warning':row.status==='delivered'?'success':'info'" size="small">{{ {following:'跟催中',delivered:'已到货',closed:'已关闭'}[row.status]||row.status }}</el-tag></template></el-table-column>
          <el-table-column prop="risk_level" label="风险" width="75"><template #default="{row}"><el-tag :type="row.risk_level==='critical'?'danger':row.risk_level==='high'?'warning':'info'" size="small">{{ {critical:'严重',high:'高',warning:'中'}[row.risk_level]||row.risk_level }}</el-tag></template></el-table-column>
          <el-table-column prop="owner_name" label="责任人" width="90" />
        </el-table>
      </el-tab-pane>

      <!-- Incoming Inspection -->
      <el-tab-pane name="inspections">
        <template #label><el-icon><Cpu /></el-icon> 来料检验 <el-badge v-if="data.overview.fail_inspections" :value="data.overview.fail_inspections" type="danger" /></template>
        <el-table :data="data.inspections" size="small" stripe max-height="450">
          <el-table-column prop="inspection_no" label="检验编号" width="140" />
          <el-table-column prop="supplier_name" label="供应商" width="130" />
          <el-table-column prop="material_name" label="物料" width="140" />
          <el-table-column prop="inspection_date" label="日期" width="110" />
          <el-table-column label="抽样/不良" width="100"><template #default="{row}">{{ row.sample_qty }}/{{ row.defect_qty }}</template></el-table-column>
          <el-table-column prop="result" label="结果" width="80"><template #default="{row}"><el-tag :type="row.result==='pass'?'success':row.result==='fail'?'danger':'warning'" size="small">{{ {pass:'合格',fail:'不合格',pending:'待检'}[row.result]||row.result }}</el-tag></template></el-table-column>
          <el-table-column prop="defect_desc" label="缺陷描述" min-width="160" />
          <el-table-column prop="disposition" label="处置" width="80"><template #default="{row}"><el-tag size="small">{{ {return:'退货',accept:'让步接收',rework:'返工'}[row.disposition]||row.disposition||'-' }}</el-tag></template></el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- Outsourcing -->
      <el-tab-pane name="outsource">
        <template #label><el-icon><OfficeBuilding /></el-icon> 外协进度</template>
        <el-table :data="data.outsource" size="small" stripe max-height="450">
          <el-table-column prop="outsource_no" label="编号" width="140" />
          <el-table-column prop="supplier_name" label="供应商" width="130" />
          <el-table-column prop="item_name" label="项目" min-width="150" />
          <el-table-column prop="process_name" label="工序" width="100" />
          <el-table-column prop="planned_finish" label="计划完成" width="110" />
          <el-table-column prop="status" label="状态" width="90"><template #default="{row}"><el-tag :type="row.status==='completed'?'success':row.status==='in_progress'?'warning':'info'" size="small">{{ {planned:'计划中',in_progress:'进行中',completed:'已完成',delayed:'延期'}[row.status]||row.status }}</el-tag></template></el-table-column>
          <el-table-column prop="quality_status" label="质量" width="80"><template #default="{row}"><el-tag :type="row.quality_status==='pass'?'success':row.quality_status==='fail'?'danger':'warning'" size="small">{{ {pass:'合格',fail:'不合格',pending:'待检'}[row.quality_status]||row.quality_status }}</el-tag></template></el-table-column>
          <el-table-column prop="contract_amount" label="金额(元)" width="100" align="right"><template #default="{row}">{{ row.contract_amount?.toLocaleString() }}</template></el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from "vue"
import Api from "../api"

const loading = ref(false)
const tab = ref("suppliers")
const data = reactive({ overview: {} as any, suppliers: [] as any[], scores: [] as any[], tracking: [] as any[], inspections: [] as any[], orders: [] as any[], outsource: [] as any[] })

const scoreColor = (s: number) => s >= 90 ? "var(--el-color-success)" : s >= 75 ? "var(--el-color-warning)" : "var(--el-color-danger)"
const gradeType = (g: string) => g === "A" ? "success" : g === "B" ? "" : g === "C" ? "warning" : "danger"

async function loadAll() {
  loading.value = true
  try {
    const res = await Api.get("/supplier/dashboard")
    Object.assign(data, res)
  } finally { loading.value = false }
}

onMounted(loadAll)
</script>

<style scoped>
.page { padding: 16px; }
.page-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 12px; }
.page-title { font-size: 20px; font-weight: 700; }
.page-subtitle { color: var(--color-text-muted); margin-top: 4px; font-size: 13px; }
.stat-card { text-align: center; }
.stat-num { font-size: 28px; font-weight: 700; color: var(--el-text-color-primary); }
.stat-label { font-size: 13px; color: var(--el-color-info); margin-top: 4px; }
</style>
