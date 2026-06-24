<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title">⚠️ 物料预警 + 齐套分析</div>
      <div>
        <el-select v-model="selectedInstance" placeholder="选实例" style="width: 240px; margin-right: 8px" @change="load">
          <el-option v-for="i in instances" :key="i.id" :label="i.instance_code + ' | ' + (i.instance_name || '')" :value="i.id" />
        </el-select>
        <el-button @click="load">刷新</el-button>
      </div>
    </div>

    <div v-if="!selectedInstance" style="text-align: center; padding: 40px">
      <el-empty description="选实例查看物料预警" />
    </div>

    <div v-else v-loading="loading">
      <el-card style="margin-bottom: 16px">
        <template #header>
          <span style="font-weight: 500">📦 物料预警 (长交期件倒推)</span>
        </template>
        <el-row :gutter="16" style="margin-bottom: 12px">
          <el-col :span="6">
            <div class="stat-card" style="text-align: center">
              <div class="stat-label">关键件总数</div>
              <div class="stat-value">{{ alerts.summary?.total_components || 0 }}</div>
            </div>
          </el-col>
          <el-col :span="6">
            <div class="stat-card" style="text-align: center">
              <div class="stat-label">已备齐</div>
              <div class="stat-value" style="color: #67c23a">{{ alerts.summary?.by_status?.ready || 0 }}</div>
            </div>
          </el-col>
          <el-col :span="6">
            <div class="stat-card" style="text-align: center">
              <div class="stat-label">紧急 (≤14天)</div>
              <div class="stat-value" style="color: #f56c6c">{{ alerts.summary?.by_status?.urgent || 0 }}</div>
            </div>
          </el-col>
          <el-col :span="6">
            <div class="stat-card" style="text-align: center">
              <div class="stat-label">已逾期</div>
              <div class="stat-value" style="color: #e6a23c">{{ alerts.summary?.by_status?.overdue || 0 }}</div>
            </div>
          </el-col>
        </el-row>
        <el-table :data="alerts.alerts || []" stripe size="small">
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag :type="alertTagType(row.alert_status)" size="small">{{ alertLabel(row.alert_status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="material_name" label="物料" min-width="180" />
          <el-table-column prop="supplier" label="供应商" width="100" />
          <el-table-column label="需求/库存" width="100" align="center">
            <template #default="{ row }">{{ row.required_qty }} / {{ row.in_stock_qty }}</template>
          </el-table-column>
          <el-table-column prop="lead_time_weeks" label="交期(周)" width="80" align="center" />
          <el-table-column prop="order_deadline" label="下单截止" width="110" />
          <el-table-column prop="days_to_deadline" label="剩(天)" width="80" align="right">
            <template #default="{ row }">
              <span :style="{color: row.days_to_deadline < 0 ? '#f56c6c' : row.days_to_deadline < 14 ? '#e6a23c' : '#67c23a'}">{{ row.days_to_deadline }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="alert_message" label="建议" min-width="200" />
        </el-table>
      </el-card>

      <el-card>
        <template #header>
          <span style="font-weight: 500">🔧 齐套分析 (工单开工检查)</span>
        </template>
        <el-row :gutter="16" style="margin-bottom: 12px">
          <el-col :span="6">
            <div class="stat-card" style="text-align: center">
              <div class="stat-label">工单总数</div>
              <div class="stat-value">{{ kit.stats?.total || 0 }}</div>
            </div>
          </el-col>
          <el-col :span="6">
            <div class="stat-card" style="text-align: center">
              <div class="stat-label">可开工</div>
              <div class="stat-value" style="color: #67c23a">{{ kit.stats?.ready || 0 }}</div>
            </div>
          </el-col>
          <el-col :span="6">
            <div class="stat-card" style="text-align: center">
              <div class="stat-label">部分齐套</div>
              <div class="stat-value" style="color: #e6a23c">{{ kit.stats?.partial || 0 }}</div>
            </div>
          </el-col>
          <el-col :span="6">
            <div class="stat-card" style="text-align: center">
              <div class="stat-label">被卡 (缺关键件)</div>
              <div class="stat-value" style="color: #f56c6c">{{ kit.stats?.blocked || 0 }}</div>
            </div>
          </el-col>
        </el-row>
        <el-collapse>
          <el-collapse-item v-for="w in kit.work_orders || []" :key="w.work_order.id" :name="String(w.work_order.id)">
            <template #title>
              <span>
                <el-tag :type="kitTagType(w.kit_status)" size="small" style="margin-right: 8px">{{ w.kit_status }}</el-tag>
                <strong>{{ w.work_order.code }}</strong> · {{ w.work_order.title }}
                <span style="color: #909399; margin-left: 12px">缺 {{ w.total_shortage }} 项 (关键 {{ w.critical_shortage }})</span>
              </span>
            </template>
            <el-table :data="w.items" stripe size="small">
              <el-table-column prop="code" label="编码" width="140" />
              <el-table-column prop="name" label="名称" min-width="180" />
              <el-table-column label="需求/库存" width="100" align="center">
                <template #default="{ row }">{{ row.required_qty }} / {{ row.in_stock_qty || 0 }}</template>
              </el-table-column>
              <el-table-column label="缺料" width="80" align="center">
                <template #default="{ row }">
                  <span :style="{color: row.shortage > 0 ? '#f56c6c' : '#67c23a', fontWeight: 600}">{{ row.shortage }}</span>
                </template>
              </el-table-column>
              <el-table-column label="关键" width="60" align="center">
                <template #default="{ row }">
                  <el-tag v-if="row.is_key" type="danger" size="small" effect="dark">⭐</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="交期(周)" width="80" align="center">
                <template #default="{ row }">{{ row.lead_time || '-' }}</template>
              </el-table-column>
            </el-table>
          </el-collapse-item>
        </el-collapse>
        <el-empty v-if="!kit.work_orders?.length" description="没有工单" :image-size="60" />
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Api } from '../api'

const instances = ref<any[]>([])
const selectedInstance = ref<any>(undefined)
const alerts = ref<any>({})
const kit = ref<any>({})
const loading = ref(false)

const alertTagType = (s: string) => ({ overdue: 'danger', urgent: 'danger', warning: 'warning', planned: 'info', ready: 'success', ok: 'success' }[s] || 'info')
const alertLabel = (s: string) => ({ overdue: '已逾期', urgent: '紧急', warning: '预警', planned: '计划', ready: '已备齐', ok: 'OK' }[s] || s)
const kitTagType = (s: string) => ({ ready: 'success', partial: 'warning', blocked: 'danger' }[s] || 'info')

const load = async () => {
  if (!selectedInstance.value) return
  loading.value = true
  try {
    instances.value = await Api.instances()
    const [a, k] = await Promise.all([
      fetch('/api/equipment_instances/' + selectedInstance.value + '/material_alerts', {headers: {Authorization: 'Bearer ' + localStorage.getItem('tbm_token')}}).then(r => r.json()),
      fetch('/api/equipment_instances/' + selectedInstance.value + '/kit_check', {headers: {Authorization: 'Bearer ' + localStorage.getItem('tbm_token')}}).then(r => r.json())
    ])
    alerts.value = a
    kit.value = k
  } finally { loading.value = false }
}

onMounted(async () => {
  instances.value = await Api.instances()
  if (instances.value.length > 0) {
    selectedInstance.value = instances.value[0].id
    load()
  }
})
</script>
