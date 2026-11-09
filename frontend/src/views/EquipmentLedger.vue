<template>
  <div class="page">
    <PageToolbar title="设备台账" subtitle="车间生产设备主数据：资产、工位、IoT、维保、OEE 与状态履历；项目装备见“项目装备台账”。" aria-label="车间设备台账工具栏">
      <template #icon><el-icon><Monitor /></el-icon></template>
      <template #actions>
        <el-input v-model="filters.keyword" clearable placeholder="编码/名称/资产/型号/序列号" class="toolbar-search" :prefix-icon="Search" @keyup.enter="search" @clear="search" />
        <el-select v-model="filters.equipment_type" clearable placeholder="设备类型" class="toolbar-select" @change="search">
          <el-option v-for="item in meta.types" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <el-select v-model="filters.status" clearable placeholder="状态" class="toolbar-select" @change="search">
          <el-option v-for="item in meta.statuses" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <el-select v-model="filters.workshop_id" clearable placeholder="工位" class="toolbar-select" @change="search">
          <el-option v-for="item in meta.workstations" :key="item.id" :label="item.workshop + ' / ' + item.name" :value="item.id" />
        </el-select>
        <el-switch v-model="includeRetired" active-text="含退役" @change="search" />
        <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
        <el-button v-if="canWrite" type="primary" :icon="Plus" @click="openCreate">新增设备</el-button>
      </template>
    </PageToolbar>

    <el-alert v-if="summary.maintenance_due" type="error" :closable="false" show-icon class="quality-alert" :title="`${summary.maintenance_due} 台设备有已到期维保计划，请在详情-维保中处理`" />
    <el-alert v-if="missingAssetCount" type="warning" :closable="false" show-icon class="quality-alert" :title="`${missingAssetCount} 台设备主数据不完整（厂商/型号/序列号/位置/购置日期），请在编辑中补录`" />

    <PageState v-if="loadError" state="error" title="设备台账加载失败" :description="loadError" action-text="重新加载" @retry="load" />
    <PageState v-else-if="loading && !equipment.length" state="loading" title="正在加载车间设备台账" description="正在获取设备、工位、维保与 IoT 状态。" />
    <PageState v-else-if="!equipment.length" state="empty" title="暂无车间设备" description="请新增设备或调整筛选条件。" action-text="刷新" @retry="load" />

    <template v-else>
      <el-row :gutter="14" class="summary-row">
        <el-col :span="6"><el-card class="metric-card"><div class="metric-label">设备总数</div><div class="metric-value">{{ summary.total || 0 }}</div><div class="metric-sub">含退役 {{ summary.retired || 0 }}</div></el-card></el-col>
        <el-col :span="6"><el-card class="metric-card"><div class="metric-label">运行中</div><div class="metric-value">{{ summary.running || 0 }}</div><div class="metric-sub">空闲 {{ summary.idle || 0 }}</div></el-card></el-col>
        <el-col :span="6"><el-card class="metric-card"><div class="metric-label">维保/故障</div><div class="metric-value">{{ (summary.maintenance || 0) + (summary.fault || 0) }}</div><div class="metric-sub">维保 {{ summary.maintenance || 0 }} · 故障 {{ summary.fault || 0 }} · 到期 {{ summary.maintenance_due || 0 }}</div></el-card></el-col>
        <el-col :span="6"><el-card class="metric-card"><div class="metric-label">IoT 在线</div><div class="metric-value">{{ summary.iot_online || 0 }}</div><div class="metric-sub">共 {{ summary.iot_total || 0 }} 个采集设备</div></el-card></el-col>
      </el-row>

      <el-card>
        <template #header><div class="card-header"><span>车间设备清单</span><span class="header-hint">共 {{ pagination.total }} 台</span></div></template>
        <el-table :data="equipment" stripe style="width:100%">
          <el-table-column label="设备" min-width="200">
            <template #default="{ row }"><div class="device-name">{{ row.name }}</div><div class="muted">{{ row.code }}<span v-if="row.asset_no"> · 资产 {{ row.asset_no }}</span></div></template>
          </el-table-column>
          <el-table-column label="类型/工位" min-width="170">
            <template #default="{ row }"><div>{{ typeLabel(row.equipment_type) }}</div><div class="muted">{{ row.workshop || '-' }} / {{ row.workstation_name || '未绑定' }}</div></template>
          </el-table-column>
          <el-table-column label="状态" width="105"><template #default="{ row }"><el-tag :type="statusMeta(row.status).type" size="small">{{ statusMeta(row.status).label }}</el-tag></template></el-table-column>
          <el-table-column label="型号/序列号" min-width="150"><template #default="{ row }"><div>{{ row.model || '-' }}</div><div class="muted">{{ row.serial_no || '-' }}</div></template></el-table-column>
          <el-table-column label="原值/折旧" width="145">
            <template #default="{ row }"><div>{{ money(row.original_value) }}</div><div class="muted">{{ depreciationText(row) }}</div></template>
          </el-table-column>
          <el-table-column label="维保" width="130">
            <template #default="{ row }">
              <div v-if="row.next_maintenance_date">{{ row.next_maintenance_date }}</div>
              <div v-else class="muted">无计划</div>
              <el-tag v-if="row.overdue_maintenance_count" type="danger" size="small">已到期</el-tag>
              <span v-else class="muted">最近 {{ row.last_maintenance || '-' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="IoT" width="120">
            <template #default="{ row }"><el-tag v-if="row.iot_count" size="small" :type="row.iot_online ? 'success' : 'info'">{{ row.iot_online }}/{{ row.iot_count }} 在线</el-tag><span v-else class="muted">未接入</span></template>
          </el-table-column>
          <el-table-column v-if="canWrite" label="操作" width="230" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openDetail(row)">详情</el-button>
              <el-button link @click="openEdit(row)">编辑</el-button>
              <el-button link @click="openStatus(row)">状态</el-button>
              <el-button v-if="row.status !== 'retired'" link type="danger" @click="openRetire(row)">退役</el-button>
            </template>
          </el-table-column>
          <el-table-column v-else label="操作" width="80" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="openDetail(row)">详情</el-button></template></el-table-column>
        </el-table>
        <el-pagination v-model:current-page="page" :page-size="pagination.limit" :total="pagination.total" layout="total, prev, pager, next" class="pager" @current-change="load" />
      </el-card>
    </template>

    <el-dialog v-model="formDlg.show" :title="formDlg.id ? '编辑设备' : '新增设备'" width="780px">
      <el-form label-width="95px">
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item label="设备编码" required><el-input v-model="form.code" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="设备名称" required><el-input v-model="form.name" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="设备类型"><el-select v-model="form.equipment_type" style="width:100%"><el-option v-for="item in meta.types" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="资产编号"><el-input v-model="form.asset_no" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="工位"><el-select v-model="form.workstation_id" clearable style="width:100%"><el-option v-for="item in meta.workstations" :key="item.id" :label="item.workshop + ' / ' + item.name" :value="item.id" /></el-select></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="状态"><el-select v-model="form.status" style="width:100%"><el-option v-for="item in meta.statuses" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="厂商"><el-input v-model="form.manufacturer" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="型号"><el-input v-model="form.model" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="序列号"><el-input v-model="form.serial_no" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="关键度"><el-select v-model="form.criticality" style="width:100%"><el-option v-for="item in meta.criticalities" :key="item" :label="item" :value="item" /></el-select></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="存放位置"><el-input v-model="form.location" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="购置日期"><el-date-picker v-model="form.purchase_date" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="投产日期"><el-date-picker v-model="form.commission_date" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="保修到期"><el-date-picker v-model="form.warranty_end" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="资产原值"><el-input-number v-model="form.original_value" :min="0" :precision="2" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="折旧方式"><el-select v-model="form.depreciation_method" style="width:100%"><el-option v-for="item in meta.depreciation_methods" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="折旧年限"><el-input-number v-model="form.depreciation_years" :min="1" :max="50" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="残值率"><el-input-number v-model="form.residual_rate" :min="0" :max="1" :step="0.01" :precision="2" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="最近保养"><el-date-picker v-model="form.last_maintenance" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item></el-col>
          <el-col :span="24"><el-form-item label="备注"><el-input v-model="form.notes" type="textarea" :rows="2" /></el-form-item></el-col>
        </el-row>
      </el-form>
      <template #footer><el-button @click="formDlg.show = false">取消</el-button><el-button type="primary" :loading="formDlg.saving" @click="saveEquipment">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="statusDlg.show" title="变更设备状态" width="420px">
      <el-form label-width="80px"><el-form-item label="设备"><strong>{{ statusDlg.name }}</strong></el-form-item><el-form-item label="新状态"><el-select v-model="statusDlg.status" style="width:100%"><el-option v-for="item in meta.statuses" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item><el-form-item label="原因"><el-input v-model="statusDlg.reason" /></el-form-item></el-form>
      <template #footer><el-button @click="statusDlg.show = false">取消</el-button><el-button type="primary" :loading="statusDlg.saving" @click="saveStatus">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="retireDlg.show" title="设备退役" width="420px">
      <el-alert type="warning" :closable="false" title="退役为软删除：保留设备、维保、OEE 与状态履历，不会物理删除。" />
      <el-input v-model="retireDlg.reason" type="textarea" :rows="2" placeholder="退役原因" style="margin-top:12px" />
      <template #footer><el-button @click="retireDlg.show = false">取消</el-button><el-button type="danger" :loading="retireDlg.saving" @click="saveRetire">确认退役</el-button></template>
    </el-dialog>

    <el-drawer v-model="detail.show" :title="detail.row?.name || '设备详情'" size="820px">
      <div v-loading="detail.loading">
        <el-tabs v-model="detail.tab">
          <el-tab-pane label="概览 / IoT" name="overview">
            <el-descriptions :column="2" border size="small">
              <el-descriptions-item label="编码">{{ detail.row?.code }}</el-descriptions-item>
              <el-descriptions-item label="资产号">{{ detail.row?.asset_no || '-' }}</el-descriptions-item>
              <el-descriptions-item label="类型">{{ typeLabel(detail.row?.equipment_type) }}</el-descriptions-item>
              <el-descriptions-item label="工位">{{ detail.row?.workshop || '-' }} / {{ detail.row?.workstation_name || '未绑定' }}</el-descriptions-item>
              <el-descriptions-item label="厂商/型号">{{ [detail.row?.manufacturer, detail.row?.model].filter(Boolean).join(' / ') || '-' }}</el-descriptions-item>
              <el-descriptions-item label="序列号">{{ detail.row?.serial_no || '-' }}</el-descriptions-item>
              <el-descriptions-item label="位置">{{ detail.row?.location || '-' }}</el-descriptions-item>
              <el-descriptions-item label="关键度">{{ detail.row?.criticality || '-' }}</el-descriptions-item>
              <el-descriptions-item label="购置/投产">{{ [detail.row?.purchase_date, detail.row?.commission_date].filter(Boolean).join(' / ') || '-' }}</el-descriptions-item>
              <el-descriptions-item label="保修到期">{{ detail.row?.warranty_end || '-' }}</el-descriptions-item>
              <el-descriptions-item label="资产原值">{{ money(detail.row?.original_value) }}</el-descriptions-item>
              <el-descriptions-item label="折旧">{{ depreciationText(detail.row || {}) }}</el-descriptions-item>
              <el-descriptions-item label="状态">{{ statusMeta(detail.row?.status).label }}</el-descriptions-item>
              <el-descriptions-item label="最近保养">{{ detail.row?.last_maintenance || '-' }}</el-descriptions-item>
            </el-descriptions>
            <el-divider content-position="left">IoT 采集点</el-divider>
            <el-table :data="detail.row?.iot_devices || []" size="small" empty-text="未绑定车间设备 IoT 采集点">
              <el-table-column prop="device_code" label="设备编码" /><el-table-column prop="device_name" label="名称" /><el-table-column prop="device_type" label="类型" /><el-table-column prop="status" label="状态" /><el-table-column prop="last_seen_at" label="最后上报" />
            </el-table>
          </el-tab-pane>

          <el-tab-pane label="维保" name="maintenance">
            <div class="detail-toolbar"><el-tag type="info">计划 {{ detail.maintenance.plans.length }}</el-tag><el-tag type="warning">到期 {{ detail.maintenance.summary.due_count }}</el-tag><el-button v-if="canWrite" size="small" type="primary" @click="openPlan">新增计划</el-button><el-button v-if="canWrite" size="small" @click="openLog">保养登记</el-button></div>
            <el-table :data="detail.maintenance.plans" size="small" empty-text="暂无维保计划">
              <el-table-column prop="plan_name" label="计划" /><el-table-column prop="maintenance_type" label="类型" /><el-table-column prop="frequency_days" label="周期(天)" /><el-table-column prop="next_due_date" label="下次到期" /><el-table-column prop="status" label="状态" />
            </el-table>
            <el-divider content-position="left">保养记录</el-divider>
            <el-table :data="detail.maintenance.logs" size="small" empty-text="暂无保养记录">
              <el-table-column prop="performed_at" label="日期" /><el-table-column prop="hours_spent" label="工时" /><el-table-column prop="findings" label="发现" show-overflow-tooltip /><el-table-column prop="actions_taken" label="处理" show-overflow-tooltip />
            </el-table>
          </el-tab-pane>

          <el-tab-pane label="OEE" name="oee">
            <div class="detail-toolbar"><el-tag>班次 {{ detail.oee.summary.shifts }}</el-tag><el-tag>可用 {{ detail.oee.summary.availability }}%</el-tag><el-tag>性能 {{ detail.oee.summary.performance }}%</el-tag><el-tag>质量 {{ detail.oee.summary.quality }}%</el-tag><el-tag type="success">OEE {{ detail.oee.summary.oee }}%</el-tag><el-button v-if="canWrite" size="small" type="primary" @click="openOee">录入班次</el-button></div>
            <div v-if="detail.oee.summary.shifts" class="oee-trend"><span v-for="(point, idx) in oeePoints" :key="idx" :style="{ height: point.height + '%' }" :title="point.label"></span></div>
            <el-table :data="detail.oee.rows" size="small" empty-text="暂无 OEE 班次">
              <el-table-column prop="shift_date" label="日期" /><el-table-column prop="shift_name" label="班次" /><el-table-column prop="planned_minutes" label="计划分钟" /><el-table-column prop="operating_minutes" label="运行分钟" /><el-table-column prop="total_output" label="产量" /><el-table-column prop="good_output" label="合格" /><el-table-column label="OEE"><template #default="{ row }">{{ oeeOf(row) }}%</template></el-table-column>
            </el-table>
          </el-tab-pane>

          <el-tab-pane label="状态履历" name="status">
            <el-table :data="detail.statusLogs" size="small" empty-text="暂无状态履历">
              <el-table-column prop="changed_at" label="时间" /><el-table-column prop="from_status" label="原状态" /><el-table-column prop="to_status" label="新状态" /><el-table-column prop="reason" label="原因" /><el-table-column prop="changed_by" label="操作人" />
            </el-table>
          </el-tab-pane>
        </el-tabs>
      </div>
    </el-drawer>

    <el-dialog v-model="planDlg.show" title="新增维保计划" width="500px">
      <el-form label-width="90px"><el-form-item label="计划名称" required><el-input v-model="planDlg.plan_name" /></el-form-item><el-form-item label="类型"><el-select v-model="planDlg.maintenance_type" style="width:100%"><el-option v-for="item in meta.maintenance_types" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item><el-form-item label="周期(天)"><el-input-number v-model="planDlg.frequency_days" :min="1" :max="3650" style="width:100%" /></el-form-item><el-form-item label="下次到期"><el-date-picker v-model="planDlg.next_due_date" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item><el-form-item label="备注"><el-input v-model="planDlg.notes" type="textarea" :rows="2" /></el-form-item></el-form>
      <template #footer><el-button @click="planDlg.show = false">取消</el-button><el-button type="primary" :loading="planDlg.saving" @click="savePlan">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="logDlg.show" title="保养登记" width="520px">
      <el-form label-width="90px"><el-form-item label="日期"><el-date-picker v-model="logDlg.performed_at" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item><el-form-item label="工时"><el-input-number v-model="logDlg.hours_spent" :min="0" :precision="1" style="width:100%" /></el-form-item><el-form-item label="关联计划"><el-select v-model="logDlg.plan_id" clearable style="width:100%"><el-option v-for="plan in detail.maintenance.plans" :key="plan.id" :label="plan.plan_name" :value="plan.id" /></el-select></el-form-item><el-form-item label="发现"><el-input v-model="logDlg.findings" type="textarea" :rows="2" /></el-form-item><el-form-item label="处理"><el-input v-model="logDlg.actions_taken" type="textarea" :rows="2" /></el-form-item><el-form-item label="下次到期"><el-date-picker v-model="logDlg.next_due_at" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item></el-form>
      <template #footer><el-button @click="logDlg.show = false">取消</el-button><el-button type="primary" :loading="logDlg.saving" @click="saveLog">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="oeeDlg.show" title="录入 OEE 班次" width="560px">
      <el-form label-width="100px"><el-form-item label="日期" required><el-date-picker v-model="oeeDlg.shift_date" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item><el-form-item label="班次"><el-input v-model="oeeDlg.shift_name" /></el-form-item><el-form-item label="计划分钟"><el-input-number v-model="oeeDlg.planned_minutes" :min="0" style="width:100%" /></el-form-item><el-form-item label="运行分钟"><el-input-number v-model="oeeDlg.operating_minutes" :min="0" style="width:100%" /></el-form-item><el-form-item label="理想节拍"><el-input-number v-model="oeeDlg.ideal_cycle_time" :min="0" :precision="3" style="width:100%" /></el-form-item><el-form-item label="总产量"><el-input-number v-model="oeeDlg.total_output" :min="0" style="width:100%" /></el-form-item><el-form-item label="合格数"><el-input-number v-model="oeeDlg.good_output" :min="0" style="width:100%" /></el-form-item></el-form>
      <template #footer><el-button @click="oeeDlg.show = false">取消</el-button><el-button type="primary" :loading="oeeDlg.saving" @click="saveOee">保存</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { Monitor, Plus, Refresh, Search } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { Api } from '../api'
import PageState from '../components/PageState.vue'
import PageToolbar from '../components/PageToolbar.vue'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const canWrite = computed(() => auth.role === 'admin' || auth.role === 'foreman')
const statusMap: Record<string, { label: string; type: string }> = {
  running: { label: '运行', type: 'success' }, idle: { label: '空闲', type: 'info' },
  maintenance: { label: '维保', type: 'warning' }, fault: { label: '故障', type: 'danger' },
  offline: { label: '离线', type: 'info' }, retired: { label: '退役', type: 'info' },
}
const statusMeta = (status: string) => statusMap[status] || { label: status || '-', type: 'info' }
const typeLabel = (value: string) => meta.types.find((item: any) => item.value === value)?.label || value || '-'
const errText = (error: any) => error?.response?.data?.error || error?.response?.data?.message || error?.message || String(error)
const money = (value: any) => value == null || value === '' ? '-' : '¥' + new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(Number(value))
const depreciationText = (row: any) => {
  if (!row?.original_value) return '未录原值'
  const method = meta.depreciation_methods.find((item: any) => item.value === row.depreciation_method)?.label || '直线法'
  const years = Number(row.depreciation_years || 0)
  const annual = years > 0 ? Number(row.original_value || 0) * (1 - Number(row.residual_rate || 0)) / years : 0
  return `${method} / ${years || '-'} 年 / 年折旧 ${money(annual)}`
}
const filters = reactive({ keyword: '', equipment_type: '', status: '', workshop_id: null as any })
const includeRetired = ref(false)
const loading = ref(false)
const loadError = ref('')
const equipment = ref<any[]>([])
const page = ref(1)
const pagination = reactive({ total: 0, limit: 20 })
const summary = reactive<any>({ total: 0, running: 0, idle: 0, maintenance: 0, fault: 0, offline: 0, retired: 0, iot_online: 0, iot_total: 0, maintenance_due: 0 })
const meta = reactive<any>({ types: [], statuses: [], criticalities: ['A', 'B', 'C'], workstations: [], depreciation_methods: [], maintenance_types: [] })
const emptyForm = () => ({ code: '', name: '', equipment_type: 'other', workstation_id: null, status: 'idle', asset_no: '', manufacturer: '', model: '', serial_no: '', location: '', criticality: 'B', purchase_date: null, commission_date: null, warranty_end: null, original_value: null, depreciation_method: 'straight_line', depreciation_years: 10, residual_rate: 0.05, last_maintenance: null, notes: '' })
const form = reactive<any>(emptyForm())
const formDlg = reactive<any>({ show: false, id: null, saving: false })
const statusDlg = reactive<any>({ show: false, id: null, name: '', status: 'idle', reason: '', saving: false })
const retireDlg = reactive<any>({ show: false, row: null, reason: '', saving: false })
const detail = reactive<any>({ show: false, loading: false, tab: 'overview', row: null, maintenance: { plans: [], logs: [], summary: {} }, oee: { rows: [], summary: {} }, statusLogs: [] })
const planDlg = reactive<any>({ show: false, saving: false, plan_name: '', maintenance_type: 'periodic', frequency_days: 30, next_due_date: null, notes: '' })
const logDlg = reactive<any>({ show: false, saving: false, performed_at: null, hours_spent: 1, plan_id: null, findings: '', actions_taken: '', next_due_at: null })
const oeeDlg = reactive<any>({ show: false, saving: false, shift_date: null, shift_name: '白班', planned_minutes: 480, operating_minutes: 0, ideal_cycle_time: 0, total_output: 0, good_output: 0 })
const missingAssetCount = computed(() => equipment.value.filter((row) => !row.manufacturer || !row.model || !row.serial_no || !row.location || !row.purchase_date).length)
const oeePoints = computed(() => [...(detail.oee.rows || [])].reverse().slice(-12).map((row: any) => ({ height: Math.max(4, Math.min(100, oeeOf(row))), label: `${row.shift_date} OEE ${oeeOf(row)}%` })))
function oeeOf(row: any) {
  const planned = Number(row.planned_minutes || 0); const operating = Number(row.operating_minutes || 0)
  const total = Number(row.total_output || 0); const good = Number(row.good_output || 0)
  const ideal = total * Number(row.ideal_cycle_time || 0)
  const a = planned > 0 ? operating * 100 / planned : 0; const p = operating > 0 ? ideal * 100 / operating : 0; const q = total > 0 ? good * 100 / total : 0
  return Number((a * p * q / 10000).toFixed(1))
}

async function loadMeta() { try { Object.assign(meta, await Api.get('/equipment-ledger/meta')) } catch (error: any) { ElMessage.error('加载元数据失败：' + errText(error)) } }
async function load() {
  loading.value = true; loadError.value = ''
  try {
    const data: any = await Api.get('/equipment-ledger', { params: { keyword: filters.keyword || undefined, equipment_type: filters.equipment_type || undefined, status: filters.status || undefined, workshop_id: filters.workshop_id || undefined, include_retired: includeRetired.value, limit: pagination.limit, offset: (page.value - 1) * pagination.limit } })
    equipment.value = data.equipment || []
    Object.assign(summary, data.summary || {}); Object.assign(pagination, data.pagination || {})
  } catch (error: any) { loadError.value = errText(error) } finally { loading.value = false }
}
function search() { page.value = 1; load() }
function openCreate() { Object.assign(form, emptyForm()); formDlg.id = null; formDlg.show = true }
function openEdit(row: any) { Object.assign(form, emptyForm(), row); formDlg.id = row.id; formDlg.show = true }
async function saveEquipment() {
  if (!form.code.trim() || !form.name.trim()) { ElMessage.warning('设备编码和名称必填'); return }
  formDlg.saving = true
  try {
    if (formDlg.id) await Api.put('/equipment-ledger/' + formDlg.id, form); else await Api.post('/equipment-ledger', form)
    ElMessage.success('设备已保存'); formDlg.show = false; await Promise.all([loadMeta(), load()])
  } catch (error: any) { ElMessage.error('保存失败：' + errText(error)) } finally { formDlg.saving = false }
}
function openStatus(row: any) { Object.assign(statusDlg, { show: true, id: row.id, name: row.name, status: row.status, reason: '', saving: false }) }
async function saveStatus() {
  statusDlg.saving = true
  try { await Api.post('/equipment-ledger/' + statusDlg.id + '/status', { status: statusDlg.status, reason: statusDlg.reason }); ElMessage.success('状态已更新'); statusDlg.show = false; await load(); if (detail.show) await refreshDetail() }
  catch (error: any) { ElMessage.error('更新失败：' + errText(error)) } finally { statusDlg.saving = false }
}
function openRetire(row: any) { Object.assign(retireDlg, { show: true, row, reason: '', saving: false }) }
async function saveRetire() {
  retireDlg.saving = true
  try { await Api.post('/equipment-ledger/' + retireDlg.row.id + '/retire', { reason: retireDlg.reason }); ElMessage.success('设备已退役'); retireDlg.show = false; await load() }
  catch (error: any) { ElMessage.error('退役失败：' + errText(error)) } finally { retireDlg.saving = false }
}
async function openDetail(row: any) {
  detail.show = true; detail.tab = 'overview'; detail.row = row
  await refreshDetail()
}
async function refreshDetail() {
  if (!detail.row?.id) return
  detail.loading = true
  try {
    const [row, maintenance, oee, statusLogs] = await Promise.all([
      Api.get('/equipment-ledger/' + detail.row.id),
      Api.get('/equipment-ledger/' + detail.row.id + '/maintenance'),
      Api.get('/equipment-ledger/' + detail.row.id + '/oee'),
      Api.get('/equipment-ledger/' + detail.row.id + '/status-logs'),
    ])
    detail.row = row; detail.maintenance = maintenance; detail.oee = oee; detail.statusLogs = statusLogs || []
  } catch (error: any) { ElMessage.error('加载详情失败：' + errText(error)) } finally { detail.loading = false }
}
function openPlan() { Object.assign(planDlg, { show: true, saving: false, plan_name: '', maintenance_type: 'periodic', frequency_days: 30, next_due_date: null, notes: '' }) }
async function savePlan() {
  if (!planDlg.plan_name.trim()) { ElMessage.warning('计划名称必填'); return }
  planDlg.saving = true
  try { await Api.post('/equipment-ledger/' + detail.row.id + '/maintenance/plans', planDlg); ElMessage.success('计划已创建'); planDlg.show = false; await refreshDetail(); await load() }
  catch (error: any) { ElMessage.error('保存失败：' + errText(error)) } finally { planDlg.saving = false }
}
function openLog() { Object.assign(logDlg, { show: true, saving: false, performed_at: new Date().toISOString().slice(0, 10), hours_spent: 1, plan_id: null, findings: '', actions_taken: '', next_due_at: null }) }
async function saveLog() {
  logDlg.saving = true
  try { await Api.post('/equipment-ledger/' + detail.row.id + '/maintenance/logs', logDlg); ElMessage.success('保养已登记'); logDlg.show = false; await refreshDetail(); await load() }
  catch (error: any) { ElMessage.error('保存失败：' + errText(error)) } finally { logDlg.saving = false }
}
function openOee() { Object.assign(oeeDlg, { show: true, saving: false, shift_date: new Date().toISOString().slice(0, 10), shift_name: '白班', planned_minutes: 480, operating_minutes: 0, ideal_cycle_time: 0, total_output: 0, good_output: 0 }) }
async function saveOee() {
  if (!oeeDlg.shift_date) { ElMessage.warning('日期必填'); return }
  oeeDlg.saving = true
  try { await Api.post('/equipment-ledger/' + detail.row.id + '/oee', oeeDlg); ElMessage.success('OEE 已录入'); oeeDlg.show = false; await refreshDetail() }
  catch (error: any) { ElMessage.error('保存失败：' + errText(error)) } finally { oeeDlg.saving = false }
}

onMounted(async () => { await loadMeta(); await load() })
</script>

<style scoped>
.page { padding: 16px; }
.toolbar-search { width: 230px; }
.toolbar-select { width: 150px; }
.summary-row { margin-bottom: 16px; }
.metric-card { min-height: 110px; }
.metric-label { color: var(--el-text-color-secondary); font-size: 13px; margin-bottom: 8px; }
.metric-value { color: var(--el-text-color-primary); font-size: 28px; font-weight: 700; line-height: 1.2; }
.metric-sub, .header-hint, .muted { color: var(--el-text-color-secondary); font-size: 12px; margin-top: 6px; }
.device-name { font-weight: 600; }
.card-header, .detail-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.quality-alert { margin-bottom: 12px; }
.pager { margin-top: 12px; justify-content: flex-end; }
.oee-trend { display: flex; align-items: flex-end; gap: 4px; height: 80px; padding: 8px 4px; margin: 10px 0; border-bottom: 1px solid var(--el-border-color-lighter); }
.oee-trend span { flex: 1; min-width: 8px; background: var(--el-color-primary-light-5); border-radius: 2px 2px 0 0; }
</style>
