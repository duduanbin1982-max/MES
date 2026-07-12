<template>
  <div class="page">
    <div class="page-header">
      <div>
        <div class="page-title"><el-icon><Key /></el-icon> 关键件管理</div>
        <div class="page-subtitle">主轴承、刀盘、液压系统等关键件的监造过程、资质证书与追溯</div>
      </div>
      <div style="display:flex;gap:8px;">
        <el-select v-model="filterInstanceId" clearable placeholder="筛选装备" style="width:240px" @change="loadAll">
          <el-option v-for="inst in data.instances" :key="inst.id" :label="inst.instance_name" :value="inst.id" />
        </el-select>
        <el-button @click="loadAll" :loading="loading">刷新</el-button>
      </div>
    </div>

    <el-row :gutter="12" style="margin-bottom:12px">
      <el-col :span="4"><el-card shadow="hover" class="stat-card"><div class="stat-num" style="color:var(--el-color-danger)">{{ data.overview.high_risk }}</div><div class="stat-label">高风险件</div></el-card></el-col>
      <el-col :span="4"><el-card shadow="hover" class="stat-card"><div class="stat-num">{{ data.overview.total_parts }}</div><div class="stat-label">关键件总数</div></el-card></el-col>
      <el-col :span="4"><el-card shadow="hover" class="stat-card"><div class="stat-num" style="color:var(--el-color-primary)">{{ data.overview.total_certs }}</div><div class="stat-label">资质证书</div></el-card></el-col>
      <el-col :span="4"><el-card shadow="hover" class="stat-card"><div class="stat-num">{{ data.overview.total_logs }}</div><div class="stat-label">监造记录</div></el-card></el-col>
      <el-col :span="4"><el-card shadow="hover" class="stat-card"><div class="stat-num" :style="{color: data.overview.pending_checklists?'var(--el-color-warning)':''}">{{ data.overview.pending_checklists }}</div><div class="stat-label">待验收</div></el-card></el-col>
    </el-row>

    <el-tabs v-model="tab" type="border-card">
      <!-- Parts List -->
      <el-tab-pane name="parts">
        <template #label><el-icon><Box /></el-icon> 关键件清单</template>
        <el-table :data="data.parts" size="small" stripe max-height="450">
          <el-table-column prop="component_type" label="部件类型" width="140" />
          <el-table-column prop="material_name" label="物料名称" min-width="140" />
          <el-table-column prop="supplier" label="供应商" width="110" />
          <el-table-column prop="supplier_part_no" label="供应商料号" width="130" />
          <el-table-column prop="lead_time_weeks" label="交期(周)" width="80" align="center" />
          <el-table-column prop="unit_price" label="单价(万)" width="85" align="right">
            <template #default="{row}"><span v-if="row.unit_price">{{ (row.unit_price/10000).toFixed(1) }}</span></template>
          </el-table-column>
          <el-table-column prop="risk_level" label="风险" width="75">
            <template #default="{row}"><el-tag :type="riskType(row.risk_level)" size="small">{{ riskLabel(row.risk_level) }}</el-tag></template>
          </el-table-column>
          <el-table-column label="证书" width="60" align="center">
            <template #default="{row}"><el-tag :type="row.cert_count?'success':'info'" size="small">{{ row.cert_count||0 }}</el-tag></template>
          </el-table-column>
          <el-table-column label="监造" width="60" align="center">
            <template #default="{row}"><el-tag :type="row.supervision_count?'':'info'" size="small">{{ row.supervision_count||0 }}</el-tag></template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- Certificates -->
      <el-tab-pane name="certs">
        <template #label><el-icon><Memo /></el-icon> 资质证书</template>
        <div style="margin-bottom:10px"><el-button type="primary" @click="openCertDialog">绑定已签发证书</el-button></div>
        <el-table :data="data.certs" size="small" stripe max-height="450">
          <el-table-column prop="component_type" label="部件" width="120" />
          <el-table-column prop="cert_type" label="证书类型" width="120"><template #default="{row}"><el-tag size="small">{{ certTypeLabel(row.cert_type) }}</el-tag></template></el-table-column>
          <el-table-column prop="cert_no" label="证书编号" width="160" />
          <el-table-column prop="issued_by" label="签发机构" width="130" />
          <el-table-column prop="issue_date" label="签发日期" width="110" />
          <el-table-column prop="expiry_date" label="到期日" width="110"><template #default="{row}"><span :style="{color: isExpired(row.expiry_date)?'var(--el-color-danger)':''}">{{ row.expiry_date||'永久' }}</span></template></el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- Supervision Logs -->
      <el-tab-pane name="supervision">
        <template #label><el-icon><Search /></el-icon> 监造日志</template>
        <el-table :data="data.logs" size="small" stripe max-height="450">
          <el-table-column prop="instance_name" label="装备" width="150" />
          <el-table-column prop="component_type" label="部件" width="100" />
          <el-table-column prop="log_date" label="日期" width="110" />
          <el-table-column prop="inspector" label="监造人" width="90" />
          <el-table-column prop="location" label="地点" width="130" />
          <el-table-column prop="content" label="内容" min-width="220" />
          <el-table-column prop="status" label="结果" width="80"><template #default="{row}"><el-tag :type="row.status==='normal'?'success':'warning'" size="small">{{ row.status==='normal'?'正常':'异常' }}</el-tag></template></el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- Acceptance Checklists -->
      <el-tab-pane name="acceptance">
        <template #label><el-icon><CircleCheck /></el-icon> 验收清单</template>
        <el-table :data="data.checklists" size="small" stripe max-height="450">
          <el-table-column prop="instance_name" label="装备" width="150" />
          <el-table-column prop="checklist_name" label="名称" min-width="180" />
          <el-table-column prop="status" label="状态" width="90"><template #default="{row}"><el-tag :type="row.status==='passed'?'success':row.status==='failed'?'danger':'warning'" size="small">{{ {pending:'待验收',passed:'通过',failed:'不通过'}[row.status]||row.status }}</el-tag></template></el-table-column>
          <el-table-column prop="inspector" label="检验员" width="90" />
          <el-table-column prop="customer_rep" label="客户代表" width="90" />
          <el-table-column prop="sign_date" label="签字日期" width="110" />
        </el-table>
      </el-tab-pane>
    </el-tabs>
    <el-dialog v-model="certDialog" title="绑定关键件证书" width="560px">
      <el-form :model="certForm" label-width="90px">
        <el-form-item label="关键件" required><el-select v-model="certForm.part_id" filterable style="width:100%"><el-option v-for="part in data.parts" :key="part.id" :value="part.id" :label="part.component_type+' · '+(part.material_name||part.material_code)" /></el-select></el-form-item>
        <el-form-item label="证书类型" required><el-select v-model="certForm.cert_type" style="width:100%"><el-option label="材质证明" value="material_cert"/><el-option label="NDT 报告" value="ndt_report"/><el-option label="出厂验收" value="factory_accept"/><el-option label="型式认可" value="type_approval"/></el-select></el-form-item>
        <el-form-item label="已签发文档" required><el-select v-model="certForm.document_id" filterable style="width:100%"><el-option v-for="doc in issuedDocuments" :key="doc.id" :value="doc.id" :label="doc.title+' · '+doc.version" /></el-select></el-form-item>
        <el-form-item label="证书编号"><el-input v-model="certForm.cert_no" /></el-form-item>
        <el-form-item label="签发机构"><el-input v-model="certForm.issued_by" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="certDialog=false">取消</el-button><el-button type="primary" @click="saveCertificate">绑定</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from "vue"
import Api from "../api"
import { ElMessage } from "element-plus"

const loading = ref(false)
const tab = ref("parts")
const filterInstanceId = ref(null as any)
const certDialog = ref(false)
const issuedDocuments = ref<any[]>([])
const certForm = reactive<any>({ part_id:null, cert_type:"material_cert", document_id:null, cert_no:"", issued_by:"" })

const data = reactive({
  overview: { total_parts:0, high_risk:0, total_certs:0, total_logs:0, pending_checklists:0 },
  parts: [] as any[], certs: [] as any[], logs: [] as any[], checklists: [] as any[], instances: [] as any[]
})

const riskType = (v: string) => v==="high"?"danger":v==="medium"?"warning":"info"
const riskLabel = (v: string) => ({high:"高",medium:"中",low:"低"} as any)[v]||v
const certTypeLabel = (v: string) => ({material_cert:"材质证明",ndt_report:"NDT报告",factory_accept:"出厂验收",type_approval:"型式认可"} as any)[v]||v
const isExpired = (d: string) => d && d < new Date().toISOString().slice(0,10)

async function loadAll() {
  loading.value = true
  try {
    const params: any = {}
    if (filterInstanceId.value) params.instance_id = filterInstanceId.value
    const res = await Api.get("/critical-parts/dashboard", { params })
    Object.assign(data, res)
  } finally { loading.value = false }
}

async function openCertDialog() {
  const response = await Api.get("/documents", { params: { status: "issued" } })
  issuedDocuments.value = response.items || response || []
  certDialog.value = true
}

async function saveCertificate() {
  if (!certForm.part_id || !certForm.document_id) return ElMessage.warning("请选择关键件和已签发文档")
  await Api.post(`/critical-parts/${certForm.part_id}/cert`, certForm)
  certDialog.value = false
  ElMessage.success("证书已绑定")
  await loadAll()
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
