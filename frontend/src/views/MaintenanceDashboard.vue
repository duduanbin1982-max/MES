<template>
  <div class="page">
    <PageToolbar class="page-header">
      <div>
        <div class="page-title"><el-icon><Tools /></el-icon> 项目装备维护</div>
        <div class="page-subtitle">TBM 项目装备维保计划、故障报修、备件、点检与现场服务（车间设备维护请到设备台账/点检TPM）</div>
      </div>
      <div style="display:flex;gap:8px;">
        <el-select v-model="filterInstanceId" clearable placeholder="筛选装备实例" style="width:240px" @change="loadAll">
          <el-option v-for="inst in data.instances" :key="inst.id" :label="inst.instance_name" :value="inst.id" />
        </el-select>
        <el-button @click="loadAll" :loading="loading">刷新</el-button>
      </div>
    </PageToolbar>

    <!-- Overview Cards -->
    <el-row :gutter="12" style="margin-bottom:12px">
      <el-col :span="4">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-num">{{ data.overview.total_plans }}</div>
          <div class="stat-label">维保计划</div>
          <div class="stat-sub" v-if="data.overview.overdue_plans" style="color:var(--el-color-warning)">{{ data.overview.overdue_plans }} 逾期</div>
        </el-card>
      </el-col>
      <el-col :span="4">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-num" style="color:var(--el-color-primary)">{{ data.overview.due_soon_plans }}</div>
          <div class="stat-label">7天内到期</div>
        </el-card>
      </el-col>
      <el-col :span="4">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-num" :style="{color: data.overview.open_breakdowns?'var(--el-color-danger)':''}">{{ data.overview.total_breakdowns }}</div>
          <div class="stat-label">故障报修</div>
          <div class="stat-sub" v-if="data.overview.open_breakdowns" style="color:var(--el-color-danger)">{{ data.overview.open_breakdowns }} 待处理</div>
        </el-card>
      </el-col>
      <el-col :span="4">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-num">{{ data.overview.total_spare_parts }}</div>
          <div class="stat-label">备件库存</div>
          <div class="stat-sub" v-if="data.overview.low_stock_parts" style="color:var(--el-color-warning)">{{ data.overview.low_stock_parts }} 低库存</div>
        </el-card>
      </el-col>
      <el-col :span="4">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-num">{{ data.overview.total_logs }}</div>
          <div class="stat-label">维保记录</div>
        </el-card>
      </el-col>
      <el-col :span="4">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-num" :style="{color: data.overview.active_field_services?'var(--el-color-primary)':''}">{{ data.overview.active_field_services }}</div>
          <div class="stat-label">现场服务中</div>
        </el-card>
      </el-col>
    </el-row>

    <el-tabs v-model="tab" type="border-card">
      <!-- Plans -->
      <el-tab-pane name="plans">
        <template #label><el-icon><Document /></el-icon> 维保计划 <el-badge v-if="data.overview.overdue_plans" :value="data.overview.overdue_plans" type="danger" /></template>
        <el-table :data="data.plans" size="small" stripe max-height="400">
          <el-table-column prop="plan_code" label="编号" width="100" />
          <el-table-column prop="plan_name" label="名称" min-width="160" />
          <el-table-column prop="maintenance_type" label="类型" width="85">
            <template #default="{row}"><el-tag size="small">{{ typeLabel(row.maintenance_type) }}</el-tag></template>
          </el-table-column>
          <el-table-column prop="next_due_date" label="下次到期" width="110" sortable />
          <el-table-column label="状态" width="100">
            <template #default="{row}">
              <el-tag v-if="row.status==='completed'" type="success" size="small">已完成</el-tag>
              <el-tag v-else-if="isOverdue(row)" type="danger" size="small">逾期</el-tag>
              <el-tag v-else-if="isDueSoon(row)" type="warning" size="small">即将到期</el-tag>
              <el-tag v-else type="info" size="small">待执行</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="120" fixed="right">
            <template #default="{row}">
              <el-button v-if="row.status!=='completed'" size="small" type="primary" @click="completePlan(row)">完成</el-button>
              <span v-else style="color:var(--el-color-success)"><el-icon><Select /></el-icon></span>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- Breakdowns -->
      <el-tab-pane name="breakdowns">
        <template #label><el-icon><Warning /></el-icon> 故障报修 <el-badge v-if="data.overview.open_breakdowns" :value="data.overview.open_breakdowns" type="danger" /></template>
        <el-table :data="data.breakdowns" size="small" stripe max-height="400">
          <el-table-column prop="report_code" label="编号" width="110" />
          <el-table-column prop="fault_type" label="故障类型" width="100"><template #default="{row}"><el-tag size="small">{{ row.fault_type }}</el-tag></template></el-table-column>
          <el-table-column prop="fault_desc" label="描述" min-width="180" />
          <el-table-column prop="severity" label="严重度" width="85">
            <template #default="{row}"><el-tag :type="sevType(row.severity)" size="small">{{ sevLabel(row.severity) }}</el-tag></template>
          </el-table-column>
          <el-table-column prop="status" label="状态" width="90">
            <template #default="{row}"><el-tag :type="bdStatusType(row.status)" size="small">{{ bdStatusLabel(row.status) }}</el-tag></template>
          </el-table-column>
          <el-table-column prop="downtime_hours" label="停机(h)" width="80" />
          <el-table-column prop="reported_at" label="报修时间" width="160" />
        </el-table>
      </el-tab-pane>

      <!-- Spare Parts -->
      <el-tab-pane name="spares">
        <template #label><el-icon><Tools /></el-icon> 备件库存 <el-badge v-if="data.overview.low_stock_parts" :value="data.overview.low_stock_parts" type="warning" /></template>
        <el-alert v-if="data.low_stock.length" :title="'低库存预警：' + data.low_stock.map(function(s){return s.part_name}).join('、')" type="warning" show-icon :closable="false" style="margin-bottom:12px" />
        <el-table :data="data.spare_parts" size="small" stripe max-height="400">
          <el-table-column prop="part_code" label="编码" width="110" />
          <el-table-column prop="part_name" label="名称" min-width="140" />
          <el-table-column prop="part_type" label="类型" width="90" />
          <el-table-column label="库存" width="160">
            <template #default="{row}">
              <span :style="{color: row.quantity<=row.min_stock?'var(--el-color-danger)':''}">{{ row.quantity }} / {{ row.min_stock }}</span>
              <el-progress :percentage="calcStockPct(row)" :color="row.quantity<=row.min_stock?'var(--el-color-danger)':'var(--el-color-success)'" :show-text="false" style="width:60px;display:inline-block;margin-left:6px" />
            </template>
          </el-table-column>
          <el-table-column prop="location" label="库位" width="90" />
          <el-table-column prop="supplier" label="供应商" width="110" />
        </el-table>
      </el-tab-pane>

      <!-- Logs -->
      <el-tab-pane name="logs">
        <template #label><el-icon><Edit /></el-icon> 维保记录</template>
        <el-table :data="data.logs" size="small" stripe max-height="400">
          <el-table-column prop="instance_name" label="装备" width="160" />
          <el-table-column prop="performed_at" label="执行时间" width="160" />
          <el-table-column prop="actions_taken" label="处理措施" min-width="200" />
          <el-table-column prop="findings" label="检查发现" width="150" />
          <el-table-column prop="hours_spent" label="工时(h)" width="80" />
          <el-table-column prop="status" label="状态" width="90"><template #default="{row}"><el-tag type="success" size="small">{{ row.status }}</el-tag></template></el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- Checklists -->
      <el-tab-pane name="checklists">
        <template #label><el-icon><DocumentChecked /></el-icon> 点检表</template>
        <el-table :data="data.checklists" size="small" stripe max-height="400">
          <el-table-column prop="checklist_name" label="点检表" min-width="180" />
          <el-table-column prop="equipment_instance_id" label="项目装备ID" width="120" />
          <el-table-column prop="check_type" label="类型" width="100" />
          <el-table-column label="检查项" width="90"><template #default="{row}">{{ (() => { try { return JSON.parse(row.items_json || '[]').length } catch { return 0 } })() }}</template></el-table-column>
          <el-table-column prop="status" label="状态" width="90" />
          <el-table-column prop="created_at" label="创建时间" width="160" />
        </el-table>
      </el-tab-pane>

      <!-- Field Service -->
      <el-tab-pane name="field">
        <template #label><el-icon><Van /></el-icon> 现场服务</template>
        <el-table :data="data.field_services" size="small" stripe max-height="400">
          <el-table-column prop="title" label="标题" min-width="160" />
          <el-table-column prop="service_type" label="类型" width="100"><template #default="{row}"><el-tag size="small">{{ svcTypeLabel(row.service_type) }}</el-tag></template></el-table-column>
          <el-table-column prop="priority" label="优先级" width="80"><template #default="{row}"><el-tag :type="row.priority==='urgent'?'danger':'info'" size="small">{{ priLabel(row.priority) }}</el-tag></template></el-table-column>
          <el-table-column prop="status" label="状态" width="90"><template #default="{row}"><el-tag :type="fsStatusType(row.status)" size="small">{{ fsStatusLabel(row.status) }}</el-tag></template></el-table-column>
          <el-table-column prop="reported_date" label="日期" width="160" />
        </el-table>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from "vue"
import { ElMessage, ElMessageBox } from "element-plus"
import Api from "../api"

const loading = ref(false)
const tab = ref("plans")
const filterInstanceId = ref(null as any)

const data = reactive({
  overview: { total_plans:0, overdue_plans:0, due_soon_plans:0, open_breakdowns:0, total_breakdowns:0, low_stock_parts:0, total_spare_parts:0, total_logs:0, total_checklists:0, active_field_services:0 },
  plans: [] as any[], breakdowns: [] as any[], spare_parts: [] as any[], low_stock: [] as any[], logs: [] as any[], checklists: [] as any[], field_services: [] as any[], instances: [] as any[]
})

// Helper functions
const typeLabel = (v: string) => ({ routine:"日常", weekly:"周检", monthly:"月检", quarterly:"季检", yearly:"年检" } as any)[v] || v
const sevLabel = (v: string) => ({ critical:"严重", high:"高", medium:"中", low:"低" } as any)[v] || v
const sevType = (v: string) => v==="critical"||v==="high"?"danger":v==="medium"?"warning":"info"
const bdStatusLabel = (v: string) => ({ open:"待处理", in_progress:"处理中", completed:"已完成", closed:"已关闭" } as any)[v] || v
const bdStatusType = (v: string) => v==="open"?"danger":v==="in_progress"?"warning":"success"
const svcTypeLabel = (v: string) => ({ assembly:"装配", commissioning:"调试", warranty:"质保", repair:"维修" } as any)[v] || v
const priLabel = (v: string) => ({ low:"低", normal:"中", urgent:"紧急" } as any)[v] || v
const fsStatusLabel = (v: string) => ({ open:"待处理", assigned:"已指派", in_progress:"进行中", resolved:"已解决", closed:"已关闭" } as any)[v] || v
const fsStatusType = (v: string) => v==="open"?"info":v==="in_progress"?"warning":v==="resolved"||v==="closed"?"success":"info"

function isOverdue(row: any) {
  return row.next_due_date && row.next_due_date < new Date().toISOString().slice(0,10) && row.status !== "completed"
}
function isDueSoon(row: any) {
  if (!row.next_due_date || row.status === "completed") return false
  const due = new Date(row.next_due_date)
  const soon = new Date(Date.now() + 7*86400000)
  return due >= new Date() && due <= soon
}
function calcStockPct(row: any) {
  return Math.min(100, Math.round(row.quantity / Math.max(row.min_stock,1) * 50))
}

async function loadAll() {
  loading.value = true
  try {
    const params: any = {}
    if (filterInstanceId.value) params.instance_id = filterInstanceId.value
    const res = await Api.get("/maintenance/dashboard", { params })
    Object.assign(data, res)
  } finally { loading.value = false }
}

async function completePlan(row: any) {
  try {
    const { value: actions } = await ElMessageBox.prompt("处理措施", "完成维保 " + row.plan_name, { inputType: "textarea" })
    await Api.post("/maintenance/plans/" + row.id + "/complete", {
      performed_by: 1, hours_spent: 1, actions_taken: actions || "维保完成"
    })
    ElMessage.success("维保已完成")
    await loadAll()
  } catch (e: any) {
    if (e !== "cancel" && e !== "close") ElMessage.error(e.message || "操作失败")
  }
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
.stat-sub { font-size: 12px; margin-top: 2px; }
</style>
