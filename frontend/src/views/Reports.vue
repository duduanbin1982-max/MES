<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title">📊 报表中心</div>
      <el-button @click="load">刷新</el-button>
    </div>
    <el-row :gutter="16">
      <el-col :span="6">
        <el-card>
          <div class="stat-card">
            <div class="stat-label">装备实例数</div>
            <div class="stat-value">{{ dash.instances?.total || 0 }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card>
          <div class="stat-card">
            <div class="stat-label">BOM 节点</div>
            <div class="stat-value">{{ dash.bom_total || 0 }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card>
          <div class="stat-card">
            <div class="stat-label">工单总数</div>
            <div class="stat-value">{{ dash.work_orders?.total || 0 }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card>
          <div class="stat-card">
            <div class="stat-label">关键外购件</div>
            <div class="stat-value">{{ dash.key_components || 0 }}</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-tabs v-model="tab" style="margin-top: 16px">
      <el-tab-pane label="实例报表" name="instances">
        <el-card>
          <el-button-group>
              <el-button type="success" @click="exportCSV('instances', instances)">⬇ CSV</el-button>
              <el-button type="primary" @click="exportExcel('instances', instances)">⬇ Excel</el-button>
              <el-button type="danger" @click="exportPDF('instances', instances, [
                {header: '编号', dataKey: 'instance_code'},
                {header: '名称', dataKey: 'instance_name'},
                {header: '类型', dataKey: 'type_name'},
                {header: '客户', dataKey: 'customer_name'},
                {header: '状态', dataKey: 'status'},
                {header: '金额(万)', dataKey: 'contract_amount'},
                {header: '计划开始', dataKey: 'planned_start'},
                {header: '计划结束', dataKey: 'planned_end'}
              ])">⬇ PDF</el-button>
            </el-button-group>
          <el-table :data="instances" stripe size="small" style="margin-top: 12px">
            <el-table-column prop="instance_code" label="编号" width="140" />
            <el-table-column prop="instance_name" label="名称" min-width="200" />
            <el-table-column prop="type_name" label="类型" width="120" />
            <el-table-column prop="customer_name" label="客户" width="140" />
            <el-table-column prop="status" label="状态" width="100" />
            <el-table-column prop="contract_amount" label="金额(万)" width="100" />
            <el-table-column label="工期" min-width="200">
              <template #default="{ row }">{{ row.planned_start }} → {{ row.planned_end }}</template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>
      <el-tab-pane label="工单报表" name="wo">
        <el-card>
          <el-button type="success" @click="exportCSV('work_orders', workOrders)">⬇ 导出 CSV</el-button>
          <el-table :data="workOrders" stripe size="small" style="margin-top: 12px">
            <el-table-column prop="wo_code" label="工单号" width="160" />
            <el-table-column prop="instance_code" label="实例" width="140" />
            <el-table-column prop="subsystem_name" label="子系统" width="100" />
            <el-table-column prop="title" label="标题" min-width="200" />
            <el-table-column prop="status" label="状态" width="100" />
            <el-table-column prop="estimated_hours" label="估工时" width="80" />
            <el-table-column prop="actual_hours" label="实工时" width="80" />
            <el-table-column label="实际开始" width="170">
              <template #default="{ row }">{{ row.actual_start || '-' }}</template>
            </el-table-column>
            <el-table-column label="实际结束" width="170">
              <template #default="{ row }">{{ row.actual_end || '-' }}</template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>
      <el-tab-pane label="物料报表" name="mats">
        <el-card>
          <el-button type="success" @click="exportCSV('materials', materials)">⬇ 导出 CSV</el-button>
          <el-table :data="materials" stripe size="small" style="margin-top: 12px">
            <el-table-column prop="material_code" label="编码" width="140" />
            <el-table-column prop="material_name" label="名称" min-width="200" />
            <el-table-column prop="material_type" label="类型" width="100" />
            <el-table-column prop="spec" label="规格" width="150" />
            <el-table-column prop="unit" label="单位" width="60" />
            <el-table-column prop="is_self_made" label="自制" width="60">
              <template #default="{ row }">{{ row.is_self_made ? '是' : '否' }}</template>
            </el-table-column>
            <el-table-column prop="is_key_component" label="关键件" width="80">
              <template #default="{ row }">{{ row.is_key_component ? '⭐' : '' }}</template>
            </el-table-column>
            <el-table-column prop="default_supplier" label="供应商" width="120" />
          </el-table>
        </el-card>
      </el-tab-pane>
      <el-tab-pane label="项目进度报表" name="proj">
        <el-card>
          <el-button type="success" @click="exportCSV('project_progress', projects)">⬇ 导出 CSV</el-button>
          <el-table :data="projects" stripe size="small" style="margin-top: 12px">
            <el-table-column prop="instance_code" label="项目" width="160" />
            <el-table-column prop="customer" label="客户" width="140" />
            <el-table-column label="工单进度" width="120">
              <template #default="{ row }">
                <el-progress :percentage="row.work_orders.progress_pct" :format="fmtWO" />
              </template>
            </el-table-column>
            <el-table-column label="工艺进度" min-width="120">
              <template #default="{ row }">
                <el-progress :percentage="row.process_nodes.progress_pct" :format="fmtPN" />
              </template>
            </el-table-column>
            <el-table-column prop="status" label="状态" width="100" />
            <el-table-column label="工期" width="180">
              <template #default="{ row }">{{ row.planned_start }} → {{ row.planned_end }}</template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>
      <el-tab-pane label="长交期预警" name="lt">
        <el-card>
          <el-alert type="warning" :closable="false" style="margin-bottom: 12px">
            以下关键外购件交期 ≥ 12 周, 请提前订货
          </el-alert>
          <el-button type="success" @click="exportCSV('long_leadtime', longLeadtime)">⬇ 导出 CSV</el-button>
          <el-table :data="longLeadtime" stripe size="small" style="margin-top: 12px">
            <el-table-column prop="material_name" label="物料" min-width="200" />
            <el-table-column prop="component_type" label="类型" width="120" />
            <el-table-column prop="supplier" label="供应商" width="120" />
            <el-table-column prop="lead_time_weeks" label="交期(周)" width="100" />
            <el-table-column prop="risk_level" label="风险" width="80" />
          </el-table>
        </el-card>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import * as XLSX from 'xlsx'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import api from '../api'

const tab = ref('instances')
const dash = ref<any>({}); const projects = ref<any[]>([])
const instances = ref<any[]>([])
const workOrders = ref<any[]>([])
const materials = ref<any[]>([])
const longLeadtime = ref<any[]>([])

const load = async () => {
  dash.value = await api.get('/dashboard')
  instances.value = await api.get('/equipment_instances')
  workOrders.value = await api.get('/work_orders')
  materials.value = await api.get('/materials')
  longLeadtime.value = await api.get('/key_components/long_leadtime')
}

const exportExcel = (name: string, rows: any[]) => {
  if (!rows.length) return
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, name)
  XLSX.writeFile(wb, `${name}_${new Date().toISOString().slice(0, 10)}.xlsx`)
}

const exportPDF = (name: string, rows: any[], columns: { header: string, dataKey: string }[]) => {
  if (!rows.length) return
  const doc = new jsPDF('l', 'mm', 'a4')  // landscape A4
  doc.setFontSize(14)
  doc.text('TBM-MES · ' + name + ' Report', 14, 15)
  doc.setFontSize(9)
  doc.text('Generated: ' + new Date().toLocaleString('zh-CN'), 14, 22)
  autoTable(doc, { startY: 28, head: [columns.map(c => c.header)], body: rows.map(r => columns.map(c => r[c.dataKey] || '')) })
  doc.save(`${name}_${new Date().toISOString().slice(0, 10)}.pdf`)
}

const exportCSV = (name: string, rows: any[]) => {
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const csv = [headers.join(',')].concat(
    rows.map(r => headers.map(h => {
      const v = r[h]
      if (v == null) return ''
      const s = String(v).replace(/"/g, '""')
      return /[",\n]/.test(s) ? `"${s}"` : s
    }).join(','))
  ).join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(load)
</script>
