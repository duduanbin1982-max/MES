<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title">📋 物料管理</div>
      <el-button type="primary" @click="activeTab = 'long'; loadLong()">
        <el-icon><Refresh /></el-icon>刷新长交期
      </el-button>
    </div>

    <el-tabs v-model="activeTab">
      <el-tab-pane label="物料主数据" name="materials">
        <el-card>
          <el-table :data="mats" stripe v-loading="loading" size="small">
            <el-table-column prop="material_code" label="编码" width="140" />
            <el-table-column prop="material_name" label="名称" min-width="200" />
            <el-table-column prop="material_type" label="类型" width="100" />
            <el-table-column prop="spec" label="规格" width="150" />
            <el-table-column prop="unit" label="单位" width="60" />
            <el-table-column label="自制" width="70">
              <template #default="{ row }">
                <el-tag v-if="row.is_self_made" type="success" size="small">自制</el-tag>
                <el-tag v-else size="small">外购</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="关键件" width="80">
              <template #default="{ row }">
                <el-tag v-if="row.is_key_component" type="danger" size="small">⭐ 关键</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="default_supplier" label="默认供应商" width="140" />
          </el-table>
        </el-card>
      </el-tab-pane>

      <el-tab-pane label="关键外购件" name="key">
        <el-card>
          <el-table :data="kc" stripe v-loading="loading" size="small">
            <el-table-column prop="material_code" label="编码" width="140" />
            <el-table-column prop="material_name" label="名称" min-width="200" />
            <el-table-column prop="component_type" label="类型" width="120" />
            <el-table-column prop="supplier" label="供应商" width="120" />
            <el-table-column label="交期(周)" width="100" align="right">
              <template #default="{ row }">
                <el-tag :type="row.lead_time_weeks >= 12 ? 'danger' : (row.lead_time_weeks >= 8 ? 'warning' : 'success')" size="small">
                  {{ row.lead_time_weeks }}w
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="风险" width="80">
              <template #default="{ row }">
                <el-tag :type="row.risk_level === 'high' ? 'danger' : (row.risk_level === 'medium' ? 'warning' : 'info')" size="small">
                  {{ row.risk_level }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <el-tab-pane label="长交期预警 (≥12 周)" name="long">
        <el-card>
          <el-alert type="warning" :closable="false" style="margin-bottom: 16px">
            以下物料交期 ≥12 周，请提前下单，避免影响项目进度。
          </el-alert>
          <el-table :data="long" stripe v-loading="loading" size="small">
            <el-table-column prop="material_name" label="物料" min-width="200" />
            <el-table-column prop="component_type" label="类型" width="120" />
            <el-table-column prop="supplier" label="供应商" width="120" />
            <el-table-column label="交期" width="100">
              <template #default="{ row }">
                <el-tag type="danger" size="small">{{ row.lead_time_weeks }} 周</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="risk_level" label="风险" width="100" />
          </el-table>
        </el-card>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Api } from '../api'

const activeTab = ref('materials')
const loading = ref(false)
const mats = ref<any[]>([])
const kc = ref<any[]>([])
const long = ref<any[]>([])

const loadMats = async () => { loading.value = true; try { mats.value = await Api.materials() } finally { loading.value = false } }
const loadKc = async () => { loading.value = true; try { kc.value = await Api.keyComponents() } finally { loading.value = false } }
const loadLong = async () => { loading.value = true; try { long.value = await Api.longLeadtime() } finally { loading.value = false } }

onMounted(() => { loadMats(); loadKc(); loadLong() })
</script>
